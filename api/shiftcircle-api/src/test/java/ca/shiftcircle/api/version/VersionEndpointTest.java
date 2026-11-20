package ca.shiftcircle.api.version;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import ca.shiftcircle.api.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Proves the two HTTP contracts the deployment relies on (docs/08-deployment.md §2, §8): the
 * version endpoint the UI shows and the readiness probe compose health-checks.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class VersionEndpointTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private Environment environment;

  private HttpResponse<String> get(String path) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build();
    return HttpClient.newHttpClient()
        .send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @Test
  void returnsBuildAndRuleSetInformation() throws Exception {
    HttpResponse<String> response = get("/api/v1/version");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body())
        .contains("\"name\":\"shiftcircle-api\"")
        .contains("\"gitCommit\":\"unknown\"")
        .contains("\"ruleSetVersion\":\"v1\"")
        .contains("\"profiles\":");
  }

  @Test
  void readinessProbeIsUp() throws Exception {
    HttpResponse<String> response = get("/actuator/health/readiness");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).contains("\"status\":\"UP\"");
  }

  @Test
  void actuatorExposesOnlyHealthAndInfo() throws Exception {
    assertThat(get("/actuator/env").statusCode()).isEqualTo(404);
    assertThat(get("/actuator/beans").statusCode()).isEqualTo(404);
  }
}
