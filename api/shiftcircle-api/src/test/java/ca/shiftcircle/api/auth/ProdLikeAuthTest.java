package ca.shiftcircle.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The prod-like profile must not expose mock sign-in (docs/09 §4). */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("prod-like")
class ProdLikeAuthTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private Environment environment;

  private HttpResponse<String> get(String path) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    return HttpClient.newHttpClient()
        .send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString());
  }

  @Test
  void mockSignInDoesNotExist() throws Exception {
    assertThat(get("/api/v1/auth/demo-users").statusCode()).isEqualTo(404);
  }

  @Test
  void protectedEndpointsStillRefuseAnonymousCallers() throws Exception {
    assertThat(get("/api/v1/me").statusCode()).isEqualTo(401);
  }
}
