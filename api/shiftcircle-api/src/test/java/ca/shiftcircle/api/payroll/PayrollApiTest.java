package ca.shiftcircle.api.payroll;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * Time and payroll (docs/07 §4.5, HANDOFF step 9): actuals, absences, period overtime by the existing
 * {@link ca.shiftcircle.rules.pay.PayClassifier}, the lock precondition (T14), read-only locked
 * periods (T11), the export record, and one authorization cell per role and scope rule.
 *
 * <p>This class runs on its own database container so its fixture cannot leak into the other API
 * tests (a pay-period lock is facility-wide).
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class PayrollApiTest {

  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine").withDatabaseName("shiftcircle");

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID PERIOD_LOCK = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-000000000001");
  private static final UUID PERIOD_MISSING = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-000000000002");
  private static final UUID PERIOD_OT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-000000000003");
  private static final UUID OFFICER_LOCKED = UUID.fromString("33333333-3333-3333-3333-000000000101");
  private static final UUID OFFICER_MISSING = UUID.fromString("33333333-3333-3333-3333-000000000102");
  private static final UUID OFFICER_OT = UUID.fromString("33333333-3333-3333-3333-000000000103");
  private static final UUID EMPLOYEE_USER = UUID.fromString("22222222-2222-2222-2222-000000000101");

  private static final UUID[] MISSING_ASSIGNMENTS = {
    UUID.fromString("66666666-6666-6666-6666-000000000201"),
    UUID.fromString("66666666-6666-6666-6666-000000000202"),
    UUID.fromString("66666666-6666-6666-6666-000000000203")
  };

  /** Eleven shifts for the overtime officer; the last one is recorded by the test. */
  private static final UUID[] OT_ASSIGNMENTS =
      java.util.stream.IntStream.rangeClosed(301, 311)
          .mapToObj(
              number -> UUID.fromString(String.format("66666666-6666-6666-6666-%012d", number)))
          .toArray(UUID[]::new);

  @BeforeEach
  void fixtureAndLogins() throws Exception {
    // Unlock first: the trigger refuses deletes from a locked period, which is the point of T11.
    jdbc.update(
        "UPDATE pay_period SET status = 'OPEN', locked_at = NULL WHERE id IN (?, ?, ?)",
        PERIOD_LOCK,
        PERIOD_MISSING,
        PERIOD_OT);
    jdbc.update(
        "DELETE FROM payroll_export WHERE pay_period_id IN (?, ?, ?)",
        PERIOD_LOCK,
        PERIOD_MISSING,
        PERIOD_OT);
    jdbc.update("DELETE FROM absence WHERE employee_id IN (?, ?, ?)", OFFICER_LOCKED, OFFICER_MISSING, OFFICER_OT);
    jdbc.update(
        "DELETE FROM time_entry WHERE employee_id IN (?, ?, ?)", OFFICER_LOCKED, OFFICER_MISSING, OFFICER_OT);
    jdbc.update(
        "DELETE FROM shift_assignment WHERE employee_id IN (?, ?, ?)",
        OFFICER_LOCKED,
        OFFICER_MISSING,
        OFFICER_OT);
    jdbc.update(
        "DELETE FROM pay_period WHERE id IN (?, ?, ?)", PERIOD_LOCK, PERIOD_MISSING, PERIOD_OT);

    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES"
            + " (?, DATE '2026-01-19', DATE '2026-02-01', 'OPEN'),"
            + " (?, DATE '2026-02-02', DATE '2026-02-15', 'OPEN'),"
            + " (?, DATE '2026-02-16', DATE '2026-03-01', 'OPEN')",
        PERIOD_LOCK,
        PERIOD_MISSING,
        PERIOD_OT);

    insertOfficer(OFFICER_LOCKED, "E-PAY-L", "Locked", "Officer");
    insertOfficer(OFFICER_MISSING, "E-PAY-M", "Missing", "Officer");
    insertOfficer(OFFICER_OT, "E-PAY-O", "Overtime", "Officer");

    // The locked period already has its actual.
    UUID lockedAssignment = UUID.fromString("66666666-6666-6666-6666-000000000101");
    insertAssignment(lockedAssignment, OFFICER_LOCKED, "2026-01-20T07:00:00-06:00", "2026-01-20T15:00:00-06:00", "2026-01-20");
    jdbc.update(
        "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
            + " start_at, end_at, hours, entry_type, pay_code) VALUES (?, ?, ?, ?, DATE '2026-01-20',"
            + " TIMESTAMPTZ '2026-01-20 07:00:00-06', TIMESTAMPTZ '2026-01-20 15:00:00-06', 8,"
            + " 'ACTUAL', 'REG')",
        UUID.randomUUID(),
        OFFICER_LOCKED,
        PERIOD_LOCK,
        lockedAssignment);
    jdbc.update(
        "UPDATE pay_period SET status = 'LOCKED', locked_at = now() WHERE id = ?", PERIOD_LOCK);

    // Three ended shifts with nothing recorded (T14).
    for (int i = 0; i < 3; i++) {
      insertAssignment(
          MISSING_ASSIGNMENTS[i],
          OFFICER_MISSING,
          "2026-02-0" + (3 + i) + "T07:00:00-06:00",
          "2026-02-0" + (3 + i) + "T15:00:00-06:00",
          "2026-02-0" + (3 + i));
    }

    // Ten shifts at 8 h, and an eleventh the test records: 88 h means 8 h overtime.
    for (int i = 0; i < 11; i++) {
      int day = 17 + i;
      UUID assignmentId = OT_ASSIGNMENTS[i];
      insertAssignment(
          assignmentId,
          OFFICER_OT,
          "2026-02-" + day + "T07:00:00-06:00",
          "2026-02-" + day + "T15:00:00-06:00",
          "2026-02-" + day);
      if (i < 10) {
        jdbc.update(
            "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
                + " start_at, end_at, hours, entry_type, pay_code) VALUES (?, ?, ?, ?, ?::date,"
                + " ?::timestamptz, ?::timestamptz, 8, 'ACTUAL', 'REG')",
            UUID.randomUUID(),
            OFFICER_OT,
            PERIOD_OT,
            assignmentId,
            "2026-02-" + day,
            "2026-02-" + day + "T07:00:00-06:00",
            "2026-02-" + day + "T15:00:00-06:00");
      }
    }

    // An employee account linked to the missing-actuals officer, for the own-record cells.
    jdbc.update(
        "INSERT INTO app_user (id, username, display_name, employee_id) VALUES (?, 'pay.employee',"
            + " 'Pay Employee', ?) ON CONFLICT (username) DO UPDATE SET employee_id = EXCLUDED.employee_id",
        EMPLOYEE_USER,
        OFFICER_MISSING);
    jdbc.update(
        "INSERT INTO app_user_role (user_id, role) VALUES (?, 'EMPLOYEE')"
            + " ON CONFLICT DO NOTHING",
        EMPLOYEE_USER);

    for (String user :
        new String[] {
          "m.ellis", "j.chen", "t.nakamura", "l.fraser", "p.singh", "a.reviewer", "tv.display",
          "pay.employee"
        }) {
      tokens.put(user, login(user));
    }
  }

  private void insertOfficer(UUID id, String employeeNo, String first, String last) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, ?, ?, ?, ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        id,
        employeeNo,
        first,
        last,
        UNIT_A);
  }

  private void insertAssignment(
      UUID id, UUID employeeId, String startAt, String endAt, String workDate) {
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source) SELECT ?, ?, ?, t.id, ?::timestamptz, ?::timestamptz,"
            + " ?::date, 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'D8'"
            + " ON CONFLICT DO NOTHING",
        id,
        employeeId,
        UNIT_A,
        startAt,
        endAt,
        workDate);
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
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) {
    return mapper.readValue(response.body(), Map.class);
  }

  private String entriesPath(UUID period) {
    return "/api/v1/pay-periods/" + period + "/time-entries";
  }

  @Test
  @SuppressWarnings("unchecked")
  void recordsAnActualAndReportsThePeriodPayCodes() throws Exception {
    HttpResponse<String> response =
        send(
            "PUT",
            "/api/v1/time-entries/" + MISSING_ASSIGNMENTS[0],
            "{\"workedAsScheduled\":true}",
            tokens.get("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(200);
    Map<String, Object> body = json(response);
    Map<String, Object> entry = (Map<String, Object>) body.get("entry");
    assertThat(entry.get("assignmentId")).isEqualTo(MISSING_ASSIGNMENTS[0].toString());
    assertThat(entry.get("worked")).isEqualTo(true);
    assertThat(entry.get("needsActual")).isEqualTo(false);
    assertThat(entry.get("actualStart")).isNotNull();
    assertThat((List<Object>) body.get("payCodes"))
        .anySatisfy(code -> assertThat((Map<String, Object>) code).containsEntry("code", "REG"));

    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT hours, entry_type, pay_code FROM time_entry WHERE shift_assignment_id = ?",
            MISSING_ASSIGNMENTS[0]);
    assertThat(((Number) row.get("hours")).doubleValue()).isEqualTo(8.0);
    assertThat(row.get("entry_type")).isEqualTo("ACTUAL");
  }

  @Test
  @SuppressWarnings("unchecked")
  void adjustedTimesSplitPeriodOvertimeThroughThePayClassifier() throws Exception {
    UUID assignment = OT_ASSIGNMENTS[10];
    Map<String, Object> body =
        json(
            send(
                "PUT",
                "/api/v1/time-entries/" + assignment,
                "{\"workedAsScheduled\":false,"
                    + "\"actualStart\":\"2026-02-27T07:00:00-06:00\","
                    + "\"actualEnd\":\"2026-02-27T15:00:00-06:00\"}",
                tokens.get("m.ellis")));

    assertThat(((Number) body.get("periodHours")).doubleValue()).isEqualTo(88.0);
    assertThat((List<Object>) body.get("payCodes"))
        .anySatisfy(
            code -> {
              Map<String, Object> payCode = (Map<String, Object>) code;
              assertThat(payCode).containsEntry("code", "OT15");
              assertThat(((Number) payCode.get("hours")).doubleValue()).isEqualTo(8.0);
              assertThat(((Number) payCode.get("multiplier")).doubleValue()).isEqualTo(1.5);
            });

    // The eleventh shift is the overtime one: the first ten are regular.
    String code =
        jdbc.queryForObject(
            "SELECT pay_code FROM time_entry WHERE shift_assignment_id = ?", String.class, assignment);
    assertThat(code).isEqualTo("OT15");

    Map<String, Object> period = payPeriod(PERIOD_OT);
    Map<String, Object> totals = (Map<String, Object>) period.get("totals");
    assertThat(totals.get("officers")).isEqualTo(1);
    assertThat(((Number) totals.get("workedHours")).doubleValue()).isEqualTo(88.0);
    assertThat(((Number) totals.get("overtimeHours")).doubleValue()).isEqualTo(8.0);
    assertThat(((Number) period.get("overtimeThresholdHours")).doubleValue()).isEqualTo(80.0);
  }

  @Test
  @SuppressWarnings("unchecked")
  void recordsAnAbsenceAndClearsTheMissingActual() throws Exception {
    HttpResponse<String> response =
        send(
            "POST",
            "/api/v1/absences",
            "{\"assignmentId\":\"" + MISSING_ASSIGNMENTS[1] + "\",\"type\":\"SICK\"}",
            tokens.get("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(201);
    Map<String, Object> body = json(response);
    @SuppressWarnings("unchecked")
    Map<String, Object> entry = (Map<String, Object>) body.get("entry");
    assertThat(entry.get("absence")).isEqualTo("SICK");
    assertThat(entry.get("needsActual")).isEqualTo(false);

    Integer absences =
        jdbc.queryForObject(
            "SELECT count(*) FROM absence WHERE shift_assignment_id = ?",
            Integer.class,
            MISSING_ASSIGNMENTS[1]);
    assertThat(absences).isEqualTo(1);
  }

  @Test
  void refusesToLockWithMissingActualsAndNamesThem() throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/pay-periods/" + PERIOD_MISSING + "/lock", null, tokens.get("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(409);
    Map<String, Object> body = json(response);
    assertThat(body.get("type"))
        .isEqualTo("https://shiftcircle.local/problems/missing-actuals");
    assertThat(((Number) body.get("count")).intValue()).isEqualTo(3);
    assertThat((List<Object>) body.get("missing")).hasSize(3);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM pay_period WHERE id = ?", String.class, PERIOD_MISSING))
        .isEqualTo("OPEN");
  }

  @Test
  void locksOnceEveryEndedShiftHasAnActualAndAuditsIt() throws Exception {
    for (UUID assignment : MISSING_ASSIGNMENTS) {
      assertThat(
              send(
                      "PUT",
                      "/api/v1/time-entries/" + assignment,
                      "{\"workedAsScheduled\":true}",
                      tokens.get("m.ellis"))
                  .statusCode())
          .isEqualTo(200);
    }

    HttpResponse<String> response =
        send("POST", "/api/v1/pay-periods/" + PERIOD_MISSING + "/lock", null, tokens.get("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json(response).get("status")).isEqualTo("LOCKED");
    assertThat(json(response).get("lockedBy")).isEqualTo("M. Ellis");

    Integer audit =
        jdbc.queryForObject(
            "SELECT count(*) FROM audit_event WHERE action = 'lock_pay_period' AND entity_id = ?",
            Integer.class,
            PERIOD_MISSING);
    assertThat(audit).isEqualTo(1);
  }

  @Test
  void aLockedPeriodIsReadOnlyInTheApiAndInTheDatabase() throws Exception {
    HttpResponse<String> response =
        send(
            "PUT",
            "/api/v1/time-entries/66666666-6666-6666-6666-000000000101",
            "{\"workedAsScheduled\":true}",
            tokens.get("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(409);
    assertThat(json(response).get("type"))
        .isEqualTo("https://shiftcircle.local/problems/pay-period-locked");

    // T11, second line of defence: the trigger refuses direct SQL as well.
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "UPDATE time_entry SET hours = 7 WHERE pay_period_id = ?", PERIOD_LOCK))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("locked");
  }

  @Test
  void unlockNeedsAReasonOfTenCharactersAndIsAudited() throws Exception {
    assertThat(
            send(
                    "POST",
                    "/api/v1/pay-periods/" + PERIOD_LOCK + "/unlock",
                    "{\"reason\":\"too short\"}",
                    tokens.get("m.ellis"))
                .statusCode())
        .isEqualTo(400);

    HttpResponse<String> response =
        send(
            "POST",
            "/api/v1/pay-periods/" + PERIOD_LOCK + "/unlock",
            "{\"reason\":\"Correct the 20 Jan actual after the officer called in\"}",
            tokens.get("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(json(response).get("status")).isEqualTo("OPEN");

    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT unlock_reason FROM pay_period WHERE id = ?", PERIOD_LOCK);
    assertThat(row.get("unlock_reason")).isEqualTo("Correct the 20 Jan actual after the officer called in");

    Map<String, Object> audit =
        jdbc.queryForMap(
            "SELECT action, after::text AS after FROM audit_event"
                + " WHERE action = 'unlock_pay_period' AND entity_id = ?",
            PERIOD_LOCK);
    assertThat(audit.get("after").toString()).contains("Correct the 20 Jan actual");
  }

  @Test
  @SuppressWarnings("unchecked")
  void exportsOnlyALockedPeriodAndRecordsTheFileHash() throws Exception {
    HttpResponse<String> open =
        send(
            "GET",
            "/api/v1/pay-periods/" + PERIOD_MISSING + "/payroll-export",
            null,
            tokens.get("m.ellis"));
    assertThat(open.statusCode()).isEqualTo(409);

    HttpResponse<String> exported =
        send(
            "GET",
            "/api/v1/pay-periods/" + PERIOD_LOCK + "/payroll-export",
            null,
            tokens.get("m.ellis"));

    assertThat(exported.statusCode()).isEqualTo(200);
    assertThat(exported.headers().firstValue("Content-Type").orElse("")).contains("text/csv");
    String csv = exported.body();
    assertThat(csv)
        .startsWith(
            "employee_no,pay_period_start,pay_period_end,work_date,pay_code,hours,unit_code,cost_centre\n");
    assertThat(csv).contains("E-PAY-L,2026-01-19,2026-02-01,2026-01-20,REG,8.00,A,A");

    String hash =
        HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256").digest(csv.getBytes(StandardCharsets.UTF_8)));
    Map<String, Object> export =
        jdbc.queryForMap(
            "SELECT row_count, file_sha256 FROM payroll_export WHERE pay_period_id = ?",
            PERIOD_LOCK);
    assertThat(export.get("file_sha256")).isEqualTo(hash);
    assertThat(((Number) export.get("row_count")).intValue()).isEqualTo(1);

    Map<String, Object> period = payPeriod(PERIOD_LOCK);
    assertThat((Map<String, Object>) period.get("lastExport"))
        .containsEntry("fileHash", hash);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> payPeriod(UUID id) throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/pay-periods", null, tokens.get("m.ellis"));
    assertThat(response.statusCode()).isEqualTo(200);
    for (Object entry : (List<Object>) mapper.readValue(response.body(), List.class)) {
      Map<String, Object> period = (Map<String, Object>) entry;
      if (id.toString().equals(period.get("id"))) {
        return period;
      }
    }
    throw new AssertionError("period not found: " + id);
  }

  // ---------------------------------------------------------------------------------------------
  // Authorization (docs/09 §2): one cell per denied or scoped case.
  // ---------------------------------------------------------------------------------------------

  @Test
  void authorizationAndScopeCells() throws Exception {
    assertThat(send("GET", "/api/v1/pay-periods", null, null).statusCode())
        .as("anonymous").isEqualTo(401);
    assertThat(send("GET", "/api/v1/pay-periods", null, tokens.get("pay.employee")).statusCode())
        .as("employee cannot list periods").isEqualTo(403);
    assertThat(send("GET", "/api/v1/pay-periods", null, tokens.get("l.fraser")).statusCode())
        .as("rules admin").isEqualTo(403);
    assertThat(send("GET", "/api/v1/pay-periods", null, tokens.get("a.reviewer")).statusCode())
        .as("auditor reads").isEqualTo(200);

    assertThat(send("GET", entriesPath(PERIOD_MISSING), null, tokens.get("pay.employee")).statusCode())
        .as("employee reads own entries").isEqualTo(200);
    assertThat(
            send(
                    "GET",
                    entriesPath(PERIOD_MISSING) + "?employeeId=" + OFFICER_OT,
                    null,
                    tokens.get("pay.employee"))
                .statusCode())
        .as("another officer's hours answer 404").isEqualTo(404);

    assertThat(send("GET", entriesPath(PERIOD_MISSING), null, tokens.get("j.chen")).statusCode())
        .as("supervisor with no unit in this period gets an empty list")
        .isEqualTo(200);
    assertThat(
            send(
                    "GET",
                    entriesPath(PERIOD_MISSING) + "?employeeId=" + OFFICER_MISSING,
                    null,
                    tokens.get("j.chen"))
                .statusCode())
        .as("out-of-scope officer answers 404")
        .isEqualTo(404);
    assertThat(
            send(
                    "PUT",
                    "/api/v1/time-entries/" + MISSING_ASSIGNMENTS[0],
                    "{\"workedAsScheduled\":true}",
                    tokens.get("j.chen"))
                .statusCode())
        .as("out-of-scope unit answers 404")
        .isEqualTo(404);

    assertThat(send("GET", entriesPath(PERIOD_MISSING), null, tokens.get("tv.display")).statusCode())
        .as("display").isEqualTo(403);
    assertThat(
            send(
                    "PUT",
                    "/api/v1/time-entries/" + MISSING_ASSIGNMENTS[0],
                    "{\"workedAsScheduled\":true}",
                    tokens.get("a.reviewer"))
                .statusCode())
        .as("auditor is read-only").isEqualTo(403);
    assertThat(
            send("POST", "/api/v1/pay-periods/" + PERIOD_MISSING + "/lock", null, tokens.get("pay.employee"))
                .statusCode())
        .as("employee cannot lock").isEqualTo(403);
  }
}
