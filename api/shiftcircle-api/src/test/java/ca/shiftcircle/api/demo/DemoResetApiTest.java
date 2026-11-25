package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.infrastructure.demo.DemoChecksum;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * The demo reset (person's request): empties and reloads the exact seeded dataset, twice, leaves
 * the first audit row, and is guarded by the demo profile and the PLANNER role.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("demo")
class DemoResetApiTest {

  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine")
          .withDatabaseName("shiftcircle")
          .withUrlParam("connectTimeout", "30");

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
  }

  /** Release v1.3 (S4): the 100 officers plus their 10 supervisors. */
  private static final String CHECKSUM =
      "beb2e222b8c9100c98d329e37f5ffcf670f81d0083045d84f179f7f0681ab7d1";
  /** The pre-S4 checksum, which the officers alone still produce. */
  private static final String OFFICER_CHECKSUM =
      "4156077d76d41bd5fcf6d6a9a0f51111e9007d16c8a0c6b311e09c6fe801da6b";

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  @BeforeAll
  void logins() throws Exception {
    tokens.put("p.planner", login("p.planner"));
    tokens.put("m.ellis", login("m.ellis"));
    tokens.put("a.reviewer", login("a.reviewer"));
  }

  @Test
  void resetsTwiceToTheSameSeededStateAndAuditsIt() throws Exception {
    // A planner draft exists before the reset and must be gone afterwards.
    assertThat(
            send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}",
                    tokens.get("p.planner"))
                .statusCode())
        .isEqualTo(201);
    assertThat(
            jdbc.queryForObject("SELECT count(*) FROM plan_draft", Integer.class))
        .isGreaterThan(0);

    for (int round = 0; round < 2; round++) {
      HttpResponse<String> started =
          send("POST", "/api/v1/demo/reset",
              "{\"confirm\":\"RESET\",\"dataset\":\"100\"}", tokens.get("p.planner"));
      assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
      Map<String, Object> done = awaitDone();
      System.out.println("RESET elapsedMs=" + done.get("elapsedMs") + " checksum=" + done.get("checksum"));
      assertThat(done.get("state")).isEqualTo("DONE");
      assertThat(done.get("checksum")).isEqualTo(CHECKSUM);
      // V6 adds D12/N12 templates; the 100 seed keeps its A12/P12 roster (L16 was retired in
      // release 5 and the template is inactive). The checksum above is the proof; these pin the
      // isolation directly.
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM shift_template WHERE code IN ('D12','N12')", Integer.class))
          .isEqualTo(2);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM shift_assignment s JOIN shift_template t"
                  + " ON t.id = s.shift_template_id WHERE t.code IN ('D12','N12')",
              Integer.class))
          .isZero();
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM unit WHERE code IN ('ADM','ESC') AND allows_12h",
              Integer.class))
          .isZero();
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM shift_assignment s JOIN shift_template t"
                  + " ON t.id = s.shift_template_id WHERE t.code = 'L16'",
              Integer.class))
          .isZero();
      assertThat(jdbc.queryForObject(
              "SELECT active FROM shift_template WHERE code = 'L16'", Boolean.class))
          .isFalse();

      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee WHERE classification = 'CO'", Integer.class))
          .isEqualTo(100);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee WHERE classification = 'CS'", Integer.class))
          .as("10 supervisors, 5 per post")
          .isEqualTo(10);
      assertThat(jdbc.queryForList(
              "SELECT a.username || '=' || e.employee_no FROM app_user a"
                  + " JOIN employee e ON e.id = a.employee_id ORDER BY a.username",
              String.class))
          .as("the demo sign-ins with an employee record")
          .containsExactly("j.chen=S-006", "m.ellis=S-001", "t.nakamura=E-001");
      assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user", Integer.class))
          .isEqualTo(8);
      assertThat(jdbc.queryForObject("SELECT count(*) FROM plan_draft", Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM pay_period WHERE start_date >= DATE '2027-01-04'",
                  Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM schedule_period WHERE start_date >= DATE '2027-01-04'",
                  Integer.class))
          .isZero();
      assertThat(DemoChecksum.of(jdbc)).isEqualTo(CHECKSUM);
      assertThat(DemoChecksum.officersOnly(jdbc))
          .as("the officers' roster is the pre-supervisor roster")
          .isEqualTo(OFFICER_CHECKSUM);
      assertThat(
              jdbc.queryForObject(
                  "SELECT action FROM audit_event ORDER BY id LIMIT 1", String.class))
          .isEqualTo("demo_reset");
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM audit_event WHERE action = 'demo_reset'",
                  Integer.class))
          .isEqualTo(1);
    }

    byte[] bytes =
        getClass().getResourceAsStream("/payroll/pc05-2026-10-26.csv").readAllBytes();
    assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)))
        .isEqualTo("b946ef1f9f3d3529bd826e41a9452fe35633d9e1ee38e7d79d7a70732bc200e6");
  }

  @Test
  void guardsTheReset() throws Exception {
    assertThat(send("POST", "/api/v1/demo/reset",
            "{\"confirm\":\"yes\",\"dataset\":\"100\"}", tokens.get("p.planner")).statusCode())
        .isEqualTo(400);
    assertThat(send("POST", "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"400\"}", tokens.get("p.planner")).statusCode())
        .isEqualTo(400);
    assertThat(send("POST", "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\"}", tokens.get("m.ellis")).statusCode())
        .isEqualTo(403);
    assertThat(send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\"}", null).statusCode())
        .isEqualTo(401);
    assertThat(send("GET", "/api/v1/demo/reset/status", null, tokens.get("a.reviewer"))
            .statusCode())
        .isEqualTo(403);
    assertThat(
            mapper.readValue(
                    send("GET", "/api/v1/version", null, null).body(), Map.class)
                .get("demoMode"))
        .isEqualTo(true);
  }

  private Map<String, Object> awaitDone() throws Exception {
    long deadline = System.nanoTime() + 180_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, tokens.get("p.planner")).body(),
              Map.class);
      if ("DONE".equals(status.get("state"))) {
        return status;
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError("demo reset failed: " + status);
      }
      Thread.sleep(500);
    }
    throw new AssertionError("demo reset did not finish in 180 s");
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
    assertThat(response.statusCode()).as("login for %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder.header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
