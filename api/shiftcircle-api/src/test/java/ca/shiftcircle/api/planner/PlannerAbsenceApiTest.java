package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** Planned absences are a read-only input: the generator skips that officer for that date. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=true")
@ActiveProfiles("demo")
class PlannerAbsenceApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  @BeforeAll
  void login() throws Exception {
    tokens.put("p.planner", login("p.planner"));
    tokens.put("m.ellis", login("m.ellis"));
  }

  @Test
  void aPlannedAbsenceSkipsTheOfficerAndTheSameInputsProduceTheSamePlan() throws Exception {
    reset120();
    UUID baselineDraft = generate();
    String baseline = fingerprint(baselineDraft);

    Map<String, Object> shift =
        jdbc.queryForMap(
            "SELECT employee_id, unit_id, work_date FROM plan_draft_assignment"
                + " WHERE draft_id = ? ORDER BY work_date, start_at LIMIT 1",
            baselineDraft);
    UUID employeeId = (UUID) shift.get("employee_id");
    UUID unitId = (UUID) shift.get("unit_id");
    LocalDate date = ((java.sql.Date) shift.get("work_date")).toLocalDate();

    HttpResponse<String> added =
        send(
            "POST",
            "/api/v1/planner/absences",
            "{\"employeeId\":\""
                + employeeId
                + "\",\"date\":\""
                + date
                + "\",\"type\":\"VACATION\"}",
            tokens.get("p.planner"));
    assertThat(added.statusCode()).as(added.body()).isEqualTo(201);

    UUID withAbsence = generate();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND employee_id = ?"
                    + " AND work_date = ?",
                Integer.class,
                withAbsence,
                employeeId,
                java.sql.Date.valueOf(date)))
        .as("the absent officer has no shift on the leave date")
        .isZero();
    int relief =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                + " LEFT JOIN rotation_pattern r ON r.id = e.rotation_pattern_id"
                + " WHERE a.draft_id = ? AND a.unit_id = ? AND a.work_date = ?"
                + " AND (e.fte < 1.0 OR r.code LIKE '%RELIEF%')",
            Integer.class,
            withAbsence,
            unitId,
            java.sql.Date.valueOf(date));
    int gaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ? AND unit_id = ? AND gap_date = ?",
            Integer.class,
            withAbsence,
            unitId,
            java.sql.Date.valueOf(date));
    assertThat(relief + gaps)
        .as("a relief officer covers the post or the gap is visible")
        .isPositive();

    Map<String, Object> draft =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + withAbsence, null, tokens.get("p.planner"))
                .body(),
            Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) draft.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> absences = (Map<String, Object>) scorecard.get("absences");
    assertThat(((Number) absences.get("officers")).intValue()).isGreaterThanOrEqualTo(1);
    assertThat(((Number) absences.get("days")).intValue()).isGreaterThanOrEqualTo(1);
    assertThat(absences.get("line").toString()).contains("on leave").contains("relief officers");
    assertThat(
            ((Number) absences.get("coveredByRelief")).intValue()
                + ((Number) absences.get("uncovered")).intValue())
        .isEqualTo(((Number) absences.get("days")).intValue());
    String firstWithAbsence = fingerprint(withAbsence);

    reset120();
    send(
        "POST",
        "/api/v1/planner/absences",
        "{\"employeeId\":\""
            + employeeId
            + "\",\"date\":\""
            + date
            + "\",\"type\":\"VACATION\"}",
        tokens.get("p.planner"));
    UUID repeated = generate();
    String repeatedFingerprint = fingerprint(repeated);
    if (!repeatedFingerprint.equals(firstWithAbsence)) {
      String[] a = firstWithAbsence.split("\n");
      String[] b = repeatedFingerprint.split("\n");
      for (int i = 0; i < Math.min(a.length, b.length); i++) {
        if (!a[i].equals(b[i])) {
          System.out.println("FP_DIFF line " + i + " first=" + a[i] + " second=" + b[i]);
          break;
        }
      }
      System.out.println("FP_SIZE first=" + a.length + " second=" + b.length);
    }
    assertThat(repeatedFingerprint)
        .as("same seed + same absences = identical plan")
        .isEqualTo(firstWithAbsence);

    jdbc.update("DELETE FROM absence");
    reset120();
    UUID noAbsences = generate();
    assertThat(fingerprint(noAbsences))
        .as("no absences = the plan before leave was entered")
        .isEqualTo(baseline);
  }

  @Test
  void absenceEntryIsPlannerOnlyAndValidated() throws Exception {
    assertThat(
            send(
                    "POST",
                    "/api/v1/planner/absences",
                    "{\"employeeId\":\"00000000-0000-0000-0000-000000000000\","
                        + "\"date\":\"2027-02-01\",\"type\":\"VACATION\"}",
                    null)
                .statusCode())
        .isEqualTo(401);
    assertThat(
            send(
                    "POST",
                    "/api/v1/planner/absences",
                    "{\"employeeId\":\"00000000-0000-0000-0000-000000000000\","
                        + "\"date\":\"2027-02-01\",\"type\":\"VACATION\"}",
                    tokens.get("m.ellis"))
                .statusCode())
        .isEqualTo(403);
    UUID employee =
        jdbc.queryForObject("SELECT id FROM employee ORDER BY employee_no LIMIT 1", UUID.class);
    assertThat(
            send(
                    "POST",
                    "/api/v1/planner/absences",
                    "{\"employeeId\":\"" + employee + "\",\"date\":\"2027-02-01\","
                        + "\"type\":\"HOLIDAY\"}",
                    tokens.get("p.planner"))
                .statusCode())
        .isEqualTo(400);
    assertThat(
            send(
                    "POST",
                    "/api/v1/planner/absences",
                    "{\"employeeId\":\"" + employee + "\",\"date\":\"2028-02-01\","
                        + "\"type\":\"VACATION\"}",
                    tokens.get("p.planner"))
                .statusCode())
        .isEqualTo(400);
  }

  private void reset120() throws Exception {
    HttpResponse<String> started =
        send(
            "POST",
            "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"120\"}",
            tokens.get("p.planner"));
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 240_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, tokens.get("p.planner")).body(),
              Map.class);
      if ("DONE".equals(status.get("state"))) {
        assertThat(status.get("dataset")).isEqualTo("120");
        return;
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError("reset 120 failed: " + status.get("error"));
      }
      Thread.sleep(250);
    }
    throw new AssertionError("reset 120 did not finish");
  }

  private UUID generate() throws Exception {
    HttpResponse<String> generated =
        send(
            "POST",
            "/api/v1/planner/drafts",
            "{\"seed\":20261001}",
            tokens.get("p.planner"));
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
  }

  private String fingerprint(UUID draftId) {
    List<String> assignments =
        jdbc.queryForList(
            "SELECT a.employee_id || '|' || a.work_date || '|' || t.code || '|' || a.start_at"
                + " FROM plan_draft_assignment a JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY 1",
            String.class,
            draftId);
    List<String> gaps =
        jdbc.queryForList(
            "SELECT unit_id || '|' || gap_date || '|' || block || '|' || required || '|' || placed"
                + " FROM plan_draft_gap WHERE draft_id = ? ORDER BY 1",
            String.class,
            draftId);
    return String.join("\n", assignments) + "#" + String.join("\n", gaps);
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
    assertThat(response.statusCode()).as("login for %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder.header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
