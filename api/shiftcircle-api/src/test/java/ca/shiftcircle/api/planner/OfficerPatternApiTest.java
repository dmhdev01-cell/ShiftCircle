package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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

/** Option C: every officer has a pattern; the planner edits an 8 h officer's, 12 h is read-only. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
class OfficerPatternApiTest {

  private static final Map<String, String> WORDS =
      Map.of(
          "ROTATING_5_2", "Rotating 5 on, 2 off (weekends rotate)",
          "5_ON_2_OFF", "Fixed 5 on, 2 off",
          "7_ON_3_OFF", "7 on, 3 off",
          "4_ON_4_OFF", "4 on, 4 off");

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String plannerToken;

  @BeforeAll
  void login() throws Exception {
    plannerToken = login("p.planner");
  }

  @Test
  void everyOfficerHasAPatternAndThePlannerCanChangeAnEightHourOne() throws Exception {
    List<Map<String, Object>> rows = preferences();
    assertThat(rows).hasSize(100);
    Map<String, Object> eight =
        rows.stream()
            .filter(row -> Boolean.TRUE.equals(row.get("patternEditable")))
            .findFirst()
            .orElseThrow(() -> new AssertionError("the 100 seed has an 8 h officer"));
    Map<String, Object> twelve =
        rows.stream()
            .filter(row -> "4_ON_4_OFF".equals(row.get("pattern")))
            .findFirst()
            .orElseThrow(() -> new AssertionError("the 100 seed has a 12 h officer"));
    assertThat(eight.get("pattern")).isEqualTo("ROTATING_5_2");
    assertThat(eight.get("patternWords")).isEqualTo(WORDS.get("ROTATING_5_2"));
    assertThat(twelve.get("patternEditable")).isEqualTo(false);
    assertThat(twelve.get("patternWords")).isEqualTo(WORDS.get("4_ON_4_OFF"));

    UUID employeeId = UUID.fromString((String) eight.get("employeeId"));
    try {
      HttpResponse<String> changed =
          send(
              "PUT",
              "/api/v1/planner/preferences/" + employeeId + "/pattern",
              "{\"pattern\":\"7_ON_3_OFF\"}");
      assertThat(changed.statusCode()).as(changed.body()).isEqualTo(200);
      Map<String, Object> body = mapper.readValue(changed.body(), Map.class);
      assertThat(body.get("pattern")).isEqualTo("7_ON_3_OFF");
      assertThat(body.get("patternWords")).isEqualTo(WORDS.get("7_ON_3_OFF"));
      assertThat(
              jdbc.queryForObject(
                  "SELECT shift_pattern FROM employee WHERE id = ?", String.class, employeeId))
          .isEqualTo("7_ON_3_OFF");

      HttpResponse<String> generated =
          send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}");
      assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
      Map<String, Object> draft = mapper.readValue(generated.body(), Map.class);
      UUID draftId = UUID.fromString((String) draft.get("id"));
      assertThat(draft.get("pattern8h")).as("per-officer drafts carry no facility pattern").isNull();
      assertThat(
              jdbc.queryForObject(
                  "SELECT pattern8h FROM plan_draft WHERE id = ?", String.class, draftId))
          .isNull();
      Map<String, Object> scorecard = (Map<String, Object>) draft.get("scorecard");
      assertThat(scorecard.get("pattern8h")).isNull();
      Map<String, Object> patterns = (Map<String, Object>) scorecard.get("patterns");
      List<Map<String, Object>> officers = (List<Map<String, Object>>) patterns.get("officers");
      assertThat(officers)
          .filteredOn(row -> eight.get("employeeNo").equals(row.get("employeeNo")))
          .singleElement()
          .satisfies(
              row -> {
                assertThat(row.get("pattern")).isEqualTo("7_ON_3_OFF");
                assertThat(row.get("words")).isEqualTo(WORDS.get("7_ON_3_OFF"));
              });
      assertThat(officers)
          .filteredOn(row -> "4_ON_4_OFF".equals(row.get("pattern")))
          .isNotEmpty()
          .allSatisfy(row -> assertThat(row.get("words")).isEqualTo(WORDS.get("4_ON_4_OFF")));
    } finally {
      jdbc.update(
          "UPDATE employee SET shift_pattern = 'ROTATING_5_2' WHERE id = ?", employeeId);
    }
  }

  @Test
  void twelveHourOfficersAreReadOnlyAndBadCodesSayWhy() throws Exception {
    List<Map<String, Object>> rows = preferences();
    Map<String, Object> eight =
        rows.stream()
            .filter(row -> Boolean.TRUE.equals(row.get("patternEditable")))
            .findFirst()
            .orElseThrow();
    Map<String, Object> twelve =
        rows.stream()
            .filter(row -> "4_ON_4_OFF".equals(row.get("pattern")))
            .findFirst()
            .orElseThrow();
    UUID eightId = UUID.fromString((String) eight.get("employeeId"));
    UUID twelveId = UUID.fromString((String) twelve.get("employeeId"));

    HttpResponse<String> twelveChanged =
        send(
            "PUT",
            "/api/v1/planner/preferences/" + twelveId + "/pattern",
            "{\"pattern\":\"7_ON_3_OFF\"}");
    assertThat(twelveChanged.statusCode()).isEqualTo(400);
    assertThat(twelveChanged.body())
        .contains("A 12-hour officer keeps the crew's 4 on, 4 off pattern");

    HttpResponse<String> wrongHours =
        send(
            "PUT",
            "/api/v1/planner/preferences/" + eightId + "/pattern",
            "{\"pattern\":\"4_ON_4_OFF\"}");
    assertThat(wrongHours.statusCode()).isEqualTo(400);
    assertThat(wrongHours.body()).contains("12-hour pattern");

    HttpResponse<String> unknown =
        send(
            "PUT",
            "/api/v1/planner/preferences/" + eightId + "/pattern",
            "{\"pattern\":\"NIGHTS_FOREVER\"}");
    assertThat(unknown.statusCode()).isEqualTo(400);
    assertThat(unknown.body()).contains("pattern must be ROTATING_5_2, 5_ON_2_OFF or 7_ON_3_OFF");

    HttpResponse<String> missing =
        send(
            "PUT",
            "/api/v1/planner/preferences/" + UUID.randomUUID() + "/pattern",
            "{\"pattern\":\"ROTATING_5_2\"}");
    assertThat(missing.statusCode()).isEqualTo(404);
  }

  @Test
  void theOldFacilityPatternStillWorksAsAOneReleaseOverride() throws Exception {
    HttpResponse<String> generated =
        send(
            "POST",
            "/api/v1/planner/drafts",
            "{\"seed\":20261001,\"pattern8h\":\"5_ON_2_OFF\"}");
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    Map<String, Object> draft = mapper.readValue(generated.body(), Map.class);
    assertThat(draft.get("pattern8h")).isEqualTo("5_ON_2_OFF");
    Map<String, Object> scorecard = (Map<String, Object>) draft.get("scorecard");
    assertThat(scorecard.get("pattern8h")).isEqualTo("5_ON_2_OFF");

    HttpResponse<String> rejected =
        send(
            "POST",
            "/api/v1/planner/drafts",
            "{\"seed\":20261001,\"pattern8h\":\"FOUR_ON_FOUR_OFF\"}");
    assertThat(rejected.statusCode()).isEqualTo(400);
    assertThat(rejected.body()).contains("pattern8h must be");
  }

  private List<Map<String, Object>> preferences() throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/planner/preferences", null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return mapper.readValue(response.body(), List.class);
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

  private HttpResponse<String> send(String method, String path, String body) throws Exception {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    builder.header("Authorization", "Bearer " + plannerToken);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
