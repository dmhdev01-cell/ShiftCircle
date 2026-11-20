package ca.shiftcircle.api.assignments;

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
 * Change inputs that must be validation problems (400 naming the field), not conflicts or 500s.
 * review-r3's scope 4: type 'EVIL' was treated as ASSIGN, and a +999999-year startAt reached the
 * database path and answered 409 "reload and try again", which a user would loop on.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class AssignmentInputApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private String token;

  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID OFFICER = UUID.fromString("33333333-3333-3333-3333-0000000000ff");

  @BeforeEach
  void fixture() throws Exception {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-IN', 'Input', 'Officer', ?, DATE '2020-01-01')"
            + " ON CONFLICT DO NOTHING",
        OFFICER,
        UNIT_B);
    String port = environment.getRequiredProperty("local.server.port");
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"m.ellis\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).isEqualTo(200);
    token = (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  @Test
  void aGarbageChangeTypeIsRefusedNamingTheField() throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/rule-checks", change("EVIL", "2026-11-20T07:00:00-06:00"));

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("(type)");
  }

  @Test
  void anAbsurdStartYearIsRefusedNamingTheField() throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/assignments", change("ASSIGN", "+999999-01-01T07:00:00Z"));

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("startAt");
    assertThat(problem(response).get("title").toString()).contains("five years");
  }

  @Test
  void aValidPreviewIsStillAccepted() throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/rule-checks", change("ASSIGN", "2026-11-20T07:00:00-06:00"));

    assertThat(response.statusCode()).isEqualTo(200);
  }

  private String change(String type, String startAt) {
    return "{\"change\":{\"type\":\""
        + type
        + "\",\"employeeId\":\""
        + OFFICER
        + "\",\"unitId\":\""
        + UNIT_B
        + "\",\"shiftTemplate\":\"D8\",\"startAt\":\""
        + startAt
        + "\"}}";
  }

  private Map<?, ?> problem(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private HttpResponse<String> send(String method, String path, String body) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    builder.header("Authorization", "Bearer " + token);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
