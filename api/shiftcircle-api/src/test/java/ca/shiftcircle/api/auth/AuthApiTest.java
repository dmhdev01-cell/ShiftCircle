package ca.shiftcircle.api.auth;

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
import tools.jackson.databind.ObjectMapper;

/**
 * Mock sign-in and token handling (docs/09 §4): list the demo users, log in, use the token, and be
 * refused without one. The demo profile is on here, so the generator is switched off.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class AuthApiTest {

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

  private HttpResponse<String> post(String path, String body, String token) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body));
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private String login(String username) throws Exception {
    HttpResponse<String> response =
        post("/api/v1/auth/mock-login", "{\"userId\":\"" + username + "\"}", null);
    assertThat(response.statusCode()).isEqualTo(200);
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    return (String) body.get("token");
  }

  @Test
  void listsTheSevenDemoUsers() throws Exception {
    HttpResponse<String> response = get("/api/v1/auth/demo-users", null);

    assertThat(response.statusCode()).isEqualTo(200);
    var users = mapper.readValue(response.body(), java.util.List.class);
    assertThat(users).hasSize(7);
  }

  @Test
  void signingInReturnsATokenCarryingRolesAndUnits() throws Exception {
    String token = login("m.ellis");
    HttpResponse<String> me = get("/api/v1/me", token);

    assertThat(me.statusCode()).isEqualTo(200);
    Map<?, ?> body = mapper.readValue(me.body(), Map.class);
    assertThat(body.get("username")).isEqualTo("m.ellis");
    @SuppressWarnings("unchecked")
    java.util.List<String> roles = (java.util.List<String>) body.get("roles");
    @SuppressWarnings("unchecked")
    java.util.List<String> units = (java.util.List<String>) body.get("units");
    assertThat(roles).containsExactlyInAnyOrder("SUPERVISOR", "EMPLOYEE");
    assertThat(units).containsExactly("A", "B");
  }

  @Test
  void signingInAlsoWorksWithTheUserId() throws Exception {
    HttpResponse<String> users = get("/api/v1/auth/demo-users", null);
    var list = mapper.readValue(users.body(), java.util.List.class);
    Map<?, ?> first = (Map<?, ?>) list.get(0);

    HttpResponse<String> response =
        post(
            "/api/v1/auth/mock-login",
            "{\"userId\":\"" + first.get("id") + "\"}",
            null);

    assertThat(response.statusCode()).isEqualTo(200);
  }

  @Test
  void noTokenIsUnauthorized() throws Exception {
    assertThat(get("/api/v1/me", null).statusCode()).isEqualTo(401);
  }

  @Test
  void aTamperedTokenIsRejected() throws Exception {
    String token = login("m.ellis");
    String tampered = token.substring(0, token.length() - 2) + "xx";

    assertThat(get("/api/v1/me", tampered).statusCode()).isEqualTo(401);
  }

  @Test
  void aValidlySignedTokenWithHostileClaimsIsUnauthorizedNotServerError() throws Exception {
    // Signed with the real key but without an expiry: must be 401, never 500 (review A1).
    String header = java.util.Base64.getUrlEncoder().withoutPadding()
        .encodeToString("{\"alg\":\"HS256\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    String body = java.util.Base64.getUrlEncoder().withoutPadding()
        .encodeToString("{\"sub\":\"m.ellis\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
    mac.init(new javax.crypto.spec.SecretKeySpec(
        "test-jwt-secret-that-is-at-least-32-bytes-long"
            .getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
    String token = header + "." + body + "." + java.util.Base64.getUrlEncoder().withoutPadding()
        .encodeToString(mac.doFinal((header + "." + body)
            .getBytes(java.nio.charset.StandardCharsets.UTF_8)));

    assertThat(get("/api/v1/me", token).statusCode()).isEqualTo(401);
  }

  @Test
  void anUnknownDemoUserIsNotFound() throws Exception {
    assertThat(post("/api/v1/auth/mock-login", "{\"userId\":\"nobody\"}", null).statusCode())
        .isEqualTo(404);
  }

  @Test
  void loginRequiresAUserId() throws Exception {
    assertThat(post("/api/v1/auth/mock-login", "{}", null).statusCode()).isEqualTo(400);
  }
}
