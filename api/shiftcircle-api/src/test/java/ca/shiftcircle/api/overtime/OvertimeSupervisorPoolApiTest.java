package ca.shiftcircle.api.overtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
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
 * Release v1.3 S5: separate overtime pools by position (plan §2.6, §4 S5; owner answer Q4).
 *
 * <p>A supervisor post is offered to supervisors (fewest overtime hours this quarter, then
 * seniority <em>as a supervisor</em>), then to officers who hold Acting supervisor, ranked after
 * every supervisor and warned by R-01. An officer post is offered to officers only: a supervisor
 * is neither listed nor offered it. The fixture replaces the demo dataset so every rank is exact.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class OvertimeSupervisorPoolApiTest {

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
  private static final UUID SUP_L = UUID.fromString("11111111-1111-1111-1111-000000000007");
  private static final UUID SUP_O = UUID.fromString("11111111-1111-1111-1111-000000000008");

  /** 30 years' service, a supervisor only since 2022: junior among supervisors. */
  private static final UUID LONG_SERVICE = UUID.fromString("46666666-4444-4444-4444-000000000001");
  /** Less service (2010) but a supervisor since 2018: senior among supervisors. */
  private static final UUID SENIOR_SUP = UUID.fromString("46666666-4444-4444-4444-000000000002");
  /** The most senior supervisor, but with overtime this quarter. */
  private static final UUID BUSY_SUP = UUID.fromString("46666666-4444-4444-4444-000000000003");
  /** An officer with Acting supervisor, no overtime and long service. */
  private static final UUID ACTING = UUID.fromString("46666666-4444-4444-4444-000000000004");
  /** An officer without Acting supervisor. */
  private static final UUID PLAIN = UUID.fromString("46666666-4444-4444-4444-000000000005");
  /** A supervisor on the other post, linked to j.chen for the end-to-end offer. */
  private static final UUID CHEN = UUID.fromString("46666666-4444-4444-4444-000000000006");

  private static final List<UUID> EMPLOYEES =
      List.of(LONG_SERVICE, SENIOR_SUP, BUSY_SUP, ACTING, PLAIN, CHEN);

  private static final UUID PERIOD = UUID.fromString("56666666-5555-5555-5555-000000000010");
  private static final UUID POST_DAY = UUID.fromString("56666666-5555-5555-5555-000000000001");
  private static final UUID B_DAY = UUID.fromString("56666666-5555-5555-5555-000000000002");

  @BeforeEach
  void fixture() throws Exception {
    jdbc.update("DELETE FROM overtime_offer WHERE open_shift_id IN (?, ?)", POST_DAY, B_DAY);
    jdbc.update("UPDATE open_shift SET filled_assignment_id = NULL WHERE id IN (?, ?)",
        POST_DAY, B_DAY);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id IN (?, ?, ?, ?, ?, ?)",
        (Object[]) EMPLOYEES.toArray());
    jdbc.update("DELETE FROM open_shift WHERE id IN (?, ?)", POST_DAY, B_DAY);
    jdbc.update("DELETE FROM time_entry WHERE employee_id IN (?, ?, ?, ?, ?, ?)",
        (Object[]) EMPLOYEES.toArray());
    jdbc.update(
        "DELETE FROM pay_period WHERE daterange(start_date, end_date, '[]')"
            + " && daterange(DATE '2026-11-09', DATE '2026-11-22', '[]')");
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, DATE '2026-11-09',"
            + " DATE '2026-11-22', 'OPEN')",
        PERIOD);
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username IN ('j.chen', 't.nakamura')");
    // Only this class's people are in the pools while it runs.
    jdbc.update(
        "UPDATE employee SET active = false WHERE employee_no NOT LIKE 'E-SP%'"
            + " AND employee_no NOT LIKE 'S-SP%'");

    insertEmployee(LONG_SERVICE, "S-SP1", "Lee", "Longservice", SUP_L, "CS", "1996-01-01",
        "2022-06-01", false, 0.0);
    insertEmployee(SENIOR_SUP, "S-SP2", "Sam", "Seniorsup", SUP_L, "CS", "2010-01-01",
        "2018-03-01", false, 0.0);
    insertEmployee(BUSY_SUP, "S-SP3", "Bo", "Busysup", SUP_L, "CS", "2000-01-01", "2010-01-01",
        false, 6.0);
    insertEmployee(ACTING, "E-SP4", "Ari", "Acting", UNIT_A, "CO", "1995-01-01", null, true, 0.0);
    insertEmployee(PLAIN, "E-SP5", "Pat", "Plain", UNIT_B, "CO", "2015-01-01", null, false, 0.0);
    insertEmployee(CHEN, "S-SP6", "Jamie", "Chen", SUP_O, "CS", "2012-01-01", "2024-01-01",
        false, 8.0);

    insertOpenShift(POST_DAY, SUP_L, "D8", "2026-12-02T07:00:00-06:00");
    insertOpenShift(B_DAY, UNIT_B, "D8", "2026-12-02T07:00:00-06:00");

    jdbc.update("UPDATE app_user SET employee_id = ? WHERE username = 'j.chen'", CHEN);
    jdbc.update("UPDATE app_user SET employee_id = ? WHERE username = 't.nakamura'", ACTING);
    for (String user : new String[] {"m.ellis", "j.chen", "t.nakamura"}) {
      tokens.put(user, login(user));
    }
  }

  @AfterEach
  void restore() {
    jdbc.update("UPDATE employee SET active = true");
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username IN ('j.chen', 't.nakamura')");
  }

  @Test
  void aSupervisorPostListsSupervisorsByRankSeniorityThenActingOfficers() throws Exception {
    List<Map<String, Object>> candidates = candidates(POST_DAY, "m.ellis");

    // Supervisors first: no overtime, then seniority as a supervisor (Sam 2018 before Lee 2022,
    // though Lee has 14 more years' service); Bo, the most senior, has overtime; Jamie has more.
    // Then the acting officer, last despite no overtime and the longest service. Pat (no Acting
    // supervisor) is not in the pool.
    assertThat(ids(candidates))
        .containsExactly(
            SENIOR_SUP.toString(), LONG_SERVICE.toString(), BUSY_SUP.toString(),
            CHEN.toString(), ACTING.toString());
    assertThat(candidates.get(0).get("seniorityDate")).isEqualTo("Mar 2018");
    assertThat(candidates.get(1).get("seniorityDate")).isEqualTo("Jun 2022");
    assertThat(candidates.subList(0, 4)).extracting(c -> c.get("eligibility"))
        .containsOnly("ELIGIBLE");
    Map<String, Object> acting = candidates.get(4);
    assertThat(acting.get("eligibility")).isEqualTo("WARN");
    assertThat((String) acting.get("reason")).startsWith("R-01");
  }

  @Test
  void anOfficerPostListsOfficersOnly() throws Exception {
    // Ari (CO, also holds Acting supervisor) and Pat; no supervisor, though four have no overtime
    // and m.ellis scopes their post. O-02 among officers is unchanged: service seniority.
    assertThat(ids(candidates(B_DAY, "m.ellis")))
        .containsExactly(ACTING.toString(), PLAIN.toString());
  }

  @Test
  void anOfferOutsideThePoolIs422AndWritesNothing() throws Exception {
    HttpResponse<String> supervisor = offer(B_DAY, SENIOR_SUP, "m.ellis");
    assertThat(supervisor.statusCode()).as(supervisor.body()).isEqualTo(422);
    assertThat((String) json(supervisor).get("type")).endsWith("/officer-unavailable");
    assertThat((String) json(supervisor).get("detail")).contains("officer post's overtime pool");

    // Refused by the pool before R-01 is reached, with the pool's own words.
    HttpResponse<String> plain = offer(POST_DAY, PLAIN, "m.ellis");
    assertThat(plain.statusCode()).as(plain.body()).isEqualTo(422);
    assertThat((String) json(plain).get("detail")).contains("supervisor post's overtime pool");

    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM overtime_offer WHERE open_shift_id IN (?, ?)",
                Integer.class, POST_DAY, B_DAY))
        .isZero();

    // The acting officer is in the pool: the offer is made (R-01 is a warning).
    HttpResponse<String> acting = offer(POST_DAY, ACTING, "m.ellis");
    assertThat(acting.statusCode()).as(acting.body()).isIn(200, 201);
  }

  @Test
  void aSupervisorSickCallIsOfferedToAnotherSupervisorEndToEnd() throws Exception {
    // M. Ellis reports a sick call on her post, offers it to J. Chen (a supervisor on the other
    // post), J. Chen accepts on My schedule and M. Ellis confirms: a SUP-L shift for J. Chen.
    HttpResponse<String> created =
        send(
            "POST",
            "/api/v1/open-shifts",
            "{\"unitId\":\"" + SUP_L + "\",\"shiftTemplate\":\"D8\","
                + "\"startAt\":\"2026-12-03T07:00:00-06:00\",\"reason\":\"SICK_CALL\"}",
            "m.ellis");
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    UUID sickCall = UUID.fromString((String) json(created).get("id"));
    try {
      assertThat(ids(candidates(sickCall, "m.ellis"))).contains(CHEN.toString())
          .doesNotContain(PLAIN.toString());
      HttpResponse<String> offered = offer(sickCall, CHEN, "m.ellis");
      assertThat(offered.statusCode()).as(offered.body()).isIn(200, 201);
      String offerId =
          jdbc.queryForObject(
              "SELECT id::text FROM overtime_offer WHERE open_shift_id = ? AND employee_id = ?",
              String.class, sickCall, CHEN);

      HttpResponse<String> accepted = send("POST", "/api/v1/offers/" + offerId + "/accept", null,
          "j.chen");
      assertThat(accepted.statusCode()).as(accepted.body()).isEqualTo(200);
      HttpResponse<String> confirmed = send("POST", "/api/v1/offers/" + offerId + "/confirm", null,
          "m.ellis");
      assertThat(confirmed.statusCode()).as(confirmed.body()).isEqualTo(200);

      assertThat(
              jdbc.queryForObject(
                  "SELECT u.code || ' ' || s.kind FROM open_shift o"
                      + " JOIN shift_assignment s ON s.id = o.filled_assignment_id"
                      + " JOIN unit u ON u.id = s.unit_id WHERE o.id = ? AND s.employee_id = ?",
                  String.class, sickCall, CHEN))
          .isEqualTo("SUP-L EXTRA");
    } finally {
      jdbc.update("DELETE FROM overtime_offer WHERE open_shift_id = ?", sickCall);
      jdbc.update("UPDATE open_shift SET filled_assignment_id = NULL WHERE id = ?", sickCall);
      jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", CHEN);
      jdbc.update("DELETE FROM open_shift WHERE id = ?", sickCall);
    }
  }

  @Test
  void anActingOfficersProposalForAPostIsOutOfOrderBehindTheSupervisors() throws Exception {
    // P2's proposal approval reads the same pools: the acting officer (t.nakamura here) is fifth,
    // behind four supervisors, so approving needs the out-of-order acknowledgement too.
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("unitId", SUP_L.toString());
    item.put("shiftTemplate", "D8");
    item.put("startAt", OffsetDateTime.parse("2026-12-02T07:00:00-06:00").toInstant().toString());
    HttpResponse<String> sent =
        send("POST", "/api/v1/proposals", mapper.writeValueAsString(Map.of("items", List.of(item))),
            "t.nakamura");
    assertThat(sent.statusCode()).as(sent.body()).isEqualTo(201);
    String proposal = (String) json(sent).get("id");
    @SuppressWarnings("unchecked")
    Map<String, Object> match =
        (Map<String, Object>)
            ((List<Map<String, Object>>)
                    json(send("GET", "/api/v1/proposals/" + proposal, null, "m.ellis"))
                        .get("items"))
                .get(0)
                .get("openShift");
    assertThat(match.get("id")).isEqualTo(POST_DAY.toString());
    assertThat(match.get("otOrderPosition")).isEqualTo(5);
    assertThat(match.get("otOrderSize")).isEqualTo(5);
    assertThat(match.get("outOfOrder")).isEqualTo(true);
  }

  // ---------------------------------------------------------------------------------------------

  private void insertEmployee(
      UUID id,
      String number,
      String first,
      String last,
      UUID homeUnit,
      String classification,
      String seniority,
      String positionSince,
      boolean acting,
      double overtimeHours) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id,"
            + " classification, seniority_date, position_since)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?::date, ?::date) ON CONFLICT (id) DO NOTHING",
        id, number, first, last, homeUnit, classification, seniority, positionSince);
    jdbc.update(
        "INSERT INTO employee_qualification (employee_id, qualification_id, valid_from)"
            + " SELECT ?, id, DATE '2020-01-01' FROM qualification WHERE code = ?"
            + " ON CONFLICT DO NOTHING",
        id, acting ? "ACTING_SUP" : "FIRST_AID");
    if (overtimeHours > 0) {
      ZoneId regina = ZoneId.of("America/Regina");
      LocalDate day = LocalDate.of(2026, 11, 10);
      jdbc.update(
          "INSERT INTO time_entry (employee_id, pay_period_id, work_date, start_at, end_at, hours,"
              + " entry_type, pay_code) VALUES (?, ?, ?, ?, ?, ?, 'ACTUAL', 'OT15')",
          id,
          PERIOD,
          day,
          Timestamp.from(day.atTime(7, 0).atZone(regina).toInstant()),
          Timestamp.from(day.atTime(7, 0).plusHours((long) overtimeHours)
              .atZone(regina).toInstant()),
          overtimeHours);
    }
  }

  private void insertOpenShift(UUID id, UUID unitId, String template, String startAt) {
    java.time.Instant start = OffsetDateTime.parse(startAt).toInstant();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " SELECT ?, ?, t.id, ?, ?, 'SICK_CALL', 'OPEN' FROM shift_template t"
            + " WHERE t.code = ?",
        id,
        unitId,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(8 * 3600L)),
        template);
  }

  private HttpResponse<String> offer(UUID openShift, UUID employee, String user) throws Exception {
    return send("POST", "/api/v1/open-shifts/" + openShift + "/offers",
        "{\"employeeIds\":[\"" + employee + "\"],\"ordered\":false}", user);
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> candidates(UUID openShift, String user) throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/open-shifts/" + openShift + "/candidates", null, user);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (List<Map<String, Object>>) json(response).get("candidates");
  }

  private static List<String> ids(List<Map<String, Object>> candidates) {
    return candidates.stream().map(c -> (String) c.get("employeeId")).toList();
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
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }
}
