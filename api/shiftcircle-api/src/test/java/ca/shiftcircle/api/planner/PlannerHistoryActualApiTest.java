package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * review-r2: the planner's look-back history resolves the latest ACTUAL time entry (the seam added
 * in 5b05e16, {@code PlannerService.loadHistory}). Behaviour was right but no test pinned it: with
 * the actual resolution reverted to roster-only, the whole suite stayed green.
 *
 * <p>This test records a +4 h time entry on a committed look-back shift of an officer who works in
 * the plan's first week, generates with the same seed, and asserts the plan changes. Roster-only
 * facts would ignore it, so the plan would be byte-identical.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
class PlannerHistoryActualApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  private static final LocalDate FROM = LocalDate.of(2027, 1, 4);
  private static final LocalDate FIRST_WEEK_END = LocalDate.of(2027, 1, 10);
  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final int SEED = 20261001;

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String token;

  @BeforeAll
  void freshDemoData() throws Exception {
    token = login("p.planner");
    resetDemo();
  }

  /**
   * A +4 h actual end on the look-back history changes the plan (rest/hours see it). This is the
   * observable direction: shortening a history shift can only remove a warning or a block the seed
   * does not have, but an extension adds hours to the next day's window, so the generator either
   * warns or moves the proposal - roster-only facts would ignore it and the plan would not move.
   */
  @Test
  void anExtensionOnTheLookBackHistoryIsReadByTheGenerator() throws Exception {
    Plan baseline = generate();
    List<Candidate> candidates = candidates(baseline.id);
    discard(baseline.id);
    assertThat(candidates).as("officers with first-week work and a look-back shift").isNotEmpty();

    Candidate pinned = null;
    for (Candidate candidate : candidates.subList(0, Math.min(12, candidates.size()))) {
      Actual actual = record(candidate, candidate.endAt.plus(Duration.ofHours(4)));
      Plan changed = generate();
      discard(changed.id);
      delete(actual);
      if (!changed.signature().equals(baseline.signature())) {
        pinned = candidate;
        break;
      }
    }

    assertThat(pinned)
        .as("a +4 h actual end on the look-back history changes the generated plan")
        .isNotNull();
    System.out.println("planner actual seam (+4 h): " + pinned.employeeId + " " + pinned.startAt);
  }

  // ---------------------------------------------------------------------------------------------

  private record Plan(UUID id, String signature) {}

  private record Candidate(UUID assignmentId, UUID employeeId, Instant startAt, Instant endAt) {}

  private record Actual(UUID id) {}

  /**
   * The latest look-back shift of each officer who works in the plan's first week: these are the
   * history facts the first proposals are judged against.
   */
  private List<Candidate> candidates(UUID draftId) {
    return jdbc.query(
        "SELECT DISTINCT ON (s.employee_id) s.id, s.employee_id, s.start_at, s.end_at"
            + " FROM shift_assignment s"
            + " WHERE s.employee_id IN (SELECT DISTINCT employee_id FROM plan_draft_assignment"
            + "   WHERE draft_id = ? AND work_date BETWEEN ? AND ?)"
            + "   AND s.status <> 'CANCELLED' AND s.end_at <= ?"
            + " ORDER BY s.employee_id, s.end_at DESC",
        (rs, row) ->
            new Candidate(
                rs.getObject("id", UUID.class),
                rs.getObject("employee_id", UUID.class),
                rs.getTimestamp("start_at").toInstant(),
                rs.getTimestamp("end_at").toInstant()),
        draftId,
        FROM,
        FIRST_WEEK_END,
        Timestamp.from(FROM.atStartOfDay(REGINA).toInstant()));
  }

  /** An ACTUAL entry on a committed history shift, with the given end. */
  private Actual record(Candidate candidate, Instant end) {
    UUID id = UUID.randomUUID();
    LocalDate workDate = candidate.startAt.atZone(REGINA).toLocalDate();
    UUID period =
        jdbc.queryForObject(
            "SELECT id FROM pay_period WHERE start_date <= ? AND end_date >= ?",
            UUID.class,
            workDate,
            workDate);
    double hours = Duration.between(candidate.startAt, end).toMinutes() / 60.0;
    jdbc.update(
        "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
            + " start_at, end_at, hours, entry_type, pay_code, rule_set_version_id) VALUES"
            + " (?, ?, ?, ?, ?, ?, ?, ?, 'ACTUAL', 'REG',"
            + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
        id,
        candidate.employeeId,
        period,
        candidate.assignmentId,
        workDate,
        Timestamp.from(candidate.startAt),
        Timestamp.from(end),
        hours);
    return new Actual(id);
  }

  private void delete(Actual actual) {
    jdbc.update("DELETE FROM time_entry WHERE id = ?", actual.id);
  }

  /**
   * What the plan would say: the assignment fingerprint plus the two figures the report reads. Any
   * of them changing means the generator saw the actual.
   */
  private Plan generate() throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":" + SEED + "}", token);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
    Map<String, Object> body = json(response);
    UUID id = UUID.fromString((String) body.get("id"));
    String fingerprint =
        jdbc.queryForObject(
            "SELECT md5(string_agg(employee_id::text || ':' || work_date::text || ':'"
                + " || shift_template_id::text, ',' ORDER BY employee_id, work_date,"
                + " shift_template_id)) FROM plan_draft_assignment WHERE draft_id = ?",
            String.class,
            id);
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) body.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> coverage = (Map<String, Object>) scorecard.get("coverage");
    @SuppressWarnings("unchecked")
    Map<String, Object> warnings = (Map<String, Object>) scorecard.get("warnings");
    return new Plan(
        id,
        fingerprint + "|" + coverage.get("shortBlockDays") + "|" + warnings.get("total"));
  }

  private void discard(UUID id) throws Exception {
    assertThat(send("POST", "/api/v1/planner/drafts/" + id + "/discard", null, token).statusCode())
        .isEqualTo(200);
  }

  private void resetDemo() throws Exception {
    HttpResponse<String> started =
        send(
            "POST",
            "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"100\"}",
            token);
    assertThat(started.statusCode()).as(started.body()).isIn(200, 202);
    for (int attempt = 0; attempt < 90; attempt++) {
      Map<String, Object> status = json(send("GET", "/api/v1/demo/reset/status", null, token));
      if ("DONE".equals(status.get("state"))) return;
      if ("FAILED".equals(status.get("state"))) {
        throw new IllegalStateException("demo reset failed: " + status.get("error"));
      }
      Thread.sleep(1000);
    }
    throw new IllegalStateException("demo reset did not finish");
  }

  private String login(String userId) throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/auth/mock-login", "{\"userId\":\"" + userId + "\"}", null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) json(response).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String bearer)
      throws Exception {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json");
    if (bearer != null) request.header("Authorization", "Bearer " + bearer);
    HttpRequest built =
        "GET".equals(method)
            ? request.GET().build()
            : request.POST(
                    body == null
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(body))
                .build();
    return client.send(built, HttpResponse.BodyHandlers.ofString());
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) {
    return mapper.readValue(response.body(), Map.class);
  }
}
