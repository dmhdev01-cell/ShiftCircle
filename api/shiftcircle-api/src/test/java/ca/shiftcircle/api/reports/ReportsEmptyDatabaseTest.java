package ca.shiftcircle.api.reports;

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
 * M5: with the schema and users but no pay periods (the generator is off), the hours report answers
 * an empty report instead of failing on a missing period row.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ReportsEmptyDatabaseTest {

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
  void theHoursReportIsAnEmptyReportWhenThereAreNoPayPeriods() throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    String login =
        client
            .send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"a.reviewer\"}"))
                    .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            .body();
    String token = (String) mapper.readValue(login, Map.class).get("token");

    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(
                    URI.create("http://localhost:" + port + "/api/v1/reports/hours"))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    Map<String, Object> body = mapper.readValue(response.body(), Map.class);
    assertThat((List<?>) body.get("rows")).isEmpty();
    assertThat(((Map<?, ?>) body.get("period")).get("status")).isEqualTo("OPEN");
  }
}
