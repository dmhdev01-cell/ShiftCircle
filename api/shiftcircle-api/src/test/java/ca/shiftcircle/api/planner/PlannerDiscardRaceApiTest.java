package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
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
 * P3-1 (review-r3): a discard that races a commit must never answer {@code DISCARDED} while the
 * plan is committed. The commit holds the demo operation lock for about two seconds; a discard sent
 * while it runs has to answer 409 and leave no {@code discard_plan} audit row.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
class PlannerDiscardRaceApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String token;

  @BeforeAll
  void login() throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(
                    URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"p.planner\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    token = (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  @Test
  void aDiscardRacingACommitCannotSayDiscarded() throws Exception {
    // A plain discard still works and leaves the draft DISCARDED.
    UUID plain = generate();
    HttpResponse<String> plainDiscard = send("POST", "/api/v1/planner/drafts/" + plain + "/discard");
    assertThat(plainDiscard.statusCode()).as(plainDiscard.body()).isEqualTo(200);
    assertThat(draftStatus(plain)).isEqualTo("DISCARDED");

    // A commit holds the operation lock; the discard that arrives while it runs must lose.
    UUID racing = generate();
    Map<String, Object> preview = json(send("GET",
        "/api/v1/planner/drafts/" + racing + "/commit-preview"));
    int warnings = ((Number) preview.get("warningCount")).intValue();
    String commitBody = "{\"acceptedWarningCount\":" + warnings + "}";

    CompletableFuture<HttpResponse<String>> commit =
        CompletableFuture.supplyAsync(
            () -> {
              try {
                return sendWithHeaders(
                    "POST",
                    "/api/v1/planner/drafts/" + racing + "/commit",
                    commitBody,
                    Map.of("If-Match", "\"0\""));
              } catch (Exception failure) {
                throw new RuntimeException(failure);
              }
            });
    Thread.sleep(300);
    HttpResponse<String> discard =
        send("POST", "/api/v1/planner/drafts/" + racing + "/discard");

    HttpResponse<String> committed = commit.get(30, TimeUnit.SECONDS);
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
    assertThat(discard.statusCode())
        .as("a discard while commit runs must be 409, not 200 DISCARDED; body: %s", discard.body())
        .isEqualTo(409);
    assertThat(draftStatus(racing)).isEqualTo("COMMITTED");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'discard_plan' AND entity_id = ?",
                Integer.class,
                racing))
        .as("no discard audit row for a commit that won")
        .isZero();
  }

  private UUID generate() throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}");
    assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
    return UUID.fromString((String) json(response).get("id"));
  }

  private String draftStatus(UUID id) {
    return jdbc.queryForObject("SELECT status FROM plan_draft WHERE id = ?", String.class, id);
  }

  private HttpResponse<String> send(String method, String path) throws Exception {
    return sendWithHeaders(method, path, null, Map.of());
  }

  private HttpResponse<String> send(String method, String path, String body) throws Exception {
    return sendWithHeaders(method, path, body, Map.of());
  }

  private HttpResponse<String> sendWithHeaders(
      String method, String path, String body, Map<String, String> headers) throws Exception {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .timeout(Duration.ofSeconds(60));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    builder.header("Authorization", "Bearer " + token);
    headers.forEach(builder::header);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }
}
