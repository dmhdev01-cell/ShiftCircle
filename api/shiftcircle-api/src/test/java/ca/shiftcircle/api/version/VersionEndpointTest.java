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
import org.springframework.jdbc.core.JdbcTemplate;
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
  @Autowired private JdbcTemplate jdbc;

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
    Integer published =
        jdbc.queryForObject(
            "SELECT version FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
    assertThat(response.body())
        .contains("\"name\":\"shiftcircle-api\"")
        .contains("\"gitCommit\":\"unknown\"")
        .as("the live version, so a published v2 is reported without a code change")
        .contains("\"ruleSetVersion\":\"v" + published + "\"")
        .contains("\"profiles\":")
        .contains("\"asOf\":\"2026-11-19\"");
  }

  @Test
  void readinessProbeIsUp() throws Exception {
    HttpResponse<String> response = get("/actuator/health/readiness");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).contains("\"status\":\"UP\"");
  }

  @Test
  void actuatorExposesOnlyHealthAndInfo() throws Exception {
    // Either "not exposed" (404) or "not signed in" (401, security runs first) is correct here:
    // what must never happen is a 200 with the endpoint's content.
    assertThat(get("/actuator/env").statusCode()).isIn(401, 404);
    assertThat(get("/actuator/beans").statusCode()).isIn(401, 404);
  }
}
