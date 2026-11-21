package ca.shiftcircle.api.units;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** A mid-quarter Unit C close: no C roster/gaps after the date, relief, determinism, reopen. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class UnitPlanningApiTest {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final LocalDate CLOSE = LocalDate.of(2027, 2, 15);
  private static final LocalDate REOPEN = LocalDate.of(2027, 3, 29);

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;
  @Autowired private RuleCheckService ruleCheck;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String planner;

  @BeforeEach
  void reset120() throws Exception {
    planner = login("p.planner");
    HttpResponse<String> reset =
        send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\",\"dataset\":\"120\"}", planner);
    assertThat(reset.statusCode()).as(reset.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 120_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, planner).body(), Map.class);
      if ("DONE".equals(status.get("state"))) {
        return;
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError(status.toString());
      }
      Thread.sleep(300);
    }
    throw new AssertionError("reset did not finish");
  }

  @Test
  void closesUnitCMidQuarterWithoutChangingTheDaysBeforeIt() throws Exception {
    UUID unitC = unitId("C");
    UUID baseline = generateDraft();
    List<String> beforeClose = unitAssignments(baseline, unitC, LocalDate.of(2027, 1, 4), CLOSE.minusDays(1));
    assertThat(beforeClose).isNotEmpty();

    HttpResponse<String> added =
        post(
            "/api/v1/planner/units/" + unitC + "/closures",
            "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation (test)\"}",
            planner);
    assertThat(added.statusCode()).as(added.body()).isEqualTo(201);

    UUID closed = generateDraft();
    assertThat(unitAssignments(closed, unitC, CLOSE, LocalDate.of(2027, 4, 11)))
        .as("no Unit C roster on or after the closing date")
        .isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ? AND unit_id = ?"
                    + " AND gap_date >= ?",
                Integer.class,
                closed,
                unitC,
                CLOSE))
        .as("no Unit C gap on or after the closing date")
        .isZero();
    assertThat(unitAssignments(closed, unitC, LocalDate.of(2027, 1, 4), CLOSE.minusDays(1)))
        .as("the days before the closure are unchanged")
        .isEqualTo(beforeClose);

    List<Map<String, Object>> relief =
        jdbc.queryForList(
            "SELECT a.employee_id, a.unit_id, a.work_date, t.code FROM plan_draft_assignment a"
                + " JOIN employee e ON e.id = a.employee_id"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? AND e.home_unit_id = ? AND a.unit_id <> ?"
                + " AND a.work_date >= ?",
            closed,
            unitC,
            unitC,
            CLOSE);
    assertThat(relief).as("closed-unit officers work as relief in other units").isNotEmpty();
    assertNoBlocks(closed);

    String fingerprint = fingerprint(closed);
    UUID again = generateDraft();
    assertThat(fingerprint(again)).as("the closed plan is deterministic").isEqualTo(fingerprint);

    UUID closure =
        jdbc.queryForObject(
            "SELECT id FROM unit_availability WHERE unit_id = ?", UUID.class, unitC);
    HttpResponse<String> reopened =
        put(
            "/api/v1/planner/units/" + unitC + "/closures/" + closure,
            "{\"reopensOn\":\"" + REOPEN + "\",\"reason\":\"Renovation ends (test)\"}",
            planner);
    assertThat(reopened.statusCode()).as(reopened.body()).isEqualTo(200);
    UUID afterReopen = generateDraft();
    assertThat(unitAssignments(afterReopen, unitC, REOPEN, LocalDate.of(2027, 4, 11)))
        .as("Unit C is planned again after it reopens")
        .isNotEmpty();
  }

  private UUID generateDraft() throws Exception {
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", planner);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
  }

  private List<String> unitAssignments(
      UUID draftId, UUID unitId, LocalDate from, LocalDate to) {
    return jdbc.queryForList(
        "SELECT e.employee_no || '|' || a.work_date || '|' || t.code"
            + " FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
            + " JOIN shift_template t ON t.id = a.shift_template_id"
            + " WHERE a.draft_id = ? AND a.unit_id = ? AND a.work_date BETWEEN ? AND ?"
            + " ORDER BY 1",
        String.class,
        draftId,
        unitId,
        from,
        to);
  }

  private String fingerprint(UUID draftId) {
    List<String> rows =
        jdbc.queryForList(
            "SELECT e.employee_no || '|' || u.code || '|' || t.code || '|' || a.work_date"
                + " || '|' ||"
                + " to_char(a.start_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' ||"
                + " to_char(a.end_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' || a.kind"
                + " FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                + " JOIN unit u ON u.id = a.unit_id JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY 1",
            String.class,
            draftId);
    return String.join("\n", rows);
  }

  private void assertNoBlocks(UUID draftId) {
    Map<UUID, List<ShiftFact>> history = new LinkedHashMap<>();
    jdbc.query(
        "SELECT s.employee_id, e.employee_no, u.code AS unit_code, u.allows_12h,"
            + " u.allows_16h, t.code, s.start_at, s.end_at, s.kind FROM shift_assignment s"
            + " JOIN employee e ON e.id = s.employee_id JOIN unit u ON u.id = s.unit_id"
            + " JOIN shift_template t ON t.id = s.shift_template_id"
            + " WHERE s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                history
                    .computeIfAbsent(rs.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                    .add(
                        new ShiftFact(
                            "history",
                            rs.getString("employee_no"),
                            rs.getString("unit_code"),
                            rs.getString("code"),
                            rs.getTimestamp("start_at").toInstant(),
                            rs.getTimestamp("end_at").toInstant(),
                            "EXTRA".equals(rs.getString("kind"))
                                ? ShiftKind.EXTRA
                                : ShiftKind.ROSTERED,
                            0,
                            rs.getBoolean("allows_12h"),
                            rs.getBoolean("allows_16h"))),
        Timestamp.from(LocalDate.of(2027, 1, 4).atStartOfDay(REGINA).toInstant()),
        Timestamp.from(LocalDate.of(2026, 11, 29).atStartOfDay(REGINA).toInstant()));
    List<Map<String, Object>> planned =
        jdbc.queryForList(
            "SELECT a.employee_id, a.start_at, a.end_at, e.employee_no, u.code AS unit_code,"
                + " u.allows_12h, u.allows_16h, t.code FROM plan_draft_assignment a"
                + " JOIN employee e ON e.id = a.employee_id JOIN unit u ON u.id = a.unit_id"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY a.start_at, a.employee_id",
            draftId);
    List<String> blocks = new ArrayList<>();
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      ShiftFact proposed =
          new ShiftFact(
              "draft",
              (String) row.get("employee_no"),
              (String) row.get("unit_code"),
              (String) row.get("code"),
              ((Timestamp) row.get("start_at")).toInstant(),
              ((Timestamp) row.get("end_at")).toInstant(),
              ShiftKind.ROSTERED,
              0,
              (Boolean) row.get("allows_12h"),
              (Boolean) row.get("allows_16h"));
      ruleCheck.evaluate(proposed, history.getOrDefault(employeeId, List.of())).ruleResults().stream()
          .filter(result -> "BLOCK".equals(result.outcome()))
          .forEach(result -> blocks.add(result.ruleCode() + ": " + result.message()));
      history.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(proposed);
    }
    assertThat(blocks).as("no Block over the closed-unit draft").isEmpty();
  }

  private UUID unitId(String code) {
    return jdbc.queryForObject("SELECT id FROM unit WHERE code = ?", UUID.class, code);
  }

  private HttpResponse<String> post(String path, String body, String token) throws Exception {
    return send("POST", path, body, token);
  }

  private HttpResponse<String> put(String path, String body, String token) throws Exception {
    return send("PUT", path, body, token);
  }

  private String login(String username) throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"" + username + "\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).as("login for %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    builder.header("Authorization", "Bearer " + token);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
