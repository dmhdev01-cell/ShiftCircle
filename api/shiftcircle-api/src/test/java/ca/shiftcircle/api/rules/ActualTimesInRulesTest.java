package ca.shiftcircle.api.rules;

import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The facts the rules see are the shift that actually happened: a recorded
 * actual end moves the rest window and the shift's own length, so an extension
 * reaches U-01/U-02 (rest), U-04 (extension needs 10 h rest), U-05 (16 h in
 * 24 h) and the weekly windows. No entry - or an absence - keeps the roster.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=false"})
@org.springframework.test.context.ActiveProfiles("demo")
class ActualTimesInRulesTest {

  @org.springframework.test.context.DynamicPropertySource
  static void database(
      org.springframework.test.context.DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();

  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000901");
  private static final UUID UNIT = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID PERIOD = UUID.fromString("44444444-4444-4444-4444-000000000901");
  private static final LocalDate DAY = LocalDate.of(2026, 11, 17);

  @BeforeEach
  void fixture() {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM absence WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-A1', 'Actual', 'Officer', ?, DATE '2020-01-01') ON CONFLICT DO NOTHING",
        EMPLOYEE,
        UNIT);
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, DATE '2026-11-16',"
            + " DATE '2026-11-29', 'OPEN') ON CONFLICT DO NOTHING",
        PERIOD);
    shift("66666666-6666-6666-6666-000000000901", 'P', DAY);
    // The next shift is at noon the day after, not 07:00: with a P12 ending at
    // 24:00 the 24-hour window is exactly 12 h of work, so the extension is the
    // only thing that can push U-05 to its boundary or over it.
    shift("66666666-6666-6666-6666-000000000902", 'D', DAY.plusDays(1), "12:00:00-06");
  }

  /** A rostered shift on a day, by template initial (P12, D8). */
  private void shift(String id, char template, LocalDate date) {
    shift(id, template, date, template == 'P' ? "12:00:00-06" : "07:00:00-06");
  }

  private void shift(String id, char template, LocalDate date, String startAt) {
    String code = template == 'P' ? "P12" : "D8";
    String start = startAt;
    String end = template == 'P' ? "24:00:00-06" : "15:00:00-06";
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id, ?::timestamptz,"
            + " ?::timestamptz, ?, 'ROSTERED', 'ROTATION' FROM shift_template t WHERE t.code = ?",
        UUID.fromString(id),
        EMPLOYEE,
        UNIT,
        date + " " + start,
        date + " " + end,
        date,
        code);
  }

  private String login() throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(
                    HttpRequest.BodyPublishers.ofString(
                        "{\"userId\":\"m.ellis\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> put(String path, String body) throws Exception {
    return client.send(
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + login())
            .PUT(HttpRequest.BodyPublishers.ofString(body))
            .build(),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private HttpResponse<String> post(String path, String body) throws Exception {
    return client.send(
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + login())
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build(),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  /** The rule results of a preview for the next day's D8. */
  private List<Map<String, Object>> checkNextDay() throws Exception {
    String change =
        "{\"change\":{\"type\":\"ASSIGN\",\"employeeId\":\""
            + EMPLOYEE
            + "\",\"unitId\":\""
            + UNIT
            + "\",\"shiftTemplate\":\"D8\",\"startAt\":\""
            + DAY.plusDays(1)
            + "T12:00:00-06:00\"}}";
    HttpResponse<String> response = post("/api/v1/rule-checks", change);
    assertThat(response.statusCode()).isEqualTo(200);
    return (List<Map<String, Object>>)
        (List<?>) mapper.readValue(response.body(), Map.class).get("ruleResults");
  }

  private void extension(int hours) throws Exception {
    // P12 ends at 24:00; the actual end is `hours` later.
    HttpResponse<String> response =
        put(
            "/api/v1/time-entries/66666666-6666-6666-6666-000000000901",
            "{\"workedAsScheduled\":false,\"actualStart\":\""
                + DAY
                + "T12:00:00-06:00\",\"actualEnd\":\""
                + DAY.plusDays(1)
                + "T0"
                + hours
                + ":00:00-06:00\"}");
    assertThat(response.statusCode()).isEqualTo(200);
  }

  private static String outcomeOf(List<Map<String, Object>> results, String code) {
    return results.stream()
        .filter((result) -> code.equals(result.get("ruleCode")))
        .map((result) -> (String) result.get("outcome"))
        .findFirst()
        .orElse("NONE");
  }

  @Test
  void aFourHourExtensionWarnsUnderU04AndKeepsTheNextShiftRestChecked() throws Exception {
    extension(4);

    List<Map<String, Object>> results = checkNextDay();

    assertThat(outcomeOf(results, "U-04")).as("an extension of 4 h needs 10 h rest").isEqualTo("WARN");
  }

  @Test
  void aSixHourExtensionBlocksUnderU05() throws Exception {
    extension(6);

    List<Map<String, Object>> results = checkNextDay();

    assertThat(outcomeOf(results, "U-05")).as("12 + 6 = 18 h in 24 h").isEqualTo("BLOCK");
  }

  @Test
  void anExtensionOfExactlySixteenHoursInTwentyFourDoesNotBlockUnderU05() throws Exception {
    extension(4);

    List<Map<String, Object>> results = checkNextDay();

    assertThat(outcomeOf(results, "U-05")).as("exactly 16 h is the boundary").isEqualTo("NONE");
    assertThat(outcomeOf(results, "U-04")).isEqualTo("WARN");
  }

  @Test
  void anAbsenceEntryKeepsTheRosterTimes() throws Exception {
    // A sick day records no actual times; the rules see the rostered P12.
    HttpResponse<String> response =
        put(
            "/api/v1/time-entries/66666666-6666-6666-6666-000000000901",
            "{\"workedAsScheduled\":false,\"absence\":\"SICK\"}");
    assertThat(response.statusCode()).isEqualTo(200);

    List<Map<String, Object>> results = checkNextDay();

    assertThat(outcomeOf(results, "U-05")).isEqualTo("NONE");
    assertThat(outcomeOf(results, "U-04")).isEqualTo("NONE");
  }

  @Test
  void bothAnswersInOnePutAreRefused() throws Exception {
    HttpResponse<String> response =
        put(
            "/api/v1/time-entries/66666666-6666-6666-6666-000000000901",
            "{\"workedAsScheduled\":true,\"actualStart\":\""
                + DAY
                + "T12:00:00-06:00\",\"actualEnd\":\""
                + DAY
                + "T23:00:00-06:00\"}");

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.body()).contains("either workedAsScheduled or the actual times");
  }
}
