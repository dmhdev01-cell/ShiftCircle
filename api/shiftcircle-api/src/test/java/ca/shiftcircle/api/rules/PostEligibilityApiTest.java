package ca.shiftcircle.api.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
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
 * Release v1.3 S2, owner item 17: who can work a post, through the real rule check (docs/07 §3) and
 * the real maker/checker pipeline (docs/07 §4.7).
 *
 * <p>The demo has no supervisor post and no supervisor yet (they arrive with the datasets in S4),
 * so this class adds one post, one supervisor and two officers to its own database.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class PostEligibilityApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID POST = UUID.fromString("11111111-1111-1111-1111-0000000000a7");
  private static final UUID SUPERVISOR = UUID.fromString("88888888-8888-8888-8888-0000000000c1");
  private static final UUID OFFICER = UUID.fromString("88888888-8888-8888-8888-0000000000c2");
  private static final UUID ACTING = UUID.fromString("88888888-8888-8888-8888-0000000000c3");

  @BeforeEach
  void fixture() throws Exception {
    jdbc.update(
        "INSERT INTO unit (id, code, name, kind, allows_12h, allows_16h)"
            + " VALUES (?, 'SUP-T', 'Supervision · Test', 'SUPERVISION', true, false)"
            + " ON CONFLICT (id) DO NOTHING",
        POST);
    employee(SUPERVISOR, "S-T01", "Sam", "Visor", POST, "CS");
    employee(OFFICER, "E-T01", "Olu", "Fisher", UNIT_B, "CO");
    employee(ACTING, "E-T02", "Ada", "Acting", UNIT_B, "CO");
    jdbc.update(
        "INSERT INTO employee_qualification (employee_id, qualification_id, valid_from)"
            + " SELECT ?, id, DATE '2020-01-01' FROM qualification WHERE code = 'ACTING_SUP'"
            + " ON CONFLICT DO NOTHING",
        ACTING);
    jdbc.update(
        "INSERT INTO user_unit_scope (user_id, unit_id)"
            + " SELECT id, ? FROM app_user WHERE username = 'm.ellis' ON CONFLICT DO NOTHING",
        POST);
    for (String user : List.of("m.ellis", "l.fraser", "p.singh")) {
      tokens.put(user, login(user));
    }
  }

  private void employee(UUID id, String number, String first, String last, UUID home, String rank) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date,"
            + " classification) VALUES (?, ?, ?, ?, ?, DATE '2012-01-01', ?)"
            + " ON CONFLICT (id) DO NOTHING",
        id,
        number,
        first,
        last,
        home,
        rank);
  }

  @Test
  void anOfficerOnASupervisorPostIsBlockedWithNoOverrideOffered() throws Exception {
    Map<String, Object> outcome = check(OFFICER, POST);
    assertThat(outcome.get("outcome")).isEqualTo("BLOCK");
    assertThat(outcome.get("overridable")).as("R-01 has no override").isEqualTo(false);
    assertThat(post(outcome))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.get("ruleCode")).isEqualTo("R-01");
              assertThat(result.get("ruleTable")).isEqualTo("POSTS");
              assertThat(result.get("overridePolicy")).isEqualTo("NONE");
            });
  }

  @Test
  void anActingOfficerOnASupervisorPostIsAWarning() throws Exception {
    Map<String, Object> outcome = check(ACTING, POST);
    assertThat(outcome.get("outcome")).isEqualTo("WARN");
    assertThat(post(outcome))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.get("ruleCode")).isEqualTo("R-01");
              assertThat(result.get("outcome")).isEqualTo("WARN");
              assertThat(result.get("overridePolicy")).isEqualTo("ACKNOWLEDGE");
            });
  }

  @Test
  void aSupervisorOnAnOfficerPostIsAWarningAndOnTheirOwnPostPasses() throws Exception {
    Map<String, Object> line = check(SUPERVISOR, UNIT_B);
    assertThat(line.get("outcome")).isEqualTo("WARN");
    assertThat(post(line))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.get("ruleCode")).isEqualTo("R-02");
              assertThat(result.get("overridePolicy")).isEqualTo("ACKNOWLEDGE");
            });

    Map<String, Object> own = check(SUPERVISOR, POST);
    assertThat(own.get("outcome")).isEqualTo("PASS");
    assertThat(post(own)).isEmpty();
  }

  @Test
  void anOfficerOnAnOfficerPostIsUnaffected() throws Exception {
    Map<String, Object> outcome = check(OFFICER, UNIT_B);
    assertThat(outcome.get("outcome")).isEqualTo("PASS");
    assertThat(post(outcome)).isEmpty();
  }

  @Test
  @SuppressWarnings("unchecked")
  void theRulesAdminChangesTheTableThroughMakerChecker() throws Exception {
    Integer live =
        jdbc.queryForObject(
            "SELECT version FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
    assertThat(live).isEqualTo(4);

    // The screen's table: the posts slug resolves, with its own column headings and sentences.
    Map<String, Object> table = json(send("GET", "/api/v1/rule-sets/4/tables/posts", null, "l.fraser"));
    assertThat(table.get("code")).isEqualTo("POSTS");
    assertThat(table.get("name")).isEqualTo("Who can work a post");
    assertThat(((Map<String, Object>) table.get("columns")).get("after")).isEqualTo("Post");
    assertThat(((Map<String, Object>) table.get("columns")).get("hours"))
        .isEqualTo("Who can work it");
    List<Map<String, Object>> rows = (List<Map<String, Object>>) table.get("rows");
    assertThat(rows).extracting(row -> row.get("ruleCode")).containsExactly("R-01", "R-02");
    assertThat(rows.get(0).get("sentence"))
        .isEqualTo(
            "Only supervisors can work a supervisor post; anyone else is blocked. It cannot be"
                + " overridden. Someone with the Acting supervisor qualification is warned"
                + " instead, and a supervisor must acknowledge it.");

    // Maker: acting officers may no longer work a supervisor post.
    HttpResponse<String> created =
        send(
            "POST",
            "/api/v1/rule-sets/drafts",
            "{\"basedOn\":4,\"reason\":\"No acting supervisors\"}",
            "l.fraser");
    assertThat(created.statusCode()).isEqualTo(201);
    int draft = ((Number) json(created).get("version")).intValue();
    Map<String, Object> editable =
        json(send("GET", "/api/v1/rule-sets/" + draft + "/tables/posts", null, "l.fraser"));
    Map<String, Object> r01 =
        ((List<Map<String, Object>>) editable.get("rows"))
            .stream().filter(row -> "R-01".equals(row.get("ruleCode"))).findFirst().orElseThrow();
    ((Map<String, Object>) r01.get("params")).put("actingQualification", null);
    String body = mapper.writeValueAsString(Map.of("rows", editable.get("rows")));
    assertThat(
            send("PUT", "/api/v1/rule-sets/" + draft + "/tables/posts/rows", body, "l.fraser")
                .statusCode())
        .isEqualTo(200);

    Map<String, Object> report =
        json(send("POST", "/api/v1/rule-sets/" + draft + "/build", null, "l.fraser"));
    assertThat((List<Map<String, Object>>) report.get("steps"))
        .allSatisfy(step -> assertThat((Boolean) step.get("done")).isTrue());
    assertThat(send("POST", "/api/v1/rule-sets/" + draft + "/submit", null, "l.fraser").statusCode())
        .isEqualTo(200);
    // Checker: the author cannot approve their own change; another approver does.
    assertThat(send("POST", "/api/v1/rule-sets/" + draft + "/approve", null, "p.singh").statusCode())
        .isEqualTo(200);
    assertThat(
            send(
                    "POST",
                    "/api/v1/rule-sets/" + draft + "/publish",
                    "{\"effectiveDate\":\"2026-11-25\"}",
                    "p.singh")
                .statusCode())
        .isEqualTo(200);

    Map<String, Object> after = check(ACTING, POST);
    assertThat(after.get("outcome")).as("the published edit applies with no code change")
        .isEqualTo("BLOCK");
    assertThat(after.get("ruleSetVersion")).isEqualTo(draft);
  }

  // -------------------------------------------------------------------------------------------

  @SuppressWarnings("unchecked")
  private Map<String, Object> check(UUID employee, UUID unit) throws Exception {
    String body =
        "{\"change\":{\"employeeId\":\""
            + employee
            + "\",\"unitId\":\""
            + unit
            + "\",\"shiftTemplate\":\"D8\",\"startAt\":\"2027-02-01T07:00:00-06:00\"}}";
    HttpResponse<String> response = send("POST", "/api/v1/rule-checks", body, "m.ellis");
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return json(response);
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> post(Map<String, Object> outcome) {
    return ((List<Map<String, Object>>) outcome.get("ruleResults"))
        .stream().filter(result -> "POSTS".equals(result.get("ruleTable"))).toList();
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

  private HttpResponse<String> send(String method, String path, String body, String user)
      throws Exception {
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
    builder.header("Authorization", "Bearer " + tokens.get(user));
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }
}
