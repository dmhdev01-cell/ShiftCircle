package ca.shiftcircle.api.problems;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * Bad input must never surface as a 500 or leak internals (review-r2 S3): unknown identifiers answer
 * 404, a malformed request answers 400, and every error body is RFC 9457 problem+json.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ProblemDetailsApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000021");

  @BeforeEach
  void fixture() {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-ERR', 'Bad', 'Input', ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT_A);
  }

  private HttpResponse<String> preview(String body) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    String token = login();
    return client.send(
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/rule-checks"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + token)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build(),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private String login() throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(
                    URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"m.ellis\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private String body(String employeeId, String unitId, String template, String startAt) {
    return "{\"change\":{\"employeeId\":\""
        + employeeId
        + "\",\"unitId\":\""
        + unitId
        + "\",\"shiftTemplate\":\""
        + template
        + "\""
        + (startAt == null ? "" : ",\"startAt\":\"" + startAt + "\"")
        + "}}";
  }

  private void assertProblem(HttpResponse<String> response, int status) throws Exception {
    assertThat(response.statusCode()).isEqualTo(status);
    assertThat(response.headers().firstValue("Content-Type").orElse(""))
        .contains("application/problem+json");
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("status")).isEqualTo(status);
    assertThat(body.get("title")).asString().isNotBlank();
    assertThat(response.body()).doesNotContain("Exception", "at ca.shiftcircle");
  }

  @Test
  void anUnknownUnitIs404() throws Exception {
    assertProblem(
        preview(
            body(
                EMPLOYEE.toString(),
                UUID.randomUUID().toString(),
                "D8",
                "2026-11-24T07:00:00-06:00")),
        404);
  }

  @Test
  void anUnknownEmployeeIs404() throws Exception {
    assertProblem(
        preview(
            body(
                UUID.randomUUID().toString(),
                UNIT_A.toString(),
                "D8",
                "2026-11-24T07:00:00-06:00")),
        404);
  }

  @Test
  void anUnknownShiftTemplateIs404() throws Exception {
    assertProblem(
        preview(body(EMPLOYEE.toString(), UNIT_A.toString(), "ZZ9", "2026-11-24T07:00:00-06:00")),
        404);
  }

  @Test
  void aMissingStartIs400() throws Exception {
    assertProblem(preview(body(EMPLOYEE.toString(), UNIT_A.toString(), "D8", null)), 400);
  }

  @Test
  void aMalformedBodyIs400() throws Exception {
    assertProblem(preview("{\"change\": "), 400);
  }
}
