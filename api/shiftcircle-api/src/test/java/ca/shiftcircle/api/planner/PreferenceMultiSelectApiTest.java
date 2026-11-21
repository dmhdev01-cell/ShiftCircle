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

/** P3 preference multi-select: timesOfDay round-trip, legacy compatibility and validation. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
class PreferenceMultiSelectApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String employeeToken;
  private String plannerToken;

  @BeforeAll
  void login() throws Exception {
    employeeToken = login("t.nakamura");
    plannerToken = login("p.planner");
  }

  @Test
  void multiSelectRoundTripAndLegacyInput() throws Exception {
    HttpResponse<String> set =
        put(
            "/api/v1/me/preferences",
            "{\"shiftLength\":12,\"timesOfDay\":[\"NIGHT\",\"DAY\"],\"daysOff\":[]}",
            employeeToken);
    assertThat(set.statusCode()).as(set.body()).isEqualTo(200);
    Map<String, Object> mine = json(get("/api/v1/me/preferences", employeeToken));
    assertThat(mine.get("timesOfDay")).isEqualTo(List.of("DAY", "NIGHT"));
    assertThat(mine).doesNotContainKey("timeOfDay");
    assertThat(storedTimes()).containsExactly("DAY", "NIGHT");

    // The old single value is still accepted for one release.
    assertThat(
            put(
                    "/api/v1/me/preferences",
                    "{\"shiftLength\":8,\"timeOfDay\":\"EVENING\"}",
                    employeeToken)
                .statusCode())
        .isEqualTo(200);
    assertThat(json(get("/api/v1/me/preferences", employeeToken)).get("timesOfDay"))
        .isEqualTo(List.of("EVENING"));

    // If both are sent, timesOfDay wins even when they disagree.
    assertThat(
            put(
                    "/api/v1/me/preferences",
                    "{\"timesOfDay\":[\"DAY\"],\"timeOfDay\":\"NIGHT\"}",
                    employeeToken)
                .statusCode())
        .isEqualTo(200);
    assertThat(json(get("/api/v1/me/preferences", employeeToken)).get("timesOfDay"))
        .isEqualTo(List.of("DAY"));

    // Empty is the explicit no-preference value.
    assertThat(
            put("/api/v1/me/preferences", "{\"timesOfDay\":[]}", employeeToken).statusCode())
        .isEqualTo(200);
    assertThat(json(get("/api/v1/me/preferences", employeeToken)).get("timesOfDay"))
        .isEqualTo(List.of());
  }

  @Test
  void validationAndDuplicateCollapse() throws Exception {
    assertThat(
            put(
                    "/api/v1/me/preferences",
                    "{\"timesOfDay\":[\"MORNING\"]}",
                    employeeToken)
                .statusCode())
        .isEqualTo(400);
    assertThat(
            put("/api/v1/me/preferences", "{\"timesOfDay\":\"DAY\"}", employeeToken).statusCode())
        .isEqualTo(400);
    assertThat(
            put(
                    "/api/v1/me/preferences",
                    "{\"timesOfDay\":[\"DAY\",null]}",
                    employeeToken)
                .statusCode())
        .isEqualTo(400);
    assertThat(
            put(
                    "/api/v1/me/preferences",
                    "{\"timeOfDay\":\"MORNING\"}",
                    employeeToken)
                .statusCode())
        .isEqualTo(400);

    // Duplicates collapse; more than three raw entries is fine as long as they are the three parts.
    HttpResponse<String> collapsed =
        put(
            "/api/v1/me/preferences",
            "{\"timesOfDay\":[\"DAY\",\"DAY\",\"EVENING\",\"NIGHT\",\"EVENING\"]}",
            employeeToken);
    assertThat(collapsed.statusCode()).as(collapsed.body()).isEqualTo(200);
    assertThat(json(collapsed).get("timesOfDay"))
        .isEqualTo(List.of("DAY", "EVENING", "NIGHT"));
  }

  @Test
  void thePlannerPreferencesCarryTheSet() throws Exception {
    assertThat(
            put(
                    "/api/v1/me/preferences",
                    "{\"shiftLength\":12,\"timesOfDay\":[\"DAY\",\"EVENING\"]}",
                    employeeToken)
                .statusCode())
        .isEqualTo(200);
    List<Map<String, Object>> rows =
        mapper.readValue(
            get("/api/v1/planner/preferences", plannerToken).body(), List.class);
    UUID employeeId = employeeId();
    Map<String, Object> row =
        rows.stream()
            .filter(candidate -> employeeId.toString().equals(candidate.get("employeeId")))
            .findFirst()
            .orElseThrow();
    assertThat(row.get("timesOfDay")).isEqualTo(List.of("DAY", "EVENING"));
    assertThat(row).doesNotContainKey("timeOfDay");
  }

  private UUID employeeId() {
    return jdbc.queryForObject(
        "SELECT employee_id FROM app_user WHERE username = 't.nakamura'", UUID.class);
  }

  private List<String> storedTimes() {
    java.sql.Array array =
        jdbc.queryForObject(
            "SELECT times_of_day FROM officer_preference WHERE employee_id = ?",
            java.sql.Array.class,
            employeeId());
    try {
      return List.of((String[]) array.getArray());
    } catch (Exception unreadable) {
      throw new IllegalStateException(unreadable);
    }
  }

  private String login(String username) throws Exception {
    HttpResponse<String> response =
        send(
            "POST",
            "/api/v1/auth/mock-login",
            "{\"userId\":\"" + username + "\"}",
            null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) json(response).get("token");
  }

  private HttpResponse<String> get(String path, String token) throws Exception {
    return send("GET", path, null, token);
  }

  private HttpResponse<String> put(String path, String body, String token) throws Exception {
    return send("PUT", path, body, token);
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
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }
}
