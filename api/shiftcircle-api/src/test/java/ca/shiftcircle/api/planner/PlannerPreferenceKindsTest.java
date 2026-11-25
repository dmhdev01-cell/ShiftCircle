package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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

/** F10: D12/N12 must be 12 h DAY/NIGHT for preferences, exactly like the template row says. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=true")
@ActiveProfiles("demo")
class PlannerPreferenceKindsTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private String token;

  @BeforeAll
  void login() throws Exception {
    token = login("p.planner");
  }

  @Test
  void twelveHourCrewsScoreAsTheirTemplateSays() throws Exception {
    reset120();
    UUID draft = generate();
    Map<String, Object> body =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draft, null, token).body(), Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) body.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> preferences = (Map<String, Object>) scorecard.get("preferences");
    int scorecardMet = ((Number) preferences.get("met")).intValue();
    Map<String, Object> compare =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draft + "/compare", null, token).body(),
            Map.class);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> rows = (List<Map<String, Object>>) compare.get("rows");
    int compareMet =
        rows.stream()
            .filter(row -> "preferencesMet".equals(row.get("key")))
            .map(row -> ((Number) row.get("draft")).intValue())
            .findFirst()
            .orElse(-1);
    assertThat(compareMet)
        .as("scorecard preferences.met and compare use the same template classification")
        .isEqualTo(scorecardMet);

    UUID n12 =
        jdbc.queryForObject(
            "SELECT e.id FROM employee e JOIN rotation_pattern r ON r.id = e.rotation_pattern_id"
                + " JOIN officer_preference p ON p.employee_id = e.id"
                + " WHERE r.code = 'N12_NIGHT_4ON4OFF' AND p.shift_length = 12"
                + " AND p.times_of_day @> ARRAY['NIGHT']::text[] AND e.fte = 1 LIMIT 1",
            UUID.class);
    Map<String, Object> n12Row = preferenceRow(n12);
    assertThat(n12Row.get("inDraft"))
        .as("an N12 officer who asked for 12 h NIGHT is met")
        .isEqualTo("MET");
    assertThat((List<?>) n12Row.get("unmet")).isEmpty();

    UUID d12 =
        jdbc.queryForObject(
            "SELECT e.id FROM employee e JOIN rotation_pattern r ON r.id = e.rotation_pattern_id"
                + " WHERE r.code = 'D12_DAY_4ON4OFF' AND e.fte = 1 LIMIT 1",
            UUID.class);
    jdbc.update(
        "UPDATE officer_preference SET shift_length = 8, times_of_day = ARRAY['EVENING']"
            + " WHERE employee_id = ?",
        d12);
    UUID second = generate();
    Map<String, Object> d12Row = preferenceRow(d12);
    assertThat(d12Row.get("inDraft"))
        .as("a D12 officer who asked for 8 h evenings is not met")
        .isEqualTo("NOT_MET");
    assertThat(d12Row.get("unmet").toString()).contains("Shift length 8 h").contains("EVENING");

    Map<String, Object> secondBody =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + second, null, token).body(), Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> secondScorecard = (Map<String, Object>) secondBody.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> nights = (Map<String, Object>) secondScorecard.get("nights");
    assertThat(((Number) nights.get("n12Officers")).intValue())
        .as("41 N12 crew officers plus any casual who covered a night")
        .isGreaterThanOrEqualTo(41);
    assertThat(nights.get("newestFirstHeld")).isEqualTo(true);
    assertThat((List<?>) nights.get("bands")).hasSize(3);
  }

  /**
   * Release 4 #14: a casual with a preference but no shift in the draft is NOT_ROSTERED, and the
   * scorecard/compare headline counts only officers who were actually rostered. The expected asked
   * count is derived from the database with the same three criteria, so the test cannot pass by
   * hard-coding the demo's numbers.
   */
  @Test
  void anOfficerWithNoDraftShiftIsNotRosteredAndDropsOutOfTheHeadline() throws Exception {
    reset120();
    UUID draft = generate();

    UUID unrostered =
        jdbc.queryForObject(
            "SELECT e.id FROM employee e JOIN officer_preference p ON p.employee_id = e.id"
                + " WHERE NOT EXISTS (SELECT 1 FROM plan_draft_assignment a"
                + "   WHERE a.draft_id = ? AND a.employee_id = e.id)"
                + " AND (p.shift_length IS NOT NULL OR cardinality(p.times_of_day) > 0"
                + "   OR cardinality(p.days_off) > 0)"
                + " ORDER BY e.employee_no LIMIT 1",
            UUID.class,
            draft);
    Map<String, Object> row = preferenceRow(unrostered);
    assertThat(row.get("inDraft"))
        .as("asked for something but the draft has no shift for them")
        .isEqualTo("NOT_ROSTERED");

    Map<String, Object> body =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draft, null, token).body(), Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) body.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> preferences = (Map<String, Object>) scorecard.get("preferences");

    int rosteredAsked =
        jdbc.queryForObject(
            "SELECT coalesce(sum((p.shift_length IS NOT NULL)::int"
                + " + (cardinality(p.times_of_day) > 0)::int"
                + " + (cardinality(p.days_off) > 0)::int), 0)"
                + " FROM employee e JOIN officer_preference p ON p.employee_id = e.id"
                + " WHERE e.classification = 'CO'"
                + " AND EXISTS (SELECT 1 FROM plan_draft_assignment a"
                + "   WHERE a.draft_id = ? AND a.employee_id = e.id)",
            Integer.class,
            draft);
    // The preferences card is the officers' since release v1.3 S3; the supervisors' wishes are
    // in their own card, so the rostered officers' wishes are what the card counts.
    int everyoneAsked =
        jdbc.queryForObject(
            "SELECT coalesce(sum((p.shift_length IS NOT NULL)::int"
                + " + (cardinality(p.times_of_day) > 0)::int"
                + " + (cardinality(p.days_off) > 0)::int), 0)"
                + " FROM officer_preference p JOIN employee e ON e.id = p.employee_id"
                + " WHERE e.classification = 'CO'",
            Integer.class);
    assertThat(everyoneAsked)
        .as("the shift-less officers do ask for something, so the exclusion is observable")
        .isGreaterThan(rosteredAsked);
    assertThat(((Number) preferences.get("asked")).intValue()).isEqualTo(rosteredAsked);

    Map<String, Object> compare =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draft + "/compare", null, token).body(),
            Map.class);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> rows = (List<Map<String, Object>>) compare.get("rows");
    int compareMet =
        rows.stream()
            .filter(entry -> "preferencesMet".equals(entry.get("key")))
            .map(entry -> ((Number) entry.get("draft")).intValue())
            .findFirst()
            .orElse(-1);
    assertThat(compareMet).isEqualTo(((Number) preferences.get("met")).intValue());
  }

  private Map<String, Object> preferenceRow(UUID employeeId) throws Exception {
    List<Map<String, Object>> rows =
        mapper.readValue(
            send("GET", "/api/v1/planner/preferences", null, token).body(), List.class);
    return rows.stream()
        .filter(row -> employeeId.toString().equals(row.get("employeeId")))
        .findFirst()
        .orElseThrow();
  }

  private void reset120() throws Exception {
    HttpResponse<String> started =
        send(
            "POST",
            "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"120\"}",
            token);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 240_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, token).body(), Map.class);
      if ("DONE".equals(status.get("state"))) {
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
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", token);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
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

  private HttpResponse<String> send(String method, String path, String body, String auth)
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
    if (auth != null) {
      builder.header("Authorization", "Bearer " + auth);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
