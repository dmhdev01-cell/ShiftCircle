package ca.shiftcircle.api.problems;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import ca.shiftcircle.api.schedule.ScheduleQuery;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

/**
 * Every error body is RFC 9457 problem+json, whatever went wrong.
 *
 * <p>The advice that holds the catch-all is consulted last, so the other advices still answer their
 * own exceptions. That order is the whole point of this test: a catch-all in the wrong place would
 * turn a rule refusal or a role refusal into a 500.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
@ExtendWith(OutputCaptureExtension.class)
class UnexpectedFailureApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  /** The board service is replaced so one call can fail the way an unexpected fault would. */
  @MockitoBean private ScheduleQuery scheduleQuery;

  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");

  @Test
  void anUnexpectedFailureAnswersAProblemDocumentWithoutInternals(CapturedOutput output)
      throws Exception {
    when(scheduleQuery.unitCode(any())).thenReturn("A");
    when(scheduleQuery.forUnit(any(), any(), any()))
        .thenThrow(new IllegalStateException("the internal detail that must not leak"));

    HttpResponse<String> response =
        get("/api/v1/schedule?unitId=" + UNIT_A + "&from=2026-11-16&to=2026-11-22", "m.ellis");

    assertThat(response.statusCode()).isEqualTo(500);
    assertThat(response.headers().firstValue("Content-Type")).contains("application/problem+json");
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("status")).isEqualTo(500);
    assertThat(body.get("title").toString()).isNotBlank();
    assertThat(response.body())
        .doesNotContain("the internal detail")
        .doesNotContain("IllegalStateException")
        .doesNotContain("at ca.shiftcircle")
        .doesNotContain("org.springframework");

    // Hiding the failure from the operator too would be worse than a raw 500: the same request
    // must leave an ERROR with the exception and stack, tied to the id the caller can quote.
    String traceId = (String) body.get("traceId");
    assertThat(traceId).as("the caller gets a correlation id").isNotBlank();
    assertThat(output)
        .as("the operator can find this exact failure in the log")
        .contains("unexpected failure")
        .contains("traceId=" + traceId)
        .contains("IllegalStateException")
        .contains("the internal detail that must not leak");
  }

  @Test
  void springWebFailuresKeepTheirOwnStatus() throws Exception {
    // A wrong verb is Spring's own exception and it knows its status (405). The catch-all must not
    // turn it into a 500.
    HttpResponse<String> response =
        send("POST", "/api/v1/schedule?unitId=" + UNIT_A + "&from=2026-11-16&to=2026-11-22",
            "m.ellis", null);

    assertThat(response.statusCode()).isEqualTo(405);
    assertThat(response.headers().firstValue("Content-Type")).contains("application/problem+json");
    assertThat((Integer) mapper.readValue(response.body(), Map.class).get("status")).isEqualTo(405);
  }

  @Test
  void aRoleRefusalKeepsItsStatusAndGetsAProblemBody() throws Exception {
    // The role check runs inside the controller, so the advice answers it. It must stay a 403 and
    // not become a 500, and it must not be empty.
    HttpResponse<String> response =
        send(
            "POST",
            "/api/v1/assignments",
            "t.nakamura",
            "{\"change\":{\"employeeId\":\"" + UUID.randomUUID() + "\"}}");

    assertThat(response.statusCode()).isEqualTo(403);
    assertThat(response.headers().firstValue("Content-Type")).contains("application/problem+json");
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("status")).isEqualTo(403);
    assertThat(body.get("title").toString()).isNotBlank();
  }

  private HttpResponse<String> get(String path, String user) throws Exception {
    return send("GET", path, user, null);
  }

  private HttpResponse<String> send(String method, String path, String user, String body)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body == null) {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    }
    if (user != null) {
      builder.header("Authorization", "Bearer " + login(user));
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
    assertThat(response.statusCode()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }
}
