package ca.shiftcircle.api.demo;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.rulesets.RuleRowsRepository;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.infrastructure.demo.DemoChecksum;
import ca.shiftcircle.infrastructure.demo.DemoDataGenerator;
import java.time.Instant;
import java.util.Map;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Demo reset (person's request, 2026-11-21): clean and migrate the schema, generate the exact seed
 * dataset again, reload the live rules, and leave an honest first audit row. Demo profile only; one
 * heavy operation at a time. The method is deliberately a rebuild, not a truncate: every table,
 * trigger and seed row comes back from the migrations, so the reset cannot drift from a fresh boot.
 */
@Service
@Profile("demo")
public class DemoResetService {

  public record Status(
      String state,
      String step,
      String startedAt,
      Long elapsedMs,
      String checksum,
      String dataset,
      String error) {}

  private static final Status IDLE =
      new Status("IDLE", "idle", null, null, null, "100", null);

  private final DataSource dataSource;
  private final JdbcTemplate jdbc;
  private final DemoDataGenerator generator;
  private final PublishedRuleSet publishedRules;
  private final RuleRowsRepository ruleRows;
  private final DemoOperationLock lock;
  private final ObjectMapper mapper = new ObjectMapper();

  private volatile Status status = IDLE;

  public DemoResetService(
      DataSource dataSource,
      JdbcTemplate jdbc,
      DemoDataGenerator generator,
      PublishedRuleSet publishedRules,
      RuleRowsRepository ruleRows,
      DemoOperationLock lock) {
    this.dataSource = dataSource;
    this.jdbc = jdbc;
    this.generator = generator;
    this.publishedRules = publishedRules;
    this.ruleRows = ruleRows;
    this.lock = lock;
  }

  public Status status() {
    Status current = status;
    if ("RUNNING".equals(current.state()) && current.startedAt() != null) {
      long elapsed = java.time.Duration.between(Instant.parse(current.startedAt()), Instant.now()).toMillis();
      current = new Status(current.state(), current.step(), current.startedAt(), elapsed,
          current.checksum(), current.dataset(), current.error());
    }
    return current;
  }

  public boolean running() {
    return "RUNNING".equals(status.state());
  }

  public Status start(String confirm, String dataset, AuthPrincipal principal) {
    if (!"RESET".equals(confirm)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "confirm must be RESET");
    }
    if (dataset != null && !"100".equals(dataset)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "This prototype has one seeded dataset: 100");
    }
    if (!"IDLE".equals(status.state()) && !"DONE".equals(status.state())
        && !"FAILED".equals(status.state())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "A reset is already running");
    }
    if (!lock.tryAcquire()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "A planner draft is generating or committing; try again");
    }
    status = new Status("RUNNING", "starting", Instant.now().toString(), 0L, null, "100", null);
    Thread.ofVirtual().name("demo-reset").start(() -> run(principal == null ? "p.planner" : principal.username()));
    return status();
  }

  private void run(String actor) {
    try {
      step("clean");
      Flyway flyway =
          Flyway.configure()
              .dataSource(dataSource)
              .cleanDisabled(false)
              .load();
      flyway.clean();
      flyway.migrate();

      step("audit");
      // The first row after the reset says the history before it was erased. The actor exists in
      // V5; the generator's own generate_demo_dataset event comes after this one.
      jdbc.update(
          "INSERT INTO audit_event (actor_user_id, action, entity_type, after)"
              + " VALUES ((SELECT id FROM app_user WHERE username = ?), 'demo_reset', 'demo',"
              + " ?::jsonb)",
          actor,
          mapper.writeValueAsString(Map.of("dataset", "100", "seed", "20261001")));

      step("generating");
      generator.generateIfEmpty();

      step("rules");
      publishedRules.publish(ruleRows.publishedRuleSet());

      step("checksum");
      String checksum = DemoChecksum.of(jdbc);
      status = new Status("DONE", "done", status.startedAt(),
          java.time.Duration.between(Instant.parse(status.startedAt()), Instant.now()).toMillis(),
          checksum, "100", null);
    } catch (RuntimeException failure) {
      status = new Status("FAILED", status.step(), status.startedAt(),
          java.time.Duration.between(Instant.parse(status.startedAt()), Instant.now()).toMillis(),
          null, "100", failure.getMessage());
      org.slf4j.LoggerFactory.getLogger(DemoResetService.class)
          .error("demo reset failed at step {}", status.step(), failure);
    } finally {
      lock.release();
    }
  }

  private void step(String step) {
    status = new Status("RUNNING", step, status.startedAt(),
        status.startedAt() == null ? 0L
            : java.time.Duration.between(Instant.parse(status.startedAt()), Instant.now()).toMillis(),
        null, "100", null);
  }
}
