package ca.shiftcircle.api.schedule;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * docs/07 §4.2: a supervisor publishes their unit's week once, only inside their scope, and the
 * board's published state follows. Publishing writes an audit row.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation.class)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class SchedulePublishApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID PERIOD_A = UUID.fromString("99999999-9999-9999-9999-000000000031");
  private static final UUID PERIOD_B = UUID.fromString("99999999-9999-9999-9999-000000000032");
  private static final LocalDate WEEK_A = LocalDate.of(2027, 1, 4);
  private static final LocalDate WEEK_B = LocalDate.of(2027, 1, 11);

  @BeforeAll
  void fixture() throws Exception {
    period(PERIOD_A, WEEK_A);
    period(PERIOD_B, WEEK_B);
    for (String user :
        new String[] {"m.ellis", "j.chen", "t.nakamura", "a.reviewer"}) {
      tokens.put(user, login(user));
    }
  }

  private void period(UUID id, LocalDate start) {
    jdbc.update(
        "INSERT INTO schedule_period (id, unit_id, start_date, end_date, status)"
            + " VALUES (?, ?, ?, ?, 'DRAFT') ON CONFLICT (id) DO NOTHING",
        id,
        UNIT_A,
        start,
        start.plusDays(6));
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

  private HttpResponse<String> post(String path, String user) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .POST(HttpRequest.BodyPublishers.noBody());
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private HttpResponse<String> get(String path, String user) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private String board(LocalDate week) {
    return "/api/v1/schedule?unitId=" + UNIT_A + "&from=" + week + "&to=" + week.plusDays(6);
  }

  @Test
  @Order(1)
  void publishingIsScopedAuditedAndOneWay() throws Exception {
    String path = "/api/v1/schedule-periods/" + PERIOD_A + "/publish";

    assertThat(post(path, null).statusCode()).isEqualTo(401);
    assertThat(post(path, "t.nakamura").statusCode())
        .as("an employee cannot publish a roster")
        .isEqualTo(403);
    assertThat(post(path, "a.reviewer").statusCode())
        .as("an auditor is read-only")
        .isEqualTo(403);
    assertThat(post(path, "j.chen").statusCode())
        .as("another unit's supervisor must not learn the period exists")
        .isEqualTo(404);
    assertThat(post("/api/v1/schedule-periods/" + UUID.randomUUID() + "/publish", "m.ellis")
            .statusCode())
        .isEqualTo(404);

    HttpResponse<String> published = post(path, "m.ellis");
    assertThat(published.statusCode()).isEqualTo(200);
    Map<String, Object> body = json(published);
    assertThat(body.get("status")).isEqualTo("PUBLISHED");
    assertThat((String) body.get("publishedAt")).isNotBlank();

    assertThat(post(path, "m.ellis").statusCode())
        .as("publishing is one-way")
        .isEqualTo(409);

    Integer audits =
        jdbc.queryForObject(
            "SELECT count(*) FROM audit_event WHERE action = 'publish_schedule_period'"
                + " AND entity_id = ?",
            Integer.class,
            PERIOD_A);
    assertThat(audits).isEqualTo(1);

    Map<String, Object> board = json(get(board(WEEK_A), "m.ellis"));
    Map<String, Object> state = (Map<String, Object>) board.get("publishedState");
    assertThat(state.get("published")).isEqualTo(true);
  }

  @Test
  @Order(2)
  void aDraftWeekReadsAsUnpublishedUntilItIsPublished() throws Exception {
    Map<String, Object> before = json(get(board(WEEK_B), "m.ellis"));
    Map<String, Object> draftState = (Map<String, Object>) before.get("publishedState");
    assertThat(draftState.get("published")).isEqualTo(false);

    assertThat(post("/api/v1/schedule-periods/" + PERIOD_B + "/publish", "m.ellis").statusCode())
        .isEqualTo(200);

    Map<String, Object> after = json(get(board(WEEK_B), "m.ellis"));
    Map<String, Object> publishedState = (Map<String, Object>) after.get("publishedState");
    assertThat(publishedState.get("published")).isEqualTo(true);
  }
}
