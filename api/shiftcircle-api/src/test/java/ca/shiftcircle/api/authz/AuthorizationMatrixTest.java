package ca.shiftcircle.api.authz;

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
 * One row per role for every endpoint that exists today (docs/09 §2). Cells that belong to endpoints
 * from later steps (overtime, time and payroll, rules admin, proposals, reports) are covered when
 * those endpoints land; this class is the pattern for them.
 *
 * <p>Expectations: 401 anonymous, 403 wrong role, 404 out of scope (never 403, so the API does not
 * reveal that another unit exists), 200/422/201 as the capability allows.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class AuthorizationMatrixTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID UNIT_C = UUID.fromString("11111111-1111-1111-1111-000000000003");
  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000009");
  private static final UUID ADM_EMPLOYEE =
      UUID.fromString("33333333-3333-3333-3333-0000000000ad");
  private static final java.time.LocalDate DAY = java.time.LocalDate.of(2026, 11, 18);

  @BeforeEach
  void fixtureAndLogins() throws Exception {
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-AZ', 'Scope', 'Officer', ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT_A);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-ADM', 'Admitted', 'Officer',"
            + " (SELECT id FROM unit WHERE code = 'ADM'), DATE '2020-01-01')"
            + " ON CONFLICT DO NOTHING",
        ADM_EMPLOYEE);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT"
            + " '66666666-6666-6666-6666-000000000001', ?, ?, t.id,"
            + " TIMESTAMPTZ '2026-11-18 07:00:00-06', TIMESTAMPTZ '2026-11-18 15:00:00-06',"
            + " DATE '2026-11-18', 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'D8'"
            + " ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT_A);
    // A previous class may have linked this demo employee. The authz expectations are about the
    // unlinked employee, so reset it before minting the tokens.
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username = 't.nakamura'");

    for (String user :
        new String[] {
          "m.ellis", "j.chen", "t.nakamura", "l.fraser", "p.singh", "a.reviewer", "tv.display"
        }) {
      tokens.put(user, login(user));
    }
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

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
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

  private String schedulePath() {
    return "/api/v1/schedule?unitId=" + UNIT_A + "&from=" + DAY + "&to=" + DAY;
  }

  @Test
  void planningBoardAccess() throws Exception {
    assertThat(send("GET", schedulePath(), null, tokens.get("m.ellis")).statusCode()).isEqualTo(200);
    assertThat(send("GET", schedulePath(), null, tokens.get("a.reviewer")).statusCode())
        .isEqualTo(200);
    assertThat(send("GET", schedulePath(), null, tokens.get("j.chen")).statusCode())
        .as("out of scope answers 404, not 403").isEqualTo(404);
    for (String role : new String[] {"t.nakamura", "l.fraser", "p.singh", "tv.display"}) {
      assertThat(send("GET", schedulePath(), null, tokens.get(role)).statusCode())
          .as(role + " is not a supervisor or auditor")
          .isEqualTo(403);
    }
    assertThat(send("GET", schedulePath(), null, null).statusCode()).isEqualTo(401);
  }

  @Test
  void assignmentWriteAccess() throws Exception {
    String body =
        "{\"change\":{\"employeeId\":\""
            + EMPLOYEE
            + "\",\"unitId\":\""
            + UNIT_A
            + "\",\"shiftTemplate\":\"D8\",\"startAt\":\"2026-11-25T07:00:00-06:00\"}}";

    assertThat(send("POST", "/api/v1/assignments", body, tokens.get("m.ellis")).statusCode())
        .isIn(201, 422);
    assertThat(send("POST", "/api/v1/assignments", body, tokens.get("j.chen")).statusCode())
        .isEqualTo(404);
    for (String role : new String[] {"t.nakamura", "l.fraser", "p.singh", "a.reviewer",
        "tv.display"}) {
      assertThat(send("POST", "/api/v1/assignments", body, tokens.get(role)).statusCode())
          .as(role + " may not assign shifts")
          .isEqualTo(403);
    }
    assertThat(send("POST", "/api/v1/assignments", body, null).statusCode()).isEqualTo(401);
  }

  @Test
  void rulePreviewAccess() throws Exception {
    String ownPreview =
        "{\"change\":{\"employeeId\":\""
            + EMPLOYEE
            + "\",\"unitId\":\""
            + UNIT_A
            + "\",\"shiftTemplate\":\"D8\",\"startAt\":\"2026-11-24T07:00:00-06:00\"}}";

    assertThat(send("POST", "/api/v1/rule-checks", ownPreview, tokens.get("m.ellis")).statusCode())
        .isEqualTo(200);
    // A supervisor may preview only inside their unit scope (docs/09 §2): 404, never 403.
    String unitBPreview = ownPreview.replace(UNIT_A.toString(), UNIT_B.toString());
    String unitCPreview = ownPreview.replace(UNIT_A.toString(), UNIT_C.toString());
    assertThat(send("POST", "/api/v1/rule-checks", unitBPreview, tokens.get("j.chen")).statusCode())
        .as("j.chen has no Unit B scope")
        .isEqualTo(404);
    assertThat(send("POST", "/api/v1/rule-checks", unitCPreview, tokens.get("m.ellis")).statusCode())
        .as("m.ellis has no Unit C scope")
        .isEqualTo(404);
    assertThat(send("POST", "/api/v1/rule-checks", unitBPreview, tokens.get("m.ellis")).statusCode())
        .as("m.ellis does have Unit B scope")
        .isEqualTo(200);
    // An employee can preview only against themselves; this employee link is not set.
    assertThat(send("POST", "/api/v1/rule-checks", ownPreview, tokens.get("t.nakamura")).statusCode())
        .isEqualTo(404);
    for (String role : new String[] {"l.fraser", "p.singh", "a.reviewer", "tv.display"}) {
      assertThat(send("POST", "/api/v1/rule-checks", ownPreview, tokens.get(role)).statusCode())
          .as(role + " is not a supervisor or employee")
          .isEqualTo(403);
    }
    assertThat(send("POST", "/api/v1/rule-checks", ownPreview, null).statusCode()).isEqualTo(401);
  }

  @Test
  void identityEndpointIsForEverySignedInRole() throws Exception {
    for (Map.Entry<String, String> token : tokens.entrySet()) {
      assertThat(send("GET", "/api/v1/me", null, token.getValue()).statusCode())
          .as(token.getKey())
          .isEqualTo(200);
    }
    assertThat(send("GET", "/api/v1/me", null, null).statusCode()).isEqualTo(401);
  }

  @Test
  void supervisorScopeIsCarriedInTheIdentity() throws Exception {
    Map<?, ?> ellis = mapper.readValue(send("GET", "/api/v1/me", null, tokens.get("m.ellis")).body(),
        Map.class);
    Map<?, ?> chen = mapper.readValue(send("GET", "/api/v1/me", null, tokens.get("j.chen")).body(),
        Map.class);

    @SuppressWarnings("unchecked")
    java.util.List<String> ellisUnits = (java.util.List<String>) ellis.get("units");
    @SuppressWarnings("unchecked")
    java.util.List<String> chenUnits = (java.util.List<String>) chen.get("units");
    assertThat(ellisUnits).containsExactly("A", "B");
    assertThat(chenUnits).containsExactly("ADM", "CTL", "ESC");
    assertThat(UNIT_A.toString()).isNotBlank();
    assertThat(UNIT_B.toString()).isNotBlank();
  }

  @Test
  void rulesAdminCells() throws Exception {
    assertThat(send("GET", "/api/v1/rule-sets", null, tokens.get("m.ellis")).statusCode())
        .as("a supervisor may read rule versions")
        .isEqualTo(200);
    assertThat(send("GET", "/api/v1/rule-sets", null, tokens.get("t.nakamura")).statusCode())
        .isEqualTo(403);
    assertThat(send("GET", "/api/v1/rule-sets", null, null).statusCode()).isEqualTo(401);

    String draft = "{\"basedOn\":1,\"reason\":\"matrix cell\"}";
    assertThat(send("POST", "/api/v1/rule-sets/drafts", draft, tokens.get("m.ellis")).statusCode())
        .as("a supervisor cannot edit rule drafts")
        .isEqualTo(403);
    assertThat(send("POST", "/api/v1/rule-sets/drafts", draft, tokens.get("p.singh")).statusCode())
        .as("an approver cannot edit drafts")
        .isEqualTo(403);
    assertThat(send("POST", "/api/v1/rule-sets/1/approve", null, tokens.get("a.reviewer"))
            .statusCode())
        .as("an auditor cannot approve")
        .isEqualTo(403);
    assertThat(send("POST", "/api/v1/rule-sets/1/publish", null, tokens.get("a.reviewer"))
            .statusCode())
        .as("an auditor cannot publish")
        .isEqualTo(403);
  }

  @Test
  void overtimeAndOwnScheduleCells() throws Exception {
    String openShifts = "/api/v1/open-shifts?from=2026-11-01&to=2026-11-30";
    assertThat(send("GET", openShifts, null, tokens.get("m.ellis")).statusCode()).isEqualTo(200);
    for (String role : new String[] {"t.nakamura", "l.fraser", "p.singh", "a.reviewer",
        "tv.display"}) {
      assertThat(send("GET", openShifts, null, tokens.get(role)).statusCode())
          .as(role + " may not read the overtime board")
          .isEqualTo(403);
    }
    assertThat(send("GET", openShifts, null, null).statusCode()).isEqualTo(401);

    String offers = "{\"employeeIds\":[\"" + EMPLOYEE + "\"],\"ordered\":false}";
    String shift = "/api/v1/open-shifts/00000000-0000-0000-0000-000000000001";
    assertThat(send("POST", shift + "/offers", offers, tokens.get("t.nakamura")).statusCode())
        .as("an employee cannot send overtime offers (S-04)")
        .isEqualTo(403);
    assertThat(
            send("POST", shift + "/assign", "{\"employeeId\":\"" + EMPLOYEE + "\"}",
                tokens.get("t.nakamura"))
                .statusCode())
        .as("an employee cannot assign overtime directly (S-04)")
        .isEqualTo(403);
    assertThat(send("POST", shift + "/offers", offers, null).statusCode()).isEqualTo(401);

    // Own data only: with no linked officer the endpoints answer an empty list / 404, and never
    // another officer's rows. Mint a token after the link is removed; a token minted earlier still
    // carries the old employee id, which is exactly the leak this test used to miss.
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username = 't.nakamura'");
    String unlinked = login("t.nakamura");
    assertThat(send("GET", "/api/v1/me/offers", null, unlinked).statusCode())
        .isEqualTo(200);
    assertThat((java.util.List<?>) mapper.readValue(
            send("GET", "/api/v1/me/offers", null, unlinked).body(), java.util.List.class))
        .isEmpty();
    assertThat(send("GET", "/api/v1/me/schedule", null, unlinked).statusCode()).isEqualTo(404);
    assertThat(send("GET", "/api/v1/me/schedule", null, null).statusCode()).isEqualTo(401);
  }


  @Test
  void extraShiftsAreASeparateSupervisorActionAndAreAudited() throws Exception {
    String body =
        "{\"change\":{\"employeeId\":\""
            + EMPLOYEE
            + "\",\"unitId\":\""
            + UNIT_A
            + "\",\"shiftTemplate\":\"D8\",\"type\":\"EXTRA\","
            + "\"startAt\":\"2026-11-26T07:00:00-06:00\"}}";
    String token = tokens.get("m.ellis");

    HttpResponse<String> response = send("POST", "/api/v1/rule-checks", body, token);
    assertThat(response.statusCode()).isEqualTo(200);

    // S-04: an employee cannot create an extra shift, a supervisor can, and it is audited.
    assertThat(send("POST", "/api/v1/assignments", body, tokens.get("t.nakamura")).statusCode())
        .isEqualTo(403);
    HttpResponse<String> saved = send("POST", "/api/v1/assignments", body, token);
    assertThat(saved.statusCode()).isIn(201, 422);
    if (saved.statusCode() == 201) {
      Integer audited =
          jdbc.queryForObject(
              "SELECT count(*) FROM audit_event WHERE action = 'assign_shift'"
                  + " AND after->>'kind' = 'EXTRA'",
              Integer.class);
      assertThat(audited).isGreaterThanOrEqualTo(1);
    }
  }

  @Test
  void theEmployeeListIsScopedWhenNoUnitIsGiven() throws Exception {
    List<Map<String, Object>> ellis = employees("m.ellis");
    assertThat(ellis).anyMatch(employee -> "A".equals(employee.get("home_unit")));
    assertThat(ellis)
        .as("a supervisor does not see the whole roster (docs/09 §3)")
        .noneMatch(employee -> "ADM".equals(employee.get("home_unit")));

    List<Map<String, Object>> chen = employees("j.chen");
    assertThat(chen).anyMatch(employee -> "ADM".equals(employee.get("home_unit")));
    assertThat(chen).noneMatch(employee -> "A".equals(employee.get("home_unit")));

    List<Map<String, Object>> auditor = employees("a.reviewer");
    assertThat(auditor).anyMatch(employee -> "A".equals(employee.get("home_unit")));
    assertThat(auditor).anyMatch(employee -> "ADM".equals(employee.get("home_unit")));

    assertThat(send("GET", "/api/v1/employees?unitId=" + UNIT_C, null, tokens.get("m.ellis"))
            .statusCode())
        .as("a unit outside the caller's scope answers 404")
        .isEqualTo(404);
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> employees(String user) throws Exception {
    HttpResponse<String> response = send("GET", "/api/v1/employees", null, tokens.get(user));
    assertThat(response.statusCode()).isEqualTo(200);
    return mapper.readValue(response.body(), List.class);
  }
}
