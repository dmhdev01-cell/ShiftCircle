package ca.shiftcircle.api.assignments;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
    String body =
        changeBody(null).substring(0, changeBody(null).length() - 1)
            + ",\"override\":{\"reason\":\"Lockdown, relief unavailable\"}}";

    HttpResponse<String> response = post("/api/v1/assignments", body, login("m.ellis"));

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

    String acknowledged =
        body.substring(0, body.length() - 1)
            + ",\"acknowledgeWarnings\":" + mapper.writeValueAsString(warnCodes) + "}";
    assertThat(post("/api/v1/assignments", acknowledged, token).statusCode()).isEqualTo(201);
  }

  private int count(String sql) {
    Integer value = jdbc.queryForObject(sql, Integer.class);
    return value == null ? 0 : value;
  }
}
