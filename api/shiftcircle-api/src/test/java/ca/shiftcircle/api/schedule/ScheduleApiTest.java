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
