package ca.shiftcircle.api.assignments;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * The rule-check preview and the assignment save contract (docs/07 §3): preview nothing saved,
 * 422 blocked, 422 warnings-need-acknowledgement, override with reason, audit trail, role and scope.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class AssignmentApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000002");

  @BeforeEach
  void fixture() {
    // Each test starts from the same base roster; audit rows are append-only and are only counted.
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM override");
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-T2', 'Nia', 'Test', ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT_B);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT"
            + " '55555555-5555-5555-5555-000000000002', ?, ?, t.id,"
            + " TIMESTAMPTZ '2026-11-20 12:00:00-06', TIMESTAMPTZ '2026-11-21 00:00:00-06',"
            + " DATE '2026-11-20', 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'P12'"
            + " ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT_B);
  }

  private HttpResponse<String> post(String path, String body, String token) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body));
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private String login(String username) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"" + username + "\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private String changeBody(String kind) {
    return "{\"change\":{\"employeeId\":\"" + EMPLOYEE + "\",\"unitId\":\"" + UNIT_B + "\","
        + "\"shiftTemplate\":\"D8\",\"startAt\":\"2026-11-21T07:00:00-06:00\""
        + (kind == null ? "" : ",\"type\":\"" + kind + "\"")
        + "}}";
  }

  private String changeAt(String shiftTemplate, String startAt) {
    return "{\"change\":{\"employeeId\":\"" + EMPLOYEE + "\",\"unitId\":\"" + UNIT_B + "\","
        + "\"shiftTemplate\":\"" + shiftTemplate + "\",\"startAt\":\"" + startAt + "\"}}";
  }

  private String withOverride(String body, String reason) {
    return body.substring(0, body.length() - 1)
        + ",\"override\":{\"reason\":\"" + reason + "\"}}";
  }

  @Test
  void previewReturnsBlockingResultsAndSavesNothing() throws Exception {
    String token = login("m.ellis");
    HttpResponse<String> response = post("/api/v1/rule-checks", changeBody(null), token);

    assertThat(response.statusCode()).isEqualTo(200);
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("outcome")).isEqualTo("BLOCK");
    assertThat(body.get("overridable")).isEqualTo(true);
    var results = (List<?>) body.get("ruleResults");
    assertThat(results)
        .anySatisfy(
            result -> assertThat(((Map<?, ?>) result).get("ruleCode")).isEqualTo("U-01"));
    assertThat(count("SELECT count(*) FROM shift_assignment WHERE employee_id = '" + EMPLOYEE + "'"))
        .isEqualTo(1);
  }

  @Test
  void savingABlockedChangeReturns422WithResults() throws Exception {
    HttpResponse<String> response = post("/api/v1/assignments", changeBody(null), login("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(422);
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("type").toString()).endsWith("/blocked-by-rules");
    assertThat(body.get("status")).isEqualTo(422);
    assertThat((List<?>) body.get("ruleResults")).isNotEmpty();
  }

  @Test
  void aBlockIsSavedWithAnEmergencyOverrideAndAudited() throws Exception {
    String token = login("m.ellis");
    String body = changeBody(null);
    List<String> warnCodes = new ArrayList<>(warnCodes(post("/api/v1/rule-checks", body, token)));
    String withOverride =
        body.substring(0, body.length() - 1)
            + ",\"acknowledgeWarnings\":"
            + mapper.writeValueAsString(warnCodes)
            + ",\"override\":{\"reason\":\"Lockdown, relief unavailable\"}}";

    HttpResponse<String> response = post("/api/v1/assignments", withOverride, token);

    assertThat(response.statusCode()).isEqualTo(201);
    assertThat(count("SELECT count(*) FROM override WHERE reason LIKE 'Lockdown%'")).isEqualTo(1);
    assertThat(count("SELECT count(*) FROM audit_event WHERE action = 'override_rule'"))
        .isGreaterThanOrEqualTo(1);
    assertThat(count("SELECT count(*) FROM audit_event WHERE action = 'assign_shift'"))
        .isGreaterThanOrEqualTo(1);
    assertThat(count("SELECT count(*) FROM shift_assignment WHERE employee_id = '" + EMPLOYEE + "'"))
        .isEqualTo(2);
  }

  @Test
  void aShortOverrideReasonIsRefused() throws Exception {
    String body =
        changeBody(null).substring(0, changeBody(null).length() - 1)
            + ",\"override\":{\"reason\":\"too short\"}}";

    assertThat(post("/api/v1/assignments", body, login("m.ellis")).statusCode()).isEqualTo(422);
  }

  @Test
  void anEmployeeCannotAssignShifts() throws Exception {
    assertThat(post("/api/v1/assignments", changeBody(null), login("t.nakamura")).statusCode())
        .isEqualTo(403);
  }

  @Test
  void aSupervisorOutsideTheirScopeGets404() throws Exception {
    assertThat(post("/api/v1/assignments", changeBody(null), login("j.chen")).statusCode())
        .isEqualTo(404);
  }

  @Test
  void warningsNeedExplicitAcknowledgement() throws Exception {
    // A clean eight-hour rest: U-01 passes, U-02 warns. Reset the fixture officer's Friday shift.
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT"
            + " '55555555-5555-5555-5555-000000000003', ?, ?, t.id,"
            + " TIMESTAMPTZ '2026-11-19 23:00:00-06', TIMESTAMPTZ '2026-11-20 07:00:00-06',"
            + " DATE '2026-11-19', 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'N8'",
        EMPLOYEE,
        UNIT_B);

    String body =
        "{\"change\":{\"employeeId\":\"" + EMPLOYEE + "\",\"unitId\":\"" + UNIT_B + "\","
            + "\"shiftTemplate\":\"E8\",\"startAt\":\"2026-11-20T15:00:00-06:00\"}}";
    String token = login("m.ellis");

    HttpResponse<String> preview = post("/api/v1/rule-checks", body, token);
    List<?> results = (List<?>) mapper.readValue(preview.body(), Map.class).get("ruleResults");
    List<String> warnCodes =
        results.stream()
            .map(result -> (Map<?, ?>) result)
            .filter(result -> "WARN".equals(result.get("outcome")))
            .map(result -> (String) result.get("ruleCode"))
            .toList();
    assertThat(warnCodes).contains("U-02");

    assertThat(post("/api/v1/assignments", body, token).statusCode()).isEqualTo(422);
    HttpResponse<String> refused = post("/api/v1/assignments", body, token);
    assertThat(refused.statusCode()).isEqualTo(422);
    assertThat((String) mapper.readValue(refused.body(), Map.class).get("type"))
        .endsWith("/warnings-need-acknowledgement");

    String acknowledged =
        body.substring(0, body.length() - 1)
            + ",\"acknowledgeWarnings\":" + mapper.writeValueAsString(warnCodes) + "}";
    assertThat(post("/api/v1/assignments", acknowledged, token).statusCode()).isEqualTo(201);
  }

  @Test
  void concurrentSavesCannotBothBypassBlockRules() throws Exception {
    jdbc.update(
        "DELETE FROM shift_assignment WHERE employee_id = ?"
            + " AND start_at >= TIMESTAMPTZ '2026-11-29 00:00:00-06'",
        EMPLOYEE);
    String evening = changeAt("E8", "2026-11-30T15:00:00-06:00");
    String night = changeAt("N8", "2026-11-30T23:30:00-06:00");
    String token = login("m.ellis");

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      CountDownLatch ready = new CountDownLatch(2);
      CountDownLatch go = new CountDownLatch(1);
      List<Future<HttpResponse<String>>> saves = new ArrayList<>();
      for (String body : List.of(evening, night)) {
        saves.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  go.await();
                  return post("/api/v1/assignments", body, token);
                }));
      }
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();

      List<Integer> statuses = new ArrayList<>();
      for (Future<HttpResponse<String>> save : saves) {
        statuses.add(save.get(30, TimeUnit.SECONDS).statusCode());
      }
      assertThat(statuses)
          .as("one save wins; the other then sees the 30-minute rest and is blocked by U-01")
          .containsExactlyInAnyOrder(201, 422);
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void anEleventhSixteenHourShiftInTwentyEightDaysWarns() throws Exception {
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    LocalDate proposalDate = LocalDate.of(2026, 12, 10);
    // Ten 16-hour shifts, spaced so U-14 (60 h in any 7 days) never blocks: 3 + 3 + 2 + 2.
    for (int daysBefore : new int[] {-27, -25, -24, -20, -18, -17, -13, -11, -6, -4}) {
      insertSixteenHourShift(proposalDate.plusDays(daysBefore));
    }

    HttpResponse<String> response =
        post("/api/v1/rule-checks", changeAt("L16", "2026-12-10T20:00:00-06:00"), login("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(warnCodes(response))
        .as("the 11th 16-hour shift inside 28 days breaches U-11")
        .contains("U-11");
  }

  @Test
  void aBlockRuleWithoutAnEmergencyOverrideCannotBeOverridden() throws Exception {
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    ZoneId regina = ZoneId.of("America/Regina");
    for (int day = 10; day <= 16; day++) {
      LocalDate date = LocalDate.of(2026, 11, day);
      jdbc.update(
          "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
              + " work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED', 'ROTATION'"
              + " FROM shift_template t WHERE t.code = 'D8'",
          UUID.randomUUID(),
          EMPLOYEE,
          UNIT_B,
          Timestamp.from(date.atTime(7, 0).atZone(regina).toInstant()),
          Timestamp.from(date.atTime(15, 0).atZone(regina).toInstant()),
          date);
    }

    HttpResponse<String> response =
        post(
            "/api/v1/assignments",
            withOverride(
                changeAt("D8", "2026-11-17T07:00:00-06:00"),
                "Eighth consecutive day, relief unavailable"),
            login("m.ellis"));

    assertThat(response.statusCode())
        .as("U-08 blocks with an acknowledgement policy, so an emergency override is not enough")
        .isEqualTo(422);
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat((String) body.get("type")).endsWith("/blocked-by-rules");
    assertThat(body.get("overridable")).isEqualTo(false);
  }

  @Test
  void anEmergencyOverrideMustAlsoAcknowledgeTheWarnings() throws Exception {
    String token = login("m.ellis");
    String body = changeAt("D8", "2026-11-21T07:00:00-06:00");
    List<String> warnCodes = new ArrayList<>(warnCodes(post("/api/v1/rule-checks", body, token)));
    assertThat(warnCodes).contains("U-02");

    assertThat(
            post(
                    "/api/v1/assignments",
                    withOverride(body, "Lockdown, relief unavailable"),
                    token)
                .statusCode())
        .as("an override does not silently swallow warnings")
        .isEqualTo(422);

    String acknowledged =
        body.substring(0, body.length() - 1)
            + ",\"acknowledgeWarnings\":"
            + mapper.writeValueAsString(warnCodes)
            + ",\"override\":{\"reason\":\"Lockdown, relief unavailable\"}}";
    assertThat(post("/api/v1/assignments", acknowledged, token).statusCode()).isEqualTo(201);
  }

  @Test
  void thePreviewReportsThePublishedRuleSetVersion() throws Exception {
    Integer original =
        jdbc.queryForObject(
            "SELECT version FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
    try {
      jdbc.update("UPDATE rule_set_version SET version = 42 WHERE status = 'PUBLISHED'");
      Map<?, ?> body =
          mapper.readValue(
              post("/api/v1/rule-checks", changeBody(null), login("m.ellis")).body(), Map.class);
      assertThat(body.get("ruleSetVersion"))
          .as("the version comes from the published rule set, not a constant")
          .isEqualTo(42);
    } finally {
      jdbc.update("UPDATE rule_set_version SET version = ? WHERE status = 'PUBLISHED'", original);
    }
  }

  private void insertSixteenHourShift(LocalDate date) {
    ZoneId regina = ZoneId.of("America/Regina");
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED', 'ROTATION'"
            + " FROM shift_template t WHERE t.code = 'L16'",
        UUID.randomUUID(),
        EMPLOYEE,
        UNIT_B,
        Timestamp.from(date.atTime(20, 0).atZone(regina).toInstant()),
        Timestamp.from(date.plusDays(1).atTime(12, 0).atZone(regina).toInstant()),
        date);
  }

  private List<String> warnCodes(HttpResponse<String> response) throws Exception {
    List<?> results = (List<?>) mapper.readValue(response.body(), Map.class).get("ruleResults");
    return results.stream()
        .map(result -> (Map<?, ?>) result)
        .filter(result -> "WARN".equals(result.get("outcome")))
        .map(result -> (String) result.get("ruleCode"))
        .toList();
  }

  private int count(String sql) {
    Integer value = jdbc.queryForObject(sql, Integer.class);
    return value == null ? 0 : value;
  }
}
