package ca.shiftcircle.api.schedule;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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
 * Planning-board read endpoint (docs/07 §4.2): hourly coverage with the lowest count and the short
 * hours, officer rows, and the role/scope rules around it. Uses a tiny fixture, not the demo dataset.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ScheduleApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000001");
  private static final UUID UNIT = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final java.time.LocalDate DAY = java.time.LocalDate.of(2026, 11, 18);

  @BeforeEach
  void fixture() {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES"
            + " ('44444444-4444-4444-4444-000000000001', DATE '2026-11-16', DATE '2026-11-29', 'OPEN')"
            + " ON CONFLICT DO NOTHING");
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-T1', 'Test', 'Officer', ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT"
            + " '55555555-5555-5555-5555-000000000001', ?, ?, t.id,"
            + " TIMESTAMPTZ '2026-11-18 07:00:00-06', TIMESTAMPTZ '2026-11-18 15:00:00-06',"
            + " DATE '2026-11-18', 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'D8'"
            + " ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT);
  }

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
    assertThat(response.statusCode()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private String schedulePath() {
    return "/api/v1/schedule?unitId=" + UNIT + "&from=" + DAY + "&to=" + DAY;
  }

  private String schedulePath(java.time.LocalDate from, java.time.LocalDate to) {
    return "/api/v1/schedule?unitId=" + UNIT + "&from=" + from + "&to=" + to;
  }

  private String overtimeStatus(java.time.LocalDate from, java.time.LocalDate to)
      throws Exception {
    HttpResponse<String> response = get(schedulePath(from, to), login("m.ellis"));
    assertThat(response.statusCode()).isEqualTo(200);
    var officers = (java.util.List<?>) mapper.readValue(response.body(), Map.class).get("officers");
    assertThat(officers).hasSize(1);
    return (String) ((Map<?, ?>) officers.get(0)).get("overtimeStatus");
  }

  private void setPeriodHours(UUID periodId, java.time.LocalDate workDate, double hours) {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "INSERT INTO time_entry (id, employee_id, pay_period_id, work_date, start_at, end_at,"
            + " hours, entry_type, pay_code, rule_set_version_id) VALUES"
            + " (?, ?, ?, ?, TIMESTAMPTZ '2026-11-18 07:00:00-06',"
            + " TIMESTAMPTZ '2026-11-18 15:00:00-06', ?, 'ACTUAL', 'REG',"
            + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
        UUID.randomUUID(),
        EMPLOYEE,
        periodId,
        workDate,
        hours);
  }

  private static final UUID PLANNED_EMPLOYEE =
      UUID.fromString("33333333-3333-3333-3333-000000000099");
  private static final java.time.LocalDate PLAN_MONDAY = java.time.LocalDate.of(2027, 3, 1);

  /** Its own officer and 2027 periods, so the shared fixture stays untouched. */
  private void plannedFixture() {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", PLANNED_EMPLOYEE);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", PLANNED_EMPLOYEE);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-T2', 'Planned', 'Officer', ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        PLANNED_EMPLOYEE,
        UNIT);
    for (int index = 0; index < 2; index += 1) {
      java.time.LocalDate start = PLAN_MONDAY.plusDays(14L * index);
      jdbc.update(
          "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, 'OPEN')"
              + " ON CONFLICT DO NOTHING",
          UUID.fromString("44444444-4444-4444-4444-00000000010" + index),
          start,
          start.plusDays(13));
    }
  }

  private void cleanPlannedFixture() {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", PLANNED_EMPLOYEE);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", PLANNED_EMPLOYEE);
    jdbc.update("DELETE FROM pay_period WHERE id IN (?, ?)",
        UUID.fromString("44444444-4444-4444-4444-000000000100"),
        UUID.fromString("44444444-4444-4444-4444-000000000101"));
  }

  private void plannedShift(String id, java.time.LocalDate date) {
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT"
            + " ?, ?, ?, t.id, ?::timestamptz, ?::timestamptz, ?, 'ROSTERED', 'ROTATION'"
            + " FROM shift_template t WHERE t.code = 'D8'",
        UUID.fromString(id),
        PLANNED_EMPLOYEE,
        UNIT,
        date + " 07:00:00-06",
        date + " 15:00:00-06",
        date);
  }

  private java.util.List<Map<?, ?>> officersFor(java.time.LocalDate from, java.time.LocalDate to)
      throws Exception {
    HttpResponse<String> response = get(schedulePath(from, to), login("m.ellis"));
    assertThat(response.statusCode()).isEqualTo(200);
    return (java.util.List<Map<?, ?>>)
        (java.util.List<?>) mapper.readValue(response.body(), Map.class).get("officers");
  }

  private double plannedPayPeriodHours(java.time.LocalDate from, java.time.LocalDate to)
      throws Exception {
    return officersFor(from, to).stream()
        .filter((row) -> PLANNED_EMPLOYEE.toString().equals(String.valueOf(row.get("employeeId"))))
        .mapToDouble((row) -> ((Number) row.get("payPeriodHours")).doubleValue())
        .findFirst()
        .orElseThrow();
  }

  /**
   * M3: a committed future quarter is all planned hours. The board used to read
   * time entries only, so every officer in a 2027 week showed 0 h and "Under".
   */
  @Test
  void plannedHoursCountForACommittedFuturePeriod() throws Exception {
    plannedFixture();
    try {
      plannedShift("55555555-5555-5555-5555-000000000100", PLAN_MONDAY);
      plannedShift("55555555-5555-5555-5555-000000000101", PLAN_MONDAY.plusDays(1));

      assertThat(plannedPayPeriodHours(PLAN_MONDAY, PLAN_MONDAY.plusDays(6)))
          .as("two planned D8 shifts")
          .isEqualTo(16.0);
      Map<?, ?> row =
          officersFor(PLAN_MONDAY, PLAN_MONDAY.plusDays(6)).stream()
              .filter((entry) -> PLANNED_EMPLOYEE.toString().equals(String.valueOf(entry.get("employeeId"))))
              .findFirst()
              .orElseThrow();
      assertThat(row.get("overtimeStatus")).isEqualTo("UNDER");
    } finally {
      cleanPlannedFixture();
    }
  }

  /** A finished period keeps its own meaning: no entry, no hours. */
  @Test
  void aPastShiftWithoutAnEntryAddsNoHours() throws Exception {
    plannedFixture();
    try {
      try {
        jdbc.update(
            "INSERT INTO pay_period (id, start_date, end_date, status) VALUES"
                + " ('44444444-4444-4444-4444-000000000001', DATE '2026-11-16', DATE '2026-11-29', 'OPEN')"
                + " ON CONFLICT DO NOTHING");
      } catch (org.springframework.dao.DataIntegrityViolationException alreadyThere) {
        // The shared fixture's own period; fine.
      }
      plannedShift("55555555-5555-5555-5555-000000000102", DAY);

      // The board still lists the shift; its hours are not "worked" because the
      // day has no entry and lies before the board's today.
      assertThat(plannedPayPeriodHours(DAY, DAY)).as("planned only, before today").isEqualTo(0.0);
    } finally {
      cleanPlannedFixture();
    }
  }

  /** A half-recorded period mixes the two: actual where recorded, planned after. */
  @Test
  void aHalfRecordedPeriodCountsPlannedHoursFromTheDemoDayOn() throws Exception {
    plannedFixture();
    try {
      UUID period = UUID.fromString("44444444-4444-4444-4444-000000000001");
      try {
        jdbc.update(
            "INSERT INTO pay_period (id, start_date, end_date, status) VALUES"
                + " ('44444444-4444-4444-4444-000000000001', DATE '2026-11-16', DATE '2026-11-29', 'OPEN')"
                + " ON CONFLICT DO NOTHING");
      } catch (org.springframework.dao.DataIntegrityViolationException alreadyThere) {
        // The shared fixture's own period; fine.
      }
      // One recorded day (8 h) and one unrecorded day after the board's today.
      plannedShift("55555555-5555-5555-5555-000000000103", DAY);
      plannedShift("55555555-5555-5555-5555-000000000104", DAY.plusDays(5));
      jdbc.update(
          "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
              + " start_at, end_at, hours, entry_type, pay_code, rule_set_version_id) VALUES"
              + " (?, ?, ?, ?, ?, TIMESTAMPTZ '2026-11-18 07:00:00-06',"
              + " TIMESTAMPTZ '2026-11-18 15:00:00-06', 8, 'ACTUAL', 'REG',"
              + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
          UUID.randomUUID(),
          PLANNED_EMPLOYEE,
          period,
          UUID.fromString("55555555-5555-5555-5555-000000000103"),
          DAY);

      // DAY is 18 Nov (before today), DAY+5 is 23 Nov: 8 recorded + 8 planned.
      assertThat(plannedPayPeriodHours(DAY, DAY.plusDays(6))).as("8 actual + 8 planned").isEqualTo(16.0);
    } finally {
      cleanPlannedFixture();
    }
  }

  @Test
  void overtimeStatusChangesAtThePayPeriodThresholdBoundaries() throws Exception {
    UUID period = UUID.fromString("44444444-4444-4444-4444-000000000001");

    // hours is numeric(5,2) by design (payroll is 2 dp): 71.99 h is 71 h 59 m 24 s, still under.
    setPeriodHours(period, DAY, 71.99);
    assertThat(overtimeStatus(DAY, DAY)).as("71.99 h is below the 72 h approach line").isEqualTo("UNDER");

    setPeriodHours(period, DAY, 72.00);
    assertThat(overtimeStatus(DAY, DAY)).as("exactly 72 h starts approaching").isEqualTo("APPROACHING");

    setPeriodHours(period, DAY, 79.99);
    assertThat(overtimeStatus(DAY, DAY)).as("79.99 h is still approaching").isEqualTo("APPROACHING");

    setPeriodHours(period, DAY, 80.00);
    assertThat(overtimeStatus(DAY, DAY)).as("exactly 80 h is in overtime").isEqualTo("IN_OVERTIME");

    setPeriodHours(period, DAY, 80.01);
    assertThat(overtimeStatus(DAY, DAY)).as("above 80 h stays in overtime").isEqualTo("IN_OVERTIME");
  }

  @Test
  void overtimeStatusUsesThePeriodThatContainsTheBoardDateAndCountsAMidnightCrossing()
      throws Exception {
    UUID firstPeriod = UUID.fromString("44444444-4444-4444-4444-000000000001");
    UUID secondPeriod = UUID.fromString("44444444-4444-4444-4444-000000000002");
    UUID lastDayShift = UUID.fromString("55555555-5555-5555-5555-000000000002");
    UUID nextPeriodShift = UUID.fromString("55555555-5555-5555-5555-000000000003");
    java.time.LocalDate lastDay = java.time.LocalDate.of(2026, 11, 29);
    java.time.LocalDate nextPeriodDay = java.time.LocalDate.of(2027, 1, 4);

    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, 'OPEN')"
            + " ON CONFLICT (id) DO NOTHING",
        secondPeriod,
        nextPeriodDay,
        nextPeriodDay.plusDays(13));
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id,"
            + " TIMESTAMPTZ '2026-11-29 07:00:00-06', TIMESTAMPTZ '2026-11-29 15:00:00-06',"
            + " DATE '2026-11-29', 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'D8'"
            + " ON CONFLICT (id) DO NOTHING",
        lastDayShift,
        EMPLOYEE,
        UNIT);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id,"
            + " TIMESTAMPTZ '2027-01-04 07:00:00-06', TIMESTAMPTZ '2027-01-04 15:00:00-06',"
            + " DATE '2027-01-04', 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = 'D8'"
            + " ON CONFLICT (id) DO NOTHING",
        nextPeriodShift,
        EMPLOYEE,
        UNIT);
    try {
      jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
      // The first period's last entry starts at 23:00 on its last day and ends after midnight.
      jdbc.update(
          "INSERT INTO time_entry (id, employee_id, pay_period_id, work_date, start_at, end_at,"
              + " hours, entry_type, pay_code, rule_set_version_id) VALUES"
              + " (?, ?, ?, DATE '2026-11-29', TIMESTAMPTZ '2026-11-29 23:00:00-06',"
              + " TIMESTAMPTZ '2026-11-30 07:00:00-06', 72.00, 'ACTUAL', 'REG',"
              + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
          UUID.randomUUID(),
          EMPLOYEE,
          firstPeriod);
      jdbc.update(
          "INSERT INTO time_entry (id, employee_id, pay_period_id, work_date, start_at, end_at,"
              + " hours, entry_type, pay_code, rule_set_version_id) VALUES"
              + " (?, ?, ?, DATE '2027-01-04', TIMESTAMPTZ '2027-01-04 07:00:00-06',"
              + " TIMESTAMPTZ '2027-01-04 15:00:00-06', 80.00, 'ACTUAL', 'REG',"
              + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
          UUID.randomUUID(),
          EMPLOYEE,
          secondPeriod);

      assertThat(overtimeStatus(lastDay, lastDay))
          .as("the board on the last day reads its own period, including the midnight-crossing entry")
          .isEqualTo("APPROACHING");
      assertThat(overtimeStatus(nextPeriodDay, nextPeriodDay))
          .as("the next period's 80 h is separate; the first period's hours must not leak in")
          .isEqualTo("IN_OVERTIME");
    } finally {
      jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
      jdbc.update("DELETE FROM shift_assignment WHERE id IN (?, ?)", lastDayShift, nextPeriodShift);
      jdbc.update("DELETE FROM pay_period WHERE id = ?", secondPeriod);
    }
  }

  @Test
  void reportsHourlyCoverageForTheDay() throws Exception {
    HttpResponse<String> response = get(schedulePath(), login("m.ellis"));

    assertThat(response.statusCode()).isEqualTo(200);
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(((Map<?, ?>) body.get("publishedState")).get("published")).isEqualTo(false);
    assertThat((java.util.List<?>) body.get("days")).hasSize(1);

    var coverage = (java.util.List<?>) body.get("coverage");
    assertThat(coverage).hasSize(3);
    Map<?, ?> dayBlock = null;
    for (Object entry : coverage) {
      Map<?, ?> block = (Map<?, ?>) entry;
      if ("DAY".equals(block.get("block"))) {
        dayBlock = block;
      }
    }
    assertThat(dayBlock).isNotNull();
    Map<?, ?> scheduled = (Map<?, ?>) dayBlock.get("scheduled");
    assertThat(dayBlock.get("required")).isEqualTo(5);
    assertThat(scheduled.get("lowestHourly")).isEqualTo(1);
    assertThat(dayBlock.get("covered")).isEqualTo(false);
    var shortHours = (java.util.List<?>) scheduled.get("shortHours");
    assertThat(shortHours).hasSize(1);
    assertThat(((Map<?, ?>) shortHours.get(0)).get("count")).isEqualTo(1);
    assertThat(((Map<?, ?>) shortHours.get(0)).get("from")).isEqualTo("07:00");
    assertThat(((Map<?, ?>) shortHours.get(0)).get("to")).isEqualTo("15:00");
  }

  @Test
  void listsTheOfficerRowsWithAssignmentsAndOvertimeStatus() throws Exception {
    HttpResponse<String> response = get(schedulePath(), login("m.ellis"));

    var officers = (java.util.List<?>) mapper.readValue(response.body(), Map.class).get("officers");
    assertThat(officers).hasSize(1);
    Map<?, ?> officer = (Map<?, ?>) officers.get(0);
    assertThat(officer.get("name")).isEqualTo("Test Officer");
    assertThat(officer.get("overtimeStatus")).isEqualTo("UNDER");
    assertThat((java.util.List<?>) officer.get("cells")).hasSize(1);
    var items = (java.util.List<?>) ((Map<?, ?>) ((java.util.List<?>) officer.get("cells")).get(0)).get("items");
    assertThat(items).hasSize(1);
    assertThat(((Map<?, ?>) items.get(0)).get("shiftTemplate")).isEqualTo("D8");
  }

  /**
   * PR-O: the board says what the shift dialog needs to know before a move or cancel: the business
   * clock's "now" (noon on the demo day, 18:00Z) and the refusals the api would give, per shift.
   */
  @Test
  void theBoardSendsTheBusinessNowAndTheMoveAndCancelRefusalsPerShift() throws Exception {
    UUID shift = UUID.fromString("55555555-5555-5555-5555-000000000001");
    Map<?, ?> before = firstShift();
    assertThat(before.get("actualRecorded")).isEqualTo(false);
    assertThat(before.get("absenceRecorded")).isEqualTo(false);
    assertThat(before.get("fillsOpenShift")).isEqualTo(false);
    assertThat(before.get("payPeriodLocked")).isEqualTo(false);

    UUID absence = UUID.randomUUID();
    UUID open = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO absence (id, employee_id, shift_assignment_id, type, start_at, end_at)"
            + " VALUES (?, ?, ?, 'SICK', TIMESTAMPTZ '2026-11-18 07:00:00-06',"
            + " TIMESTAMPTZ '2026-11-18 15:00:00-06')",
        absence,
        EMPLOYEE,
        shift);
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status,"
            + " filled_assignment_id) SELECT ?, ?, t.id, TIMESTAMPTZ '2026-11-18 07:00:00-06',"
            + " TIMESTAMPTZ '2026-11-18 15:00:00-06', 'OTHER', 'FILLED', ? FROM shift_template t"
            + " WHERE t.code = 'D8'",
        open,
        UNIT,
        shift);
    try {
      Map<?, ?> after = firstShift();
      assertThat(after.get("absenceRecorded")).isEqualTo(true);
      assertThat(after.get("fillsOpenShift")).isEqualTo(true);
    } finally {
      jdbc.update("DELETE FROM open_shift WHERE id = ?", open);
      jdbc.update("DELETE FROM absence WHERE id = ?", absence);
    }
  }

  /**
   * PR-O review S3: any time entry against the shift sets actualRecorded, an absence entry included
   * (the api refuses the cancel either way), while worked stays false for an absence. The lock of the
   * shift's pay period is sent too, because the api checks it before "started".
   */
  @Test
  void anAbsenceTimeEntrySetsActualRecordedButNotWorkedAndALockedPeriodIsSent() throws Exception {
    UUID shift = UUID.fromString("55555555-5555-5555-5555-000000000001");
    UUID period = UUID.fromString("44444444-4444-4444-4444-000000000001");
    UUID entry = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
            + " start_at, end_at, hours, entry_type, absence_type, pay_code, rule_set_version_id)"
            + " VALUES (?, ?, ?, ?, DATE '2026-11-18', TIMESTAMPTZ '2026-11-18 07:00:00-06',"
            + " TIMESTAMPTZ '2026-11-18 15:00:00-06', 8, 'ACTUAL', 'SICK', 'SICK',"
            + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
        entry,
        EMPLOYEE,
        period,
        shift);
    try {
      Map<?, ?> sick = firstShift();
      assertThat(sick.get("actualRecorded")).isEqualTo(true);
      assertThat(sick.get("worked")).as("an absence is not worked time").isEqualTo(false);
      assertThat(sick.get("payPeriodLocked")).isEqualTo(false);

      jdbc.update("UPDATE pay_period SET status = 'LOCKED' WHERE id = ?", period);
      assertThat(firstShift().get("payPeriodLocked")).isEqualTo(true);
    } finally {
      jdbc.update("UPDATE pay_period SET status = 'OPEN' WHERE id = ?", period);
      jdbc.update("DELETE FROM time_entry WHERE id = ?", entry);
    }
  }

  private Map<?, ?> firstShift() throws Exception {
    HttpResponse<String> response = get(schedulePath(), login("m.ellis"));
    assertThat(response.statusCode()).isEqualTo(200);
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("now")).isEqualTo("2026-11-19T18:00:00Z");
    var officer = (Map<?, ?>) ((java.util.List<?>) body.get("officers")).get(0);
    var cell = (Map<?, ?>) ((java.util.List<?>) officer.get("cells")).get(0);
    return (Map<?, ?>) ((java.util.List<?>) cell.get("items")).get(0);
  }

  @Test
  void aSupervisorCannotReadAnotherUnitsSchedule() throws Exception {
    assertThat(get(schedulePath(), login("j.chen")).statusCode()).isEqualTo(404);
  }

  @Test
  void anAuditorCanReadAnyUnit() throws Exception {
    assertThat(get(schedulePath(), login("a.reviewer")).statusCode()).isEqualTo(200);
  }

  @Test
  void anEmployeeCannotUseThePlanningBoardEndpoint() throws Exception {
    assertThat(get(schedulePath(), login("t.nakamura")).statusCode()).isEqualTo(403);
  }

  @Test
  void anonymousRequestsAreRefused() throws Exception {
    assertThat(get(schedulePath(), null).statusCode()).isEqualTo(401);
  }

  @Test
  void anInvalidRangeIsRejected() throws Exception {
    String path =
        "/api/v1/schedule?unitId=" + UNIT + "&from=2026-11-19&to=2026-11-18";

    assertThat(get(path, login("m.ellis")).statusCode()).isEqualTo(400);
  }
}
