package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * P3-5 (review-r3): an Error during the reset must release the lock, set FAILED and hide the raw
 * detail from the planner. The failing provider is a test bean with its own dataset id, so the
 * failure happens after Flyway clean/migrate and the audit row, exactly where a real bug would.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
@Import(DemoResetFailureTest.FailingProviderConfig.class)
class DemoResetFailureTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private DemoOperationLock lock;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void anErrorDuringTheResetReleasesTheLockAndHidesTheDetail() throws Exception {
    String token = login();
    HttpResponse<String> started = post("/api/v1/demo/reset",
        "{\"confirm\":\"RESET\",\"dataset\":\"499\"}", token);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);

    Map<String, Object> status = waitFor("FAILED", token);
    assertThat(status.get("error").toString())
        .as("the planner must not receive the raw error")
        .doesNotContain("raw detail")
        .contains("The demo reset failed");
    assertThat(lock.busy()).as("the permit is released even for an Error").isFalse();

    // The service is usable again: a real reset reaches DONE and its checksum.
    HttpResponse<String> recovered = post("/api/v1/demo/reset",
        "{\"confirm\":\"RESET\",\"dataset\":\"100\"}", token);
    assertThat(recovered.statusCode()).as(recovered.body()).isEqualTo(200);
    Map<String, Object> done = waitFor("DONE", token);
    assertThat(done.get("checksum"))
        .isEqualTo(
            "01b0543646580f6dc9cedefd2ece7352a3d69e563c85db0baf287dd78b322e58");
  }

  private Map<String, Object> waitFor(String state, String token) throws Exception {
    long deadline = System.nanoTime() + java.time.Duration.ofSeconds(60).toNanos();
    while (System.nanoTime() < deadline) {
      HttpResponse<String> response = get("/api/v1/demo/reset/status", token);
      assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
      Map<String, Object> status = json(response);
      if (state.equals(status.get("state"))) {
        return status;
      }
      if ("FAILED".equals(status.get("state")) && !"FAILED".equals(state)) {
        throw new AssertionError("reset failed while waiting for " + state + ": " + status);
      }
      Thread.sleep(200);
    }
    throw new AssertionError("reset did not reach " + state);
  }

  private String login() throws Exception {
    HttpResponse<String> response =
        post(
            "/api/v1/auth/mock-login",
            "{\"userId\":\"p.planner\"}",
            null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) json(response).get("token");
  }

  private HttpResponse<String> get(String path, String token) throws Exception {
    return send("GET", path, null, token);
  }

  private HttpResponse<String> post(String path, String body, String token) throws Exception {
    return send("POST", path, body, token);
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

  @TestConfiguration
  static class FailingProviderConfig {
    @Bean
    DemoDatasetProvider failingProvider() {
      return new DemoDatasetProvider() {
        @Override
        public String dataset() {
          return "499";
        }

        @Override
        public String seed() {
          return "failure";
        }

        @Override
        public void seedData() {
          throw new AssertionError("raw detail must not leak");
        }

        @Override
        public String checksum() {
          return "unused";
        }
      };
    }
  }
}
