package ca.shiftcircle.api.payroll;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * V5: the demo's already-locked pay periods must name who locked them. The seeded path locked the
 * period in the database but left {@code locked_by} null, so the screen could only say "Locked by a
 * supervisor". The API read model already joins {@code app_user}; this pins the seeded data so the
 * name arrives over HTTP (the API-lock path is pinned by {@link PayrollApiTest}).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("demo")
class PayrollLockActorApiTest {

  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine").withDatabaseName("shiftcircle");

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
  }

  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  @Test
  @SuppressWarnings("unchecked")
  void theSeededLockedPeriodNamesItsActor() throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/pay-periods", login("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(200);
    List<Map<String, Object>> periods = mapper.readValue(response.body(), List.class);
    Map<String, Object> locked =
        periods.stream()
            .filter(period -> "LOCKED".equals(period.get("status")))
            .findFirst()
            .orElseThrow(() -> new AssertionError("the demo has no locked pay period"));

    assertThat(locked.get("lockedBy"))
        .as("the supervisor who locked the seeded period")
        .isEqualTo("M. Ellis");
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

  private HttpResponse<String> send(String method, String path, String token) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .method(method, HttpRequest.BodyPublishers.noBody());
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
