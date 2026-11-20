package ca.shiftcircle.api.rulesets;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * The safe change pipeline (docs/04 §6, docs/07 §4.7): T13 validation, T10 maker/checker, T7 dry run
 * and publish with a hot swap, and E3 changing a rest target without a code change.
 *
 * <p>The roster fixture recreates PC-06's shape (four consecutive overnight 12-hour shifts) so the
 * dry run and the post-publish check are real; the generator's self-check proves the planted run
 * exists in the demo dataset.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RuleSetApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID OFFICER = UUID.fromString("88888888-8888-8888-8888-000000000001");

  @BeforeEach
  void fixture() throws Exception {
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", OFFICER);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-RS', 'Rae', 'Scenario', ?, DATE '2015-01-01')"
            + " ON CONFLICT (id) DO UPDATE SET active = true",
        OFFICER,
        UNIT_B);
    // PC-06 shape: four consecutive overnight 12-hour shifts.
    for (int day = 2; day <= 5; day++) {
      LocalDate date = LocalDate.of(2026, 11, day);
      ZoneId regina = ZoneId.of("America/Regina");
      jdbc.update(
          "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
              + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED',"
              + " 'ROTATION' FROM shift_template t WHERE t.code = 'A12'",
          UUID.randomUUID(),
          OFFICER,
          UNIT_B,
          Timestamp.from(date.atTime(0, 0).atZone(regina).toInstant()),
          Timestamp.from(date.atTime(12, 0).atZone(regina).toInstant()),
          date);
    }
    for (String user : new String[] {"l.fraser", "p.singh", "m.ellis"}) {
      tokens.put(user, login(user));
    }
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
    assertThat(response.statusCode()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String user)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  @SuppressWarnings("unchecked")
  private int createDraft(int basedOn, String reason) throws Exception {
    HttpResponse<String> response =
        send(
            "POST",
            "/api/v1/rule-sets/drafts",
            "{\"basedOn\":" + basedOn + ",\"reason\":\"" + reason + "\"}",
            "l.fraser");
    assertThat(response.statusCode()).isEqualTo(201);
    return ((Number) json(response).get("version")).intValue();
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> table(int version, String code) throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/rule-sets/" + version + "/tables/" + code, null, "l.fraser");
    assertThat(response.statusCode()).isEqualTo(200);
    return json(response);
  }

  @SuppressWarnings("unchecked")
  private void setParam(Map<String, Object> table, String ruleCode, String key, Object value) {
    List<Map<String, Object>> rows = (List<Map<String, Object>>) table.get("rows");
    assertThat(rows).anySatisfy(row -> assertThat(row.get("ruleCode")).isEqualTo(ruleCode));
    rows.stream()
        .filter(row -> ruleCode.equals(row.get("ruleCode")))
        .findFirst()
        .ifPresent(
            row -> ((Map<String, Object>) row.get("params")).put(key, value));
  }

  private void saveRows(int version, String code, Map<String, Object> table) throws Exception {
    String body = mapper.writeValueAsString(Map.of("rows", table.get("rows")));
    assertThat(
            send("PUT", "/api/v1/rule-sets/" + version + "/tables/" + code + "/rows", body,
                    "l.fraser")
                .statusCode())
        .isEqualTo(200);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> build(int version) throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/rule-sets/" + version + "/build", null, "l.fraser");
    assertThat(response.statusCode()).isEqualTo(200);
    return json(response);
  }

  private void submit(int version) throws Exception {
    assertThat(send("POST", "/api/v1/rule-sets/" + version + "/submit", null, "l.fraser")
            .statusCode())
        .isEqualTo(200);
  }

  private void approveAndPublish(int version, String effectiveDate) throws Exception {
    assertThat(send("POST", "/api/v1/rule-sets/" + version + "/approve", null, "p.singh")
            .statusCode())
        .isEqualTo(200);
    assertThat(
            send(
                    "POST",
                    "/api/v1/rule-sets/" + version + "/publish",
                    "{\"effectiveDate\":\"" + effectiveDate + "\"}",
                    "p.singh")
                .statusCode())
        .isEqualTo(200);
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> ruleResults(String changeBody) throws Exception {
    HttpResponse<String> preview = send("POST", "/api/v1/rule-checks", changeBody, "m.ellis");
    assertThat(preview.statusCode()).isEqualTo(200);
    return (List<Map<String, Object>>) json(preview).get("ruleResults");
  }

  private String changeBody() {
    return "{\"change\":{\"employeeId\":\""
        + OFFICER
        + "\",\"unitId\":\""
        + UNIT_B
        + "\",\"shiftTemplate\":\"D8\",\"startAt\":\"2026-11-20T07:00:00-06:00\"}}";
  }

  @Test
  @Order(1)
  void t13ARowBelowTheLegalFloorFailsValidationAndCannotBeSubmitted() throws Exception {
    int draft = createDraft(1, "T13: the legal floor");
    Map<String, Object> rest = table(draft, "REST");
    setParam(rest, "U-01", "minRestHours", 7);
    saveRows(draft, "REST", rest);

    Map<String, Object> report = build(draft);

    List<Map<String, Object>> steps = (List<Map<String, Object>>) report.get("steps");
    assertThat((Boolean) steps.get(0).get("done")).as("validation fails").isFalse();
    assertThat((List<String>) report.get("errors"))
        .anySatisfy(error -> assertThat(error).contains("8-hour legal floor"));
    assertThat(send("POST", "/api/v1/rule-sets/" + draft + "/submit", null, "l.fraser")
            .statusCode())
        .as("a failed build cannot be submitted")
        .isEqualTo(409);
  }

  @Test
  @Order(2)
  void t10TheAuthorCannotApproveTheirOwnDraft() throws Exception {
    // A person may hold both roles; separation of duties is enforced per action (docs/09 §1).
    jdbc.update(
        "INSERT INTO app_user_role (user_id, role) VALUES"
            + " ((SELECT id FROM app_user WHERE username = 'l.fraser'), 'RULES_APPROVER')"
            + " ON CONFLICT DO NOTHING");
    tokens.put("l.fraser", login("l.fraser"));

    int draft = createDraft(1, "T10: maker/checker");
    Map<String, Object> report = build(draft);
    assertThat((List<Map<String, Object>>) report.get("steps"))
        .allSatisfy(step -> assertThat((Boolean) step.get("done")).isTrue());
    submit(draft);

    HttpResponse<String> approve =
        send("POST", "/api/v1/rule-sets/" + draft + "/approve", null, "l.fraser");
    assertThat(approve.statusCode())
        .as("the author of a rule version cannot approve it")
        .isEqualTo(403);
  }

  @Test
  @Order(3)
  void t7DroppingToThreeNightsShowsTheDryRunAndWarnsAfterPublish() throws Exception {
    assertThat(ruleResults(changeBody()))
        .as("before the change, four consecutive nights do not warn")
        .noneSatisfy(result -> assertThat(result.get("ruleCode")).isEqualTo("U-10"));

    int draft = createDraft(1, "T7: three nights");
    Map<String, Object> consecutive = table(draft, "CONSECUTIVE");
    setParam(consecutive, "U-10", "max", 3);
    saveRows(draft, "CONSECUTIVE", consecutive);

    Map<String, Object> report = build(draft);
    List<Map<String, Object>> steps = (List<Map<String, Object>>) report.get("steps");
    assertThat(steps).allSatisfy(step -> assertThat((Boolean) step.get("done")).isTrue());
    Map<String, Object> scenarioCounts = (Map<String, Object>) report.get("scenarios");
    assertThat(((Number) scenarioCounts.get("total")).intValue())
        .isPositive()
        .isEqualTo(((Number) scenarioCounts.get("passed")).intValue());

    Map<String, Object> dryRun =
        steps.stream()
            .filter(step -> "dryRun".equals(step.get("key")))
            .findFirst()
            .orElseThrow();
    List<Map<String, Object>> impact = (List<Map<String, Object>>) dryRun.get("impact");
    assertThat(impact)
        .as("PC-06's four-night run becomes a new U-10 warning")
        .anySatisfy(
            row -> {
              assertThat(row.get("ruleCode")).isEqualTo("U-10");
              assertThat(row.get("to")).isEqualTo("WARN");
              assertThat(((Number) row.get("count")).longValue()).isGreaterThanOrEqualTo(1);
            });

    submit(draft);
    approveAndPublish(draft, "2026-11-20");

    HttpResponse<String> version = send("GET", "/api/v1/version", null, "m.ellis");
    assertThat(version.body()).contains("\"ruleSetVersion\":\"v" + draft + "\"");

    assertThat(ruleResults(changeBody()))
        .as("after publish the same check warns, with no code change")
        .anySatisfy(
            result -> {
              assertThat(result.get("ruleCode")).isEqualTo("U-10");
              assertThat(result.get("outcome")).isEqualTo("WARN");
            });
  }

  @Test
  @Order(4)
  void e3ARestTargetChangePublishesAndIncrementsTheLiveVersion() throws Exception {
    Integer published =
        jdbc.queryForObject(
            "SELECT max(version) FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
    int draft = createDraft(published, "E3: rest target 12 to 14 hours");
    Map<String, Object> rest = table(draft, "REST");
    setParam(rest, "U-03", "minRestHours", 14);
    saveRows(draft, "REST", rest);

    Map<String, Object> report = build(draft);
    assertThat((List<Map<String, Object>>) report.get("steps"))
        .allSatisfy(step -> assertThat((Boolean) step.get("done")).isTrue());

    submit(draft);
    approveAndPublish(draft, "2026-11-21");

    HttpResponse<String> version = send("GET", "/api/v1/version", null, "m.ellis");
    assertThat(version.body()).contains("\"ruleSetVersion\":\"v" + draft + "\"");
    Integer live =
        jdbc.queryForObject(
            "SELECT max(version) FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
    assertThat(live).isEqualTo(draft);
  }

  @Test
  @Order(5)
  void aBuildThatTheRowsMovedPastIsRefusedAtSubmit() throws Exception {
    Integer published = publishedVersion();
    int draft = createDraft(published, "the fingerprint guard: rows move after the build");
    Map<String, Object> rest = table(draft, "REST");
    setParam(rest, "U-03", "minRestHours", 14);
    saveRows(draft, "REST", rest);
    Map<String, Object> report = build(draft);
    assertThat((List<Map<String, Object>>) report.get("steps"))
        .allSatisfy(step -> assertThat((Boolean) step.get("done")).isTrue());

    // The rows move after the build: the report is no longer evidence about them.
    setParam(rest, "U-03", "minRestHours", 15);
    saveRows(draft, "REST", rest);

    HttpResponse<String> submit =
        send("POST", "/api/v1/rule-sets/" + draft + "/submit", null, "l.fraser");
    assertThat(submit.statusCode())
        .as("a build that predates the current rows cannot be submitted")
        .isEqualTo(409);
    assertThat(submit.body()).contains("rows changed since the last successful build");
  }

  @Test
  @Order(6)
  void aBuildThatTheRowsMovedPastIsRefusedAtPublish() throws Exception {
    Integer published = publishedVersion();
    int draft = createDraft(published, "the fingerprint guard: a direct row change");
    Map<String, Object> report = build(draft);
    assertThat((List<Map<String, Object>>) report.get("steps"))
        .allSatisfy(step -> assertThat((Boolean) step.get("done")).isTrue());
    submit(draft);
    assertThat(send("POST", "/api/v1/rule-sets/" + draft + "/approve", null, "p.singh")
            .statusCode())
        .isEqualTo(200);

    // Only a draft can be edited through the API, so this is the defence-in-depth path: a row
    // changes underneath an approved version (another writer) and publish must refuse.
    jdbc.update(
        "UPDATE rule_row SET params = jsonb_set(params, '{minRestHours}', '13')"
            + " WHERE rule_set_version_id ="
            + " (SELECT id FROM rule_set_version WHERE version = ?) AND code = 'U-03'",
        draft);

    HttpResponse<String> publish =
        send(
            "POST",
            "/api/v1/rule-sets/" + draft + "/publish",
            "{\"effectiveDate\":\"2026-11-22\"}",
            "p.singh");
    assertThat(publish.statusCode())
        .as("a build that predates a row change cannot publish")
        .isEqualTo(409);
    assertThat(publish.body()).contains("rows changed since the last successful build");
    assertThat(publishedVersion()).as("nothing was swapped live").isEqualTo(published);
  }

  @Test
  @Order(7)
  void twoApprovalsOfOneVersionYieldOneApproval() throws Exception {
    int draft = createDraft(publishedVersion(), "two approvers race for one decision");
    build(draft);
    submit(draft);

    java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
    try {
      java.util.concurrent.Callable<HttpResponse<String>> approve =
          () -> send("POST", "/api/v1/rule-sets/" + draft + "/approve", null, "p.singh");
      java.util.concurrent.Future<HttpResponse<String>> first = pool.submit(approve);
      java.util.concurrent.Future<HttpResponse<String>> second = pool.submit(approve);
      HttpResponse<String> left = first.get(30, java.util.concurrent.TimeUnit.SECONDS);
      HttpResponse<String> right = second.get(30, java.util.concurrent.TimeUnit.SECONDS);
      assertThat(List.of(left.statusCode(), right.statusCode()))
          .as("one approver wins and the other is told the version moved")
          .containsExactlyInAnyOrder(200, 409);
    } finally {
      pool.shutdownNow();
    }

    Integer audits =
        jdbc.queryForObject(
            "SELECT count(*) FROM audit_event WHERE action = 'rule_set_approve'"
                + " AND entity_id = (SELECT id FROM rule_set_version WHERE version = ?)",
            Integer.class,
            draft);
    assertThat(audits).as("the losing approval must not write a second audit row").isEqualTo(1);
  }

  private Integer publishedVersion() {
    return jdbc.queryForObject(
        "SELECT max(version) FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
  }
}
