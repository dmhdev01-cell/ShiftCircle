package ca.shiftcircle.api.demo;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.rulesets.RuleRowsRepository;
import ca.shiftcircle.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Demo reset (person's request, 2026-11-21): clean and migrate the schema, generate the selected
 * demo dataset again, reload the live rules, and leave an honest first audit row. Demo profile
 * only; one heavy operation at a time. The method is deliberately a rebuild, not a truncate: every
 * table, trigger and seed row comes back from the migrations, so the reset cannot drift from a
 * fresh boot.
 *
 * <p>The dataset selector is a provider registry: "100" is today's {@code DemoDataGenerator};
 * "120" is the 100 full-time crews plus the 20-officer casual relief pool. An unknown selector is a
 * 400 listing what is available, never a silent fallback.
 */
@Service
@Profile("demo")
@ConditionalOnProperty(name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
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
  private final Map<String, DemoDatasetProvider> providers;
  private final PublishedRuleSet publishedRules;
  private final RuleRowsRepository ruleRows;
  private final DemoOperationLock lock;
  private final ObjectMapper mapper = new ObjectMapper();

  private volatile Status status = IDLE;

  public DemoResetService(
      DataSource dataSource,
      JdbcTemplate jdbc,
      List<DemoDatasetProvider> providers,
      PublishedRuleSet publishedRules,
      RuleRowsRepository ruleRows,
      DemoOperationLock lock) {
    this.dataSource = dataSource;
    this.jdbc = jdbc;
    this.providers = new LinkedHashMap<>();
    for (DemoDatasetProvider provider : providers) {
      DemoDatasetProvider previous = this.providers.put(provider.dataset(), provider);
      if (previous != null) {
        throw new IllegalStateException("Duplicate demo dataset: " + provider.dataset());
      }
    }
    this.publishedRules = publishedRules;
    this.ruleRows = ruleRows;
    this.lock = lock;
  }

  public List<String> availableDatasets() {
    List<String> datasets = new ArrayList<>(providers.keySet());
    datasets.sort(Comparator.naturalOrder());
    return datasets;
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
    String selected = dataset == null ? "100" : dataset;
    DemoDatasetProvider provider = providers.get(selected);
    if (provider == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "Unknown demo dataset: "
              + selected
              + ". Available: "
              + String.join(", ", availableDatasets()));
    }
    if (!"IDLE".equals(status.state()) && !"DONE".equals(status.state())
        && !"FAILED".equals(status.state())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "A reset is already running");
    }
    if (!lock.tryAcquire()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "A planner draft is generating or committing; try again");
    }
    status =
        new Status(
            "RUNNING", "starting", Instant.now().toString(), 0L, null, provider.dataset(), null);
    Thread.ofVirtual().name("demo-reset").start(() -> run(principal == null ? "p.planner" : principal.username(), provider));
    return status();
  }

  private void run(String actor, DemoDatasetProvider provider) {
    try {
      step("clean", provider);
      Flyway flyway =
          Flyway.configure()
              .dataSource(dataSource)
              .cleanDisabled(false)
              .load();
      flyway.clean();
      flyway.migrate();

      step("audit", provider);
      // The first row after the reset says the history before it was erased. The actor exists in
      // V5; the dataset provider's own generate event comes after this one.
      jdbc.update(
          "INSERT INTO audit_event (actor_user_id, action, entity_type, after)"
              + " VALUES ((SELECT id FROM app_user WHERE username = ?), 'demo_reset', 'demo',"
              + " ?::jsonb)",
          actor,
          mapper.writeValueAsString(
              Map.of("dataset", provider.dataset(), "seed", provider.seed())));

      step("generating", provider);
      provider.seedData();

      step("rules", provider);
      publishedRules.publish(ruleRows.publishedRuleSet());

      step("checksum", provider);
      String checksum = provider.checksum();
      // Release before publishing DONE: a caller that polls the status and immediately starts the
      // next reset must not race the lock release. The same is true of FAILED below.
      lock.release();
      status = new Status("DONE", "done", status.startedAt(),
          java.time.Duration.between(Instant.parse(status.startedAt()), Instant.now()).toMillis(),
          checksum, provider.dataset(), null);
    } catch (RuntimeException failure) {
      lock.release();
      status = new Status("FAILED", status.step(), status.startedAt(),
          java.time.Duration.between(Instant.parse(status.startedAt()), Instant.now()).toMillis(),
          null, provider.dataset(), failure.getMessage());
      org.slf4j.LoggerFactory.getLogger(DemoResetService.class)
          .error("demo reset failed at step {}", status.step(), failure);
    }
  }

  private void step(String step, DemoDatasetProvider provider) {
    status = new Status("RUNNING", step, status.startedAt(),
        status.startedAt() == null ? 0L
            : java.time.Duration.between(Instant.parse(status.startedAt()), Instant.now()).toMillis(),
        null, provider.dataset(), null);
  }
}
