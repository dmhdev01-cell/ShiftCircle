package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
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
import tools.jackson.databind.ObjectMapper;

/**
 * Fit-gap B1-lite (PR-D): planned leave shows on the draft roster as ABSENCE items (Vac, Sick,
 * Other chips) instead of Off, and the live board's /schedule payload is unchanged.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=true")
@ActiveProfiles("demo")
class PlannerLeaveRosterApiTest {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final LocalDate WEEK = LocalDate.of(2027, 2, 8);
  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  @BeforeAll
  void login() throws Exception {
    tokens.put("p.planner", login("p.planner"));
    tokens.put("m.ellis", login("m.ellis"));
  }

  @Test
  void plannedLeaveShowsOnTheDraftRosterAsAbsenceItems() throws Exception {
    UUID first = generate();
    // An officer rostered in their home unit in the week: a whole week of leave.
    Map<String, Object> away =
        jdbc.queryForMap(
            "SELECT a.employee_id, a.unit_id FROM plan_draft_assignment a"
                + " JOIN employee e ON e.id = a.employee_id AND e.home_unit_id = a.unit_id"
                + " WHERE a.draft_id = ? AND a.work_date BETWEEN ? AND ?"
                + " ORDER BY e.employee_no LIMIT 1",
            first,
            WEEK,
            WEEK.plusDays(6));
    UUID awayId = (UUID) away.get("employee_id");
    UUID unitId = (UUID) away.get("unit_id");
    for (int day = 0; day < 7; day++) {
      assertThat(planAbsence(awayId, WEEK.plusDays(day), "VACATION").statusCode())
          .isEqualTo(201);
    }

    // The generator skips the leave week, so this officer has no draft shift in it.
    UUID draft = generate();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND employee_id = ?"
                    + " AND work_date BETWEEN ? AND ?",
                Integer.class,
                draft,
                awayId,
                WEEK,
                WEEK.plusDays(6)))
        .isZero();

    // A second officer on the new draft with a shift that day: sick leave entered after generate.
    Map<String, Object> sick =
        jdbc.queryForMap(
            "SELECT employee_id, work_date FROM plan_draft_assignment"
                + " WHERE draft_id = ? AND unit_id = ? AND work_date BETWEEN ? AND ?"
                + " AND employee_id <> ? ORDER BY start_at LIMIT 1",
            draft,
            unitId,
            WEEK,
            WEEK.plusDays(6),
            awayId);
    UUID sickId = (UUID) sick.get("employee_id");
    LocalDate sickDate = ((java.sql.Date) sick.get("work_date")).toLocalDate();
    assertThat(planAbsence(sickId, sickDate, "SICK").statusCode()).isEqualTo(201);

    // An assignment-free absence for an officer of another unit, not rostered here: not shown.
    UUID elsewhere =
        jdbc.queryForObject(
            "SELECT e.id FROM employee e WHERE e.active AND e.home_unit_id <> ?"
                + " AND NOT EXISTS (SELECT 1 FROM plan_draft_assignment a WHERE a.draft_id = ?"
                + " AND a.employee_id = e.id AND a.unit_id = ? AND a.work_date BETWEEN ? AND ?)"
                + " ORDER BY e.employee_no LIMIT 1",
            UUID.class,
            unitId,
            draft,
            unitId,
            WEEK,
            WEEK.plusDays(6));
    assertThat(planAbsence(elsewhere, WEEK.plusDays(2), "OTHER").statusCode()).isEqualTo(201);

    HttpResponse<String> response =
        send(
            "GET",
            "/api/v1/planner/drafts/"
                + draft
                + "/schedule?unitId="
                + unitId
                + "&from="
                + WEEK
                + "&to="
                + WEEK.plusDays(6),
            null,
            tokens.get("p.planner"));
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    Map<String, Object> payload = mapper.readValue(response.body(), Map.class);
    List<Map<String, Object>> officers = officers(payload);

    Map<String, Object> awayRow = row(officers, awayId);
    assertThat(awayRow).as("a whole week of leave is a visible row, not a missing officer").isNotNull();
    assertThat(awayRow.get("rotation")).isEqualTo("On leave");
    assertThat(((Number) awayRow.get("payPeriodHours")).doubleValue()).isZero();
    List<Map<String, Object>> awayCells = cells(awayRow);
    assertThat(awayCells).hasSize(7);
    for (Map<String, Object> cell : awayCells) {
      assertThat(items(cell))
          .as("leave on %s", cell.get("date"))
          .containsExactly(Map.of("type", "ABSENCE", "absenceType", "VACATION"));
    }

    Map<String, Object> sickRow = row(officers, sickId);
    Map<String, Object> sickCell =
        cells(sickRow).stream()
            .filter(cell -> sickDate.toString().equals(cell.get("date")))
            .findFirst()
            .orElseThrow();
    List<Map<String, Object>> sickItems = items(sickCell);
    assertThat(sickItems).extracting(item -> item.get("type")).containsExactly("SHIFT", "ABSENCE");
    assertThat(sickItems.get(1)).isEqualTo(Map.of("type", "ABSENCE", "absenceType", "SICK"));
    assertThat(sickItems.get(0)).containsKeys("assignmentId", "shiftTemplate", "version");

    assertThat(row(officers, elsewhere)).as("leave of an officer of another unit").isNull();
    long absenceItems =
        officers.stream()
            .flatMap(officer -> cells(officer).stream())
            .flatMap(cell -> items(cell).stream())
            .filter(item -> "ABSENCE".equals(item.get("type")))
            .count();
    assertThat(absenceItems).isGreaterThanOrEqualTo(8);
  }

  @Test
  void theLiveBoardScheduleStillCarriesNoAbsenceItems() throws Exception {
    // Fit-gap i-7: /schedule stays as it is before the freeze (Dataset 100's demo week).
    UUID employee =
        jdbc.queryForObject(
            "SELECT id FROM employee WHERE active AND home_unit_id = ? ORDER BY employee_no LIMIT 1",
            UUID.class,
            UNIT_A);
    LocalDate date = LocalDate.of(2026, 11, 24);
    jdbc.update(
        "INSERT INTO absence (employee_id, type, start_at, end_at) VALUES (?, 'VACATION', ?, ?)",
        employee,
        Timestamp.from(date.atStartOfDay(REGINA).toInstant()),
        Timestamp.from(date.plusDays(1).atStartOfDay(REGINA).toInstant()));
    try {
      HttpResponse<String> board =
          send(
              "GET",
              "/api/v1/schedule?unitId=" + UNIT_A + "&from=2026-11-23&to=2026-11-29",
              null,
              tokens.get("m.ellis"));
      assertThat(board.statusCode()).as(board.body()).isEqualTo(200);
      assertThat(board.body()).doesNotContain("\"ABSENCE\"").doesNotContain("absenceType");
    } finally {
      jdbc.update(
          "DELETE FROM absence WHERE employee_id = ? AND start_at = ? AND shift_assignment_id IS NULL",
          employee,
          Timestamp.from(date.atStartOfDay(REGINA).toInstant()));
    }
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> officers(Map<String, Object> payload) {
    return (List<Map<String, Object>>) payload.get("officers");
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> cells(Map<String, Object> officer) {
    return (List<Map<String, Object>>) officer.get("cells");
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> items(Map<String, Object> cell) {
    return new ArrayList<>((List<Map<String, Object>>) cell.get("items"));
  }

  private static Map<String, Object> row(List<Map<String, Object>> officers, UUID employeeId) {
    return officers.stream()
        .filter(officer -> employeeId.toString().equals(officer.get("employeeId")))
        .findFirst()
        .orElse(null);
  }

  private HttpResponse<String> planAbsence(UUID employeeId, LocalDate date, String type)
      throws Exception {
    return send(
        "POST",
        "/api/v1/planner/absences",
        "{\"employeeId\":\"" + employeeId + "\",\"date\":\"" + date + "\",\"type\":\"" + type + "\"}",
        tokens.get("p.planner"));
  }

  private UUID generate() throws Exception {
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", tokens.get("p.planner"));
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
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
}
