package ca.shiftcircle.api.display;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
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
 * E5 / docs/07 §4.8: the wall display shows today's coverage per unit and block with the ADR-017
 * shape, open shifts and officers in overtime, and never a name or an employee identifier.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class DisplayApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final LocalDate TODAY = LocalDate.of(2026, 11, 19);
  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID EMPLOYEE = UUID.fromString("99999999-9999-9999-9999-000000000001");
  private static final UUID OPEN_SHIFT = UUID.fromString("99999999-9999-9999-9999-000000000002");

  @BeforeEach
  void fixture() throws Exception {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM open_shift WHERE id = ?", OPEN_SHIFT);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-WALL', 'Wallis', 'Display', ?, DATE '2015-01-01')"
            + " ON CONFLICT (id) DO UPDATE SET active = true",
        EMPLOYEE,
        UNIT_A);

    // Today's day shift, and tonight's night shift (23:00 today to 07:00 tomorrow).
    insertAssignment("D8", TODAY.atTime(7, 0));
    insertAssignment("N8", TODAY.atTime(23, 0));
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " SELECT ?, ?, t.id, ?, ?, 'SICK_CALL', 'OPEN' FROM shift_template t WHERE t.code = 'D8'",
        OPEN_SHIFT,
        UNIT_A,
        Timestamp.from(TODAY.atTime(7, 0).atZone(REGINA).toInstant()),
        Timestamp.from(TODAY.atTime(15, 0).atZone(REGINA).toInstant()));

    Period period = periodContainingToday();
    insertHours(period);

    for (String user :
        new String[] {
          "tv.display", "m.ellis", "j.chen", "a.reviewer", "t.nakamura", "l.fraser", "p.singh"
        }) {
      tokens.put(user, login(user));
    }
  }

  private void insertAssignment(String template, java.time.LocalDateTime start) {
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED', 'ROTATION'"
            + " FROM shift_template t WHERE t.code = ?",
        UUID.randomUUID(),
        EMPLOYEE,
        UNIT_A,
        Timestamp.from(start.atZone(REGINA).toInstant()),
        Timestamp.from(
            start.plusHours("N8".equals(template) ? 8 : 8).atZone(REGINA).toInstant()),
        start.toLocalDate(),
        template);
  }

  private record Period(UUID id, LocalDate start) {}

  private Period periodContainingToday() {
    List<Map<String, Object>> existing =
        jdbc.queryForList(
            "SELECT id, start_date FROM pay_period WHERE ? BETWEEN start_date AND end_date", TODAY);
    if (!existing.isEmpty()) {
      return new Period(
          (UUID) existing.get(0).get("id"),
          ((java.sql.Date) existing.get(0).get("start_date")).toLocalDate());
    }
    UUID id = UUID.randomUUID();
    LocalDate start = TODAY.minusDays(5);
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, 'OPEN')",
        id,
        start,
        TODAY.plusDays(5));
    return new Period(id, start);
  }

  private void insertHours(Period period) {
    // Ten 8-hour actuals inside the pay period put the officer at the 80-hour threshold.
    for (int day = 1; day <= 10; day++) {
      LocalDate date = period.start().plusDays(day);
      jdbc.update(
          "INSERT INTO time_entry (employee_id, pay_period_id, work_date, start_at, end_at, hours,"
              + " entry_type, pay_code) VALUES (?, ?, ?, ?, ?, 8.0, 'ACTUAL', 'REG')",
          EMPLOYEE,
          period.id(),
          date,
          Timestamp.from(date.atTime(7, 0).atZone(REGINA).toInstant()),
          Timestamp.from(date.atTime(15, 0).atZone(REGINA).toInstant()));
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

  private HttpResponse<String> get(String path, String user) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  @Test
  void theDisplayShowsCoverageWithTheAdr017Shape() throws Exception {
    HttpResponse<String> response = get("/api/v1/display/today", "tv.display");

    assertThat(response.statusCode()).isEqualTo(200);
    Map<String, Object> body = json(response);
    assertThat(body.get("asOf")).isEqualTo("2026-11-19");
    List<Map<String, Object>> units = (List<Map<String, Object>>) body.get("units");
    Map<String, Object> unitA =
        units.stream()
            .filter(unit -> "Unit A · Living unit".equals(((Map<String, Object>) unit.get("unit")).get("name")))
            .findFirst()
            .orElseThrow();
    List<Map<String, Object>> coverage = (List<Map<String, Object>>) unitA.get("coverage");
    Map<String, Object> day =
        coverage.stream()
            .filter(block -> "DAY".equals(block.get("block")))
            .findFirst()
            .orElseThrow();
    assertThat(((Number) day.get("required")).intValue()).isEqualTo(5);
    Map<String, Object> scheduled = (Map<String, Object>) day.get("scheduled");
    assertThat(((Number) scheduled.get("lowestHourly")).intValue()).isEqualTo(1);
    assertThat((List<?>) scheduled.get("shortHours")).isNotEmpty();
    assertThat(day.get("covered")).isEqualTo(false);

    Map<String, Object> night =
        coverage.stream()
            .filter(block -> "NIGHT".equals(block.get("block")))
            .findFirst()
            .orElseThrow();
    Map<String, Object> nightScheduled = (Map<String, Object>) night.get("scheduled");
    List<Map<String, Object>> shortHours =
        (List<Map<String, Object>>) nightScheduled.get("shortHours");
    assertThat(shortHours)
        .as("tonight's 23:00 shift is counted across midnight, so every night hour has 1")
        .anySatisfy(
            run -> {
              assertThat(run.get("from")).isEqualTo("23:00");
              assertThat(run.get("to")).isEqualTo("07:00");
              assertThat(((Number) run.get("count")).intValue()).isEqualTo(1);
            });

    assertThat(((Number) unitA.get("openShifts")).intValue()).isEqualTo(1);
    assertThat(((Number) unitA.get("officersInOvertime")).intValue()).isEqualTo(1);
  }

  @Test
  void theDisplayContainsNoNamesOrEmployeeIdentifiers() throws Exception {
    String payload = get("/api/v1/display/today", "tv.display").body();

    List<Map<String, Object>> names =
        jdbc.queryForList("SELECT first_name, last_name, employee_no, id::text AS id FROM employee");
    for (Map<String, Object> row : names) {
      assertThat(payload)
          .as("the shared screen never carries a full name, employee number or employee id")
          .doesNotContain(row.get("first_name") + " " + row.get("last_name"))
          .doesNotContain((String) row.get("employee_no"))
          .doesNotContain((String) row.get("id"));
    }
    assertThat(payload).doesNotContain("\"employeeId\"");
  }

  @Test
  void supervisorsSeeOnlyTheirUnitsAndTheRolesAreEnforced() throws Exception {
    Map<String, Object> ellis = json(get("/api/v1/display/today", "m.ellis"));
    List<Map<String, Object>> ellisUnits = (List<Map<String, Object>>) ellis.get("units");
    assertThat(ellisUnits)
        .extracting(unit -> ((Map<String, Object>) unit.get("unit")).get("name"))
        .contains("Unit A · Living unit")
        .doesNotContain("Control");

    Map<String, Object> chen = json(get("/api/v1/display/today", "j.chen"));
    List<Map<String, Object>> chenUnits = (List<Map<String, Object>>) chen.get("units");
    assertThat(chenUnits)
        .extracting(unit -> ((Map<String, Object>) unit.get("unit")).get("name"))
        .doesNotContain("Unit A · Living unit");

    assertThat(get("/api/v1/display/today", "a.reviewer").statusCode()).isEqualTo(200);
    for (String role : new String[] {"t.nakamura", "l.fraser", "p.singh"}) {
      assertThat(get("/api/v1/display/today", role).statusCode())
          .as(role + " may not read the wall display")
          .isEqualTo(403);
    }
    assertThat(get("/api/v1/display/today", null).statusCode()).isEqualTo(401);
  }
}
