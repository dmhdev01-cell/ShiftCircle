package ca.shiftcircle.api.overtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
 * Step 8 and T6: the ranked overtime list and the offer workflow.
 *
 * <p>The fixtures recreate the planted shapes instead of generating 100 officers: PC-07 (equal
 * overtime, different seniority), PC-08 (open Unit B day shift, fewest overtime blocked by rest),
 * PC-09 (the officer with the fewest overtime hours lacks CONTROL) and PC-02 (exactly eight hours'
 * rest). The generator's own self-check still proves those cases exist in the demo dataset.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class OvertimeApiTest {

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
  private static final UUID UNIT_CTL = UUID.fromString("11111111-1111-1111-1111-000000000005");

  private static final UUID SENIOR = UUID.fromString("44444444-4444-4444-4444-000000000001");
  private static final UUID JUNIOR = UUID.fromString("44444444-4444-4444-4444-000000000002");
  private static final UUID BLOCKED = UUID.fromString("44444444-4444-4444-4444-000000000003");
  private static final UUID REST8 = UUID.fromString("44444444-4444-4444-4444-000000000004");
  private static final UUID CONTROL_LOW = UUID.fromString("44444444-4444-4444-4444-000000000005");
  private static final UUID CONTROL_QUAL = UUID.fromString("44444444-4444-4444-4444-000000000006");

  private static final UUID PERIOD = UUID.fromString("55555555-5555-5555-5555-000000000010");
  private static final UUID B_DAY = UUID.fromString("55555555-5555-5555-5555-000000000001");
  private static final UUID A_EVENING = UUID.fromString("55555555-5555-5555-5555-000000000002");
  private static final UUID CONTROL_DAY = UUID.fromString("55555555-5555-5555-5555-000000000003");

  private static final List<UUID> EMPLOYEES =
      List.of(SENIOR, JUNIOR, BLOCKED, REST8, CONTROL_LOW, CONTROL_QUAL);
  private static final List<UUID> SHIFTS = List.of(B_DAY, A_EVENING, CONTROL_DAY);

  @BeforeEach
  void fixture() throws Exception {
    // Fixture rows are rewritten each test; audit rows are append-only and are only counted.
    jdbc.update("DELETE FROM overtime_offer WHERE open_shift_id IN (?, ?, ?)",
        B_DAY, A_EVENING, CONTROL_DAY);
    jdbc.update("DELETE FROM open_shift WHERE id IN (?, ?, ?)", B_DAY, A_EVENING, CONTROL_DAY);
    jdbc.update("DELETE FROM time_entry WHERE employee_id IN (?, ?, ?, ?, ?, ?)",
        (Object[]) EMPLOYEES.toArray());
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id IN (?, ?, ?, ?, ?, ?)",
        (Object[]) EMPLOYEES.toArray());
    jdbc.update(
        "DELETE FROM time_entry WHERE pay_period_id IN (SELECT id FROM pay_period"
            + " WHERE daterange(start_date, end_date, '[]')"
            + " && daterange(DATE '2026-11-09', DATE '2026-11-22', '[]'))");
    jdbc.update(
        "DELETE FROM pay_period WHERE daterange(start_date, end_date, '[]')"
            + " && daterange(DATE '2026-11-09', DATE '2026-11-22', '[]')");
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username = 't.nakamura'");
    // Other api test classes share this container and leave officers behind; they would appear in
    // the candidate pool. Only this class's six officers are active while it runs.
    jdbc.update(
        "UPDATE employee SET active = false WHERE employee_no NOT IN"
            + " ('E-OT1', 'E-OT2', 'E-OT3', 'E-OT4', 'E-OT5', 'E-OT6')");

    insertPayPeriod();
    insertEmployee(SENIOR, "E-OT1", "Avery", "Senior", UNIT_B, "2012-03-01", List.of("FIRST_AID"),
        4.0);
    insertEmployee(JUNIOR, "E-OT2", "Bailey", "Junior", UNIT_B, "2016-11-01",
        List.of("FIRST_AID"), 4.0);
    insertEmployee(BLOCKED, "E-OT3", "Casey", "Blocked", UNIT_B, "2010-01-01",
        List.of("FIRST_AID"), 1.0);
    insertEmployee(REST8, "E-OT4", "Dana", "Rest8", UNIT_A, "2015-06-01", List.of("FIRST_AID"),
        2.0);
    insertEmployee(CONTROL_LOW, "E-OT5", "Elliot", "ControlLow", UNIT_CTL, "2009-01-01",
        List.of("FIRST_AID"), 0.0);
    insertEmployee(CONTROL_QUAL, "E-OT6", "Frankie", "ControlQual", UNIT_CTL, "2014-01-01",
        List.of("CONTROL"), 3.0);

    // PC-08/PC-01: Casey ends a P12 at midnight, so the 07:00 day shift gives 7 hours' rest.
    insertAssignment(BLOCKED, UNIT_B, "P12", "2026-11-20T12:00:00-06:00", 12);
    // PC-02: Dana's N8 ends 07:00 Thu 26 Nov; the E8 starts at 15:00, exactly eight hours.
    insertAssignment(REST8, UNIT_A, "N8", "2026-11-25T23:00:00-06:00", 8);

    insertOpenShift(B_DAY, UNIT_B, "D8", "2026-11-21T07:00:00-06:00", "EXTRA_COVERAGE");
    insertOpenShift(A_EVENING, UNIT_A, "E8", "2026-11-26T15:00:00-06:00", "SICK_CALL");
    insertOpenShift(CONTROL_DAY, UNIT_CTL, "D8", "2026-11-25T07:00:00-06:00", "SICK_CALL");

    jdbc.update(
        "UPDATE app_user SET employee_id = ? WHERE username = 't.nakamura'", SENIOR);

    for (String user : new String[] {"m.ellis", "j.chen", "t.nakamura"}) {
      tokens.put(user, login(user));
    }
  }

  private void insertPayPeriod() {
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, DATE '2026-11-09',"
            + " DATE '2026-11-22', 'OPEN')",
        PERIOD);
  }

  private void insertEmployee(
      UUID id,
      String number,
      String first,
      String last,
      UUID homeUnit,
      String seniority,
      List<String> qualifications,
      double overtimeHours) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, ?, ?, ?, ?, ?::date)"
            + " ON CONFLICT (id) DO UPDATE SET home_unit_id = excluded.home_unit_id,"
            + " seniority_date = excluded.seniority_date",
        id,
        number,
        first,
        last,
        homeUnit,
        seniority);
    for (String qualification : qualifications) {
      jdbc.update(
          "INSERT INTO employee_qualification (employee_id, qualification_id, valid_from)"
              + " SELECT ?, id, DATE '2020-01-01' FROM qualification WHERE code = ?"
              + " ON CONFLICT DO NOTHING",
          id,
          qualification);
    }
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

  private void insertAssignment(
      UUID employeeId, UUID unitId, String template, String startAt, int hours) {
    ZoneId regina = ZoneId.of("America/Regina");
    java.time.Instant start = java.time.OffsetDateTime.parse(startAt).toInstant();
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED',"
            + " 'ROTATION' FROM shift_template t WHERE t.code = ?",
        UUID.randomUUID(),
        employeeId,
        unitId,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(hours * 3600L)),
        start.atZone(regina).toLocalDate(),
        template);
  }

  private void insertOpenShift(
      UUID id, UUID unitId, String template, String startAt, String reason) {
    java.time.Instant start = java.time.OffsetDateTime.parse(startAt).toInstant();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " SELECT ?, ?, t.id, ?, ?, ?, 'OPEN' FROM shift_template t WHERE t.code = ?",
        id,
        unitId,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(minutes(template) * 60L)),
        reason,
        template);
  }

  private static int minutes(String template) {
    return switch (template) {
      case "A12", "P12" -> 720;
      case "L16" -> 960;
      default -> 480;
    };
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

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> candidates(HttpResponse<String> response) throws Exception {
    return (List<Map<String, Object>>) json(response).get("candidates");
  }

  private static String candidateIds(List<Map<String, Object>> candidates) {
    return candidates.stream().map(c -> (String) c.get("employeeId")).toList().toString();
  }

  @Test
  void theRankedListIsFewestOvertimeThenSeniority() throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/open-shifts/" + B_DAY + "/candidates", null, "m.ellis");

    assertThat(response.statusCode()).isEqualTo(200);
    List<Map<String, Object>> candidates = candidates(response);
    // Casey has the fewest hours but is blocked by rest: skipped in first place, not pushed down.
    assertThat(candidateIds(candidates))
        .isEqualTo("[" + BLOCKED + ", " + REST8 + ", " + SENIOR + ", " + JUNIOR + "]");
    // Dana already holds an N8 shift in the window, so U-16 (release 4 #10) makes her a WARN
    // candidate even for a day shift: the roster itself contains an 8 h officer on a night shift.
    assertThat(candidates).extracting(c -> c.get("eligibility"))
        .containsExactly("SKIPPED", "WARN", "ELIGIBLE", "ELIGIBLE");
    assertThat((String) candidates.get(0).get("reason")).contains("U-0");
    assertThat((String) candidates.get(1).get("reason")).contains("U-16");
    assertThat((double) candidates.get(2).get("overtimeHoursThisQuarter")).isEqualTo(4.0);
    assertThat((String) candidates.get(2).get("seniorityDate")).contains("2012");
    assertThat((String) json(response).get("rankingNote"))
        .contains("Fewest overtime hours this quarter first");
  }

  @Test
  void exactlyEightHoursRestIsAWarningNotABlock() throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/open-shifts/" + A_EVENING + "/candidates", null, "m.ellis");

    List<Map<String, Object>> candidates = candidates(response);
    Map<String, Object> dana =
        candidates.stream()
            .filter(c -> REST8.toString().equals(c.get("employeeId")))
            .findFirst()
            .orElseThrow();
    assertThat(dana.get("eligibility")).isEqualTo("WARN");
    assertThat((String) dana.get("reason")).contains("U-02");

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> results = (List<Map<String, Object>>) dana.get("ruleResults");
    assertThat(results).noneSatisfy(r -> assertThat(r.get("outcome")).isEqualTo("BLOCK"));
    assertThat(results).anySatisfy(r -> assertThat(r.get("ruleCode")).isEqualTo("U-02"));
  }

  @Test
  void theUnqualifiedOfficerHeadsTheControlListAsUnavailable() throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/open-shifts/" + CONTROL_DAY + "/candidates", null, "j.chen");

    assertThat(response.statusCode()).isEqualTo(200);
    List<Map<String, Object>> candidates = candidates(response);
    assertThat(candidateIds(candidates))
        .isEqualTo("[" + CONTROL_LOW + ", " + CONTROL_QUAL + "]");
    assertThat(candidates).extracting(c -> c.get("eligibility"))
        .containsExactly("UNAVAILABLE", "ELIGIBLE");
    assertThat((String) candidates.get(0).get("reason")).contains("CONTROL");
  }

  @Test
  void offerAcceptAndConfirmCreateTheAssignment() throws Exception {
    String offers =
        "{\"employeeIds\":[\""
            + SENIOR
            + "\",\""
            + JUNIOR
            + "\"],\"ordered\":false}";
    HttpResponse<String> offered =
        send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offers, "m.ellis");
    assertThat(offered.statusCode()).isEqualTo(200);
    List<?> history = (List<?>) mapper.readValue(offered.body(), List.class);
    assertThat(history).hasSize(2);
    assertThat(((Map<String, Object>) history.get(0)).get("id"))
        .as("the history carries the offer id the supervisor's Confirm needs")
        .isNotNull();
    String offerId =
        jdbc.queryForObject(
            "SELECT id::text FROM overtime_offer WHERE open_shift_id = ? AND employee_id = ?",
            String.class,
            B_DAY,
            SENIOR);

    HttpResponse<String> myOffers =
        send("GET", "/api/v1/me/offers?status=OFFERED", null, "t.nakamura");
    assertThat(myOffers.statusCode()).isEqualTo(200);
    assertThat((List<?>) mapper.readValue(myOffers.body(), List.class)).hasSize(1);

    HttpResponse<String> accepted =
        send("POST", "/api/v1/offers/" + offerId + "/accept", null, "t.nakamura");
    assertThat(accepted.statusCode()).isEqualTo(200);
    assertThat(json(accepted).get("status")).isEqualTo("ACCEPTED");

    HttpResponse<String> confirmed =
        send("POST", "/api/v1/offers/" + offerId + "/confirm", null, "m.ellis");
    assertThat(confirmed.statusCode()).isEqualTo(200);
    assertThat(json(confirmed).get("status")).isEqualTo("CONFIRMED");

    Integer assignments =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment WHERE employee_id = ? AND kind = 'EXTRA'",
            Integer.class,
            SENIOR);
    assertThat(assignments).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM open_shift WHERE id = ?", String.class, B_DAY))
        .isEqualTo("FILLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'confirm_overtime_offer'",
                Integer.class))
        .isGreaterThanOrEqualTo(1);
  }

  @Test
  void anEmployeeCannotSendOrConfirmOffers() throws Exception {
    String offers = "{\"employeeIds\":[\"" + SENIOR + "\"],\"ordered\":false}";

    assertThat(
            send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offers, "t.nakamura")
                .statusCode())
        .isEqualTo(403);

    assertThat(
            send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offers, "m.ellis")
                .statusCode())
        .isEqualTo(200);
    String offerId =
        jdbc.queryForObject(
            "SELECT id::text FROM overtime_offer WHERE open_shift_id = ? AND employee_id = ?",
            String.class,
            B_DAY,
            SENIOR);

    assertThat(send("POST", "/api/v1/offers/" + offerId + "/confirm", null, "t.nakamura")
            .statusCode())
        .isEqualTo(403);
    assertThat(send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offers, null).statusCode())
        .isEqualTo(401);
  }

  @Test
  void theOpenShiftListAndCandidatesRespectUnitScope() throws Exception {
    HttpResponse<String> mine =
        send("GET", "/api/v1/open-shifts?from=2026-11-01&to=2026-11-30", null, "m.ellis");
    assertThat(mine.statusCode()).isEqualTo(200);
    List<Map<String, Object>> shifts = (List<Map<String, Object>>) mapper.readValue(mine.body(),
        List.class);
    assertThat(shifts).extracting(shift -> shift.get("id"))
        .contains(B_DAY.toString(), A_EVENING.toString())
        .doesNotContain(CONTROL_DAY.toString());

    assertThat(
            send("GET", "/api/v1/open-shifts/" + CONTROL_DAY + "/candidates", null, "m.ellis")
                .statusCode())
        .isEqualTo(404);
    assertThat(
            send("GET", "/api/v1/open-shifts/" + B_DAY + "/candidates", null, "t.nakamura")
                .statusCode())
        .isEqualTo(403);
  }

  @Test
  void directAssignRunsTheRulesAndFillsTheShift() throws Exception {
    String body = "{\"employeeId\":\"" + JUNIOR + "\"}";

    HttpResponse<String> response =
        send("POST", "/api/v1/open-shifts/" + B_DAY + "/assign", body, "m.ellis");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json(response).get("assignmentId")).isNotNull();
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM open_shift WHERE id = ?", String.class, B_DAY))
        .isEqualTo("FILLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'assign_open_shift'",
                Integer.class))
        .isGreaterThanOrEqualTo(1);
  }

  @Test
  @SuppressWarnings("unchecked")
  void myScheduleShowsOnlyTheSignedInOfficersRows() throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/me/schedule?from=2026-11-01&to=2026-11-30", null, "t.nakamura");

    assertThat(response.statusCode()).isEqualTo(200);
    Map<String, Object> body = json(response);
    assertThat(((Map<String, Object>) body.get("employee")).get("id"))
        .isEqualTo(SENIOR.toString());
    assertThat((List<?>) body.get("days")).hasSize(30);
    Map<String, Object> payPeriod = (Map<String, Object>) body.get("payPeriod");
    assertThat(payPeriod.get("thresholdHours")).isEqualTo(80.0);
    assertThat(payPeriod.get("workedHours")).isEqualTo(4.0);
    Map<String, Object> overtime = (Map<String, Object>) body.get("overtimeThisQuarter");
    assertThat(overtime.get("hours")).isEqualTo(4.0);
  }

  @Test
  void offeringToAnUnqualifiedOfficerIs422() throws Exception {
    String body = "{\"employeeIds\":[\"" + CONTROL_LOW + "\"],\"ordered\":false}";

    HttpResponse<String> response =
        send("POST", "/api/v1/open-shifts/" + CONTROL_DAY + "/offers", body, "j.chen");
    assertThat(response.statusCode()).isEqualTo(422);
    assertThat((String) json(response).get("type")).endsWith("/officer-unavailable");
    assertThat((String) json(response).get("detail")).contains("CONTROL");

    String assign = "{\"employeeId\":\"" + CONTROL_LOW + "\"}";
    assertThat(
            send("POST", "/api/v1/open-shifts/" + CONTROL_DAY + "/assign", assign, "j.chen")
                .statusCode())
        .as("the gate is not display-only")
        .isEqualTo(422);
  }

  @Test
  void offeringToAnOfficerAlreadyScheduledOverTheShiftIs422() throws Exception {
    insertAssignment(SENIOR, UNIT_B, "D8", "2026-11-21T06:00:00-06:00", 8);

    HttpResponse<String> response =
        send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offersBody(SENIOR), "m.ellis");
    assertThat(response.statusCode()).isEqualTo(422);
    assertThat((String) json(response).get("detail")).contains("overlapping");
  }

  @Test
  void aCancelledShiftTakesNoOffers() throws Exception {
    jdbc.update("UPDATE open_shift SET status = 'CANCELLED' WHERE id = ?", B_DAY);

    assertThat(
            send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offersBody(SENIOR), "m.ellis")
                .statusCode())
        .isEqualTo(409);
  }

  @Test
  void doubleAcceptAndAcceptAfterConfirmAre409() throws Exception {
    String offerId = offerTo(SENIOR);

    assertThat(send("POST", "/api/v1/offers/" + offerId + "/accept", null, "t.nakamura")
            .statusCode())
        .isEqualTo(200);
    assertThat(send("POST", "/api/v1/offers/" + offerId + "/accept", null, "t.nakamura")
            .statusCode())
        .as("the second answer cannot overwrite the first")
        .isEqualTo(409);
    assertThat(send("POST", "/api/v1/offers/" + offerId + "/decline", null, "t.nakamura")
            .statusCode())
        .isEqualTo(409);

    assertThat(send("POST", "/api/v1/offers/" + offerId + "/confirm", null, "m.ellis")
            .statusCode())
        .isEqualTo(200);
    assertThat(send("POST", "/api/v1/offers/" + offerId + "/accept", null, "t.nakamura")
            .statusCode())
        .isEqualTo(409);
  }

  @Test
  void aParallelAcceptPairHasExactlyOneWinner() throws Exception {
    String offerId = offerTo(SENIOR);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      CountDownLatch ready = new CountDownLatch(2);
      CountDownLatch go = new CountDownLatch(1);
      List<Future<HttpResponse<String>>> calls = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        calls.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  go.await();
                  return send(
                      "POST", "/api/v1/offers/" + offerId + "/accept", null, "t.nakamura");
                }));
      }
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();

      List<Integer> statuses = new ArrayList<>();
      for (Future<HttpResponse<String>> call : calls) {
        statuses.add(call.get(30, TimeUnit.SECONDS).statusCode());
      }
      assertThat(statuses).containsExactlyInAnyOrder(200, 409);
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void reOfferingAfterADeclineMakesANewOffer() throws Exception {
    String offerId = offerTo(SENIOR);
    assertThat(send("POST", "/api/v1/offers/" + offerId + "/decline", null, "t.nakamura")
            .statusCode())
        .isEqualTo(200);

    assertThat(send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offersBody(SENIOR),
            "m.ellis").statusCode())
        .isEqualTo(200);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM overtime_offer WHERE id = ?",
                String.class,
                UUID.fromString(offerId)))
        .as("a declined offer can be made again; the supervisor sees the effect")
        .isEqualTo("OFFERED");
  }

  @Test
  void anotherOfficersOfferIs404() throws Exception {
    String offerId = offerTo(JUNIOR);

    assertThat(send("POST", "/api/v1/offers/" + offerId + "/accept", null, "t.nakamura")
            .statusCode())
        .isEqualTo(404);
    assertThat(send("POST", "/api/v1/offers/" + offerId + "/decline", null, "t.nakamura")
            .statusCode())
        .isEqualTo(404);
  }

  private String offersBody(UUID employeeId) {
    return "{\"employeeIds\":[\"" + employeeId + "\"],\"ordered\":false}";
  }

  private String offerTo(UUID employeeId) throws Exception {
    assertThat(
            send("POST", "/api/v1/open-shifts/" + B_DAY + "/offers", offersBody(employeeId),
                    "m.ellis")
                .statusCode())
        .isEqualTo(200);
    return jdbc.queryForObject(
        "SELECT id::text FROM overtime_offer WHERE open_shift_id = ? AND employee_id = ?",
        String.class,
        B_DAY,
        employeeId);
  }

  @Test
  void anUnknownOrMalformedShiftIdIsANamedProblem() throws Exception {
    String body = "{\"employeeIds\":[],\"ordered\":false}";

    HttpResponse<String> unknown =
        send(
            "POST",
            "/api/v1/open-shifts/" + UUID.randomUUID() + "/offers",
            body,
            "m.ellis");
    assertThat(unknown.statusCode()).isEqualTo(404);
    assertThat(json(unknown).get("title")).isEqualTo("Open shift not found");

    HttpResponse<String> malformed =
        send("POST", "/api/v1/open-shifts/not-a-uuid/offers", body, "m.ellis");
    assertThat(malformed.statusCode()).isEqualTo(400);
    assertThat(malformed.body()).contains("'id'");
  }

  @Test
  void creatingAnOpenShiftIsSupervisorOnlyAndAudited() throws Exception {
    String body =
        "{\"unitId\":\""
            + UNIT_B
            + "\",\"shiftTemplate\":\"D8\",\"startAt\":\"2026-12-01T07:00:00-06:00\","
            + "\"reason\":\"EXTRA_COVERAGE\"}";

    assertThat(send("POST", "/api/v1/open-shifts", body, "t.nakamura").statusCode())
        .isEqualTo(403);
    HttpResponse<String> created = send("POST", "/api/v1/open-shifts", body, "m.ellis");
    assertThat(created.statusCode()).isEqualTo(201);
    assertThat(json(created).get("status")).isEqualTo("OPEN");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'create_open_shift'",
                Integer.class))
        .isGreaterThanOrEqualTo(1);

    jdbc.update(
        "DELETE FROM open_shift WHERE id = ?", UUID.fromString((String) json(created).get("id")));
  }

  @AfterEach
  void restoreDemoUserAndEmployeeFlags() {
    // Defense in depth if the per-class database isolation is ever removed: leave the shared demo
    // user and the employee flags as the migrations created them.
    jdbc.update("UPDATE employee SET active = true");
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username = 't.nakamura'");
  }
}
