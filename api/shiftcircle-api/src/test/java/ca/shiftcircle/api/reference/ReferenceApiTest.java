package ca.shiftcircle.api.reference;

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
import tools.jackson.databind.ObjectMapper;

/** Reference data endpoints (docs/07 §4.1), including the supervisor unit filter. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ReferenceApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private HttpResponse<String> get(String path, String token) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
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
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  @Test
  void supervisorsSeeOnlyTheirUnits() throws Exception {
    List<?> units = mapper.readValue(get("/api/v1/units", login("m.ellis")).body(), List.class);

    assertThat(units).hasSize(2);
    @SuppressWarnings("unchecked")
    java.util.List<String> codes =
        (java.util.List<String>)
            units.stream().map(unit -> ((Map<?, ?>) unit).get("code")).toList();
    assertThat(codes).containsExactly("A", "B");
  }

  @Test
  void anAuditorSeesEveryUnit() throws Exception {
    List<?> units = mapper.readValue(get("/api/v1/units", login("a.reviewer")).body(), List.class);
    assertThat(units).hasSize(6);
  }

  @Test
  void shiftTemplatesAndQualificationsAreReadableByAnySignedInRole() throws Exception {
    String token = login("t.nakamura");

    List<?> templates = mapper.readValue(get("/api/v1/shift-templates", token).body(), List.class);
    List<?> qualifications =
        mapper.readValue(get("/api/v1/qualifications", token).body(), List.class);

    assertThat(templates).hasSize(8);
    assertThat(templates.toString()).contains("D12").contains("N12");
    assertThat(qualifications).hasSize(3);
    assertThat(get("/api/v1/shift-templates", null).statusCode()).isEqualTo(401);
  }

  @Test
  void employeesAreScopedToTheSupervisorsUnits() throws Exception {
    String token = login("m.ellis");
    HttpResponse<String> unitA =
        get(
            "/api/v1/employees?unitId=11111111-1111-1111-1111-000000000001", token);
    HttpResponse<String> unitCtl =
        get(
            "/api/v1/employees?unitId=11111111-1111-1111-1111-000000000005", token);

    assertThat(unitA.statusCode()).isEqualTo(200);
    assertThat(unitCtl.statusCode()).isEqualTo(404);
    assertThat(get("/api/v1/employees", token).statusCode()).isEqualTo(200);
  }

  @Test
  void employeesCannotListOfficers() throws Exception {
    assertThat(get("/api/v1/employees", login("t.nakamura")).statusCode()).isEqualTo(403);
  }
}
