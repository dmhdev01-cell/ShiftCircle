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
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The reset endpoints must not exist outside the demo profile. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("prod-like")
class DemoResetProfileTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private Environment environment;

  @Test
  void resetDoesNotExistOutsideTheDemoProfile() throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpClient client = HttpClient.newHttpClient();
    HttpResponse<String> reset =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/demo/reset"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"confirm\":\"RESET\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(reset.statusCode()).as("demo reset is refused outside demo").isIn(401, 403, 404);

    HttpResponse<String> version =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/version")).GET()
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    Map<?, ?> body = new tools.jackson.databind.ObjectMapper().readValue(version.body(), Map.class);
    assertThat(body.get("demoMode")).isEqualTo(false);
  }
}
