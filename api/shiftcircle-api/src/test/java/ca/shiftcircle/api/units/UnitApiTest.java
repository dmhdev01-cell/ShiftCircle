package ca.shiftcircle.api.units;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** Units with effective closures, the preview, flagged shifts and the staffing estimate. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class UnitApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String planner;
  private String supervisor;

  @BeforeEach
  void reset120() throws Exception {
    planner = login("p.planner");
    supervisor = login("m.ellis");
    HttpResponse<String> reset =
        send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\",\"dataset\":\"120\"}", planner);
    assertThat(reset.statusCode()).as(reset.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 120_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, planner).body(), Map.class);
      if ("DONE".equals(status.get("state"))) {
        return;
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError(status.toString());
      }
      Thread.sleep(300);
    }
    throw new AssertionError("reset did not finish");
  }

  @Test
  void unitsCarryTodayStatusAndClosurePreview() throws Exception {
    List<Map<String, Object>> units = jsonList(get("/api/v1/planner/units", planner));
    // Six line units and the two supervisor posts (V19, release v1.3 S4).
    assertThat(units).hasSize(8);
    Map<String, Object> unitC =
        units.stream().filter(row -> "C".equals(row.get("code"))).findFirst().orElseThrow();
    assertThat(unitC.get("today")).isEqualTo("OPEN");
    assertThat(unitC.get("closures")).isEqualTo(List.of());
    assertThat(((Number) unitC.get("filled")).intValue()).isPositive();
    assertThat(((Number) unitC.get("allocated")).intValue())
        .isEqualTo(((Number) unitC.get("filled")).intValue());
    UUID unitCId = UUID.fromString((String) unitC.get("id"));

    Map<String, Object> preview =
        json(
            post(
                "/api/v1/planner/units/" + unitCId + "/closures/preview",
                "{\"closedFrom\":\"2027-02-15\"}",
                planner));
    assertThat(((Number) preview.get("officersHomed")).intValue()).isPositive();
    assertThat(((Number) preview.get("publishedShiftsAffected")).intValue()).isZero();

    HttpResponse<String> added =
        post(
            "/api/v1/planner/units/" + unitCId + "/closures",
            "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation\"}",
            planner);
    assertThat(added.statusCode()).as(added.body()).isEqualTo(201);
    Map<String, Object> closure = json(added);
    assertThat(closure.get("state")).isEqualTo("FUTURE");
    assertThat(closure.get("reopensOn")).isNull();

    Map<String, Object> after = units().stream().filter(row -> "C".equals(row.get("code"))).findFirst().orElseThrow();
    List<Map<String, Object>> closures = (List<Map<String, Object>>) after.get("closures");
    assertThat(closures).hasSize(1);
    assertThat(closures.get(0).get("reason")).isEqualTo("Renovation");

    assertThat(
            post(
                    "/api/v1/planner/units/" + unitCId + "/closures",
                    "{\"closedFrom\":\"2027-02-20\",\"reason\":\"Overlap\"}",
                    planner)
                .body())
        .contains("already closed");
    assertThat(
            post(
                    "/api/v1/planner/units/" + unitCId + "/closures",
                    "{\"closedFrom\":\"2026-01-01\",\"reason\":\"Past\"}",
                    planner)
                .body())
        .contains("closing date can't be in the past");
    assertThat(
            post(
                    "/api/v1/planner/units/" + unitCId + "/closures",
                    "{\"closedFrom\":\"2027-03-15\",\"reopensOn\":\"2027-03-15\",\"reason\":\"Bad reopen\"}",
                    planner)
                .body())
        .contains("reopening date must be after the closing date");
    assertThat(
            post(
                    "/api/v1/planner/units/" + unitCId + "/closures",
                    "{\"closedFrom\":\"2027-04-01\",\"reason\":\"no\"}",
                    planner)
                .body())
        .contains("at least 5 characters");
    assertThat(
            post(
                    "/api/v1/planner/units/" + unitCId + "/closures",
                    "{\"closedFrom\":\"2027-04-01\",\"reason\":\"Supervisor\"}",
                    supervisor)
                .statusCode())
        .isEqualTo(403);

    HttpResponse<String> changed =
        put(
            "/api/v1/planner/units/" + unitCId + "/closures/" + closure.get("id"),
            "{\"reopensOn\":\"2027-03-29\",\"reason\":\"Renovation ends\"}",
            planner);
    assertThat(changed.statusCode()).as(changed.body()).isEqualTo(200);
    assertThat(json(changed).get("reopensOn")).isEqualTo("2027-03-29");

    assertThat(
            delete(
                    "/api/v1/planner/units/" + unitCId + "/closures/" + closure.get("id"),
                    "{\"reason\":\"Renovation cancelled\"}",
                    planner)
                .statusCode())
        .isEqualTo(204);
    assertThat(units().stream().filter(row -> "C".equals(row.get("code"))).findFirst().orElseThrow()
            .get("closures"))
        .isEqualTo(List.of());
  }

  @Test
  void staffingSplitsAtEveryClosureBoundaryAndUsesTheFormula() throws Exception {
    UUID unitC = unitId("C");
    assertThat(
            post(
                    "/api/v1/planner/units/" + unitC + "/closures",
                    "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation\"}",
                    planner)
                .statusCode())
        .isEqualTo(201);
    assertThat(
            put(
                    "/api/v1/planner/units/" + unitC + "/closures/"
                        + firstClosureId(unitC),
                    "{\"reopensOn\":\"2027-03-29\",\"reason\":\"Renovation ends\"}",
                    planner)
                .statusCode())
        .isEqualTo(200);

    Map<String, Object> staffing = json(get("/api/v1/planner/staffing", planner));
    assertThat((Double) staffing.get("leaveAllowance")).isEqualTo(0.2);
    List<Map<String, Object>> periods = (List<Map<String, Object>>) staffing.get("periods");
    assertThat(periods).hasSize(3);
    assertThat(periods.get(0).get("to")).isEqualTo("2027-02-14");
    assertThat(periods.get(1).get("from")).isEqualTo("2027-02-15");
    assertThat(periods.get(2).get("from")).isEqualTo("2027-03-29");

    Map<String, Object> closedRow = unitRow(periods.get(1), unitC);
    assertThat(closedRow.get("closed")).isEqualTo(true);
    assertThat(((Number) closedRow.get("needed")).intValue()).isZero();
    assertThat(((Number) closedRow.get("shortfall")).intValue()).isZero();

    Map<String, Object> openRow = unitRow(periods.get(0), unitC);
    Map<String, Object> breakdown = (Map<String, Object>) openRow.get("breakdown");
    int posts12Day = ((Number) breakdown.get("posts12Day")).intValue();
    int posts12Night = ((Number) breakdown.get("posts12Night")).intValue();
    int posts8 = ((Number) breakdown.get("posts8")).intValue();
    double raw = 2.0 * (posts12Day + posts12Night) + 1.4 * posts8;
    assertThat(((Number) breakdown.get("rawNeeded")).doubleValue()).isCloseTo(raw, within(0.01));
    assertThat(((Number) breakdown.get("needed")).intValue())
        .isEqualTo((int) Math.ceil(raw / 0.8));
    assertThat(((Number) openRow.get("needed")).intValue())
        .isEqualTo(((Number) breakdown.get("needed")).intValue());
    assertThat(((Number) openRow.get("shortfall")).intValue())
        .isEqualTo(Math.max(0, ((Number) openRow.get("needed")).intValue()
            - ((Number) openRow.get("filled")).intValue()));

    // The table adds up by eye: totals are the sums of the unit rows.
    Map<String, Object> totals = (Map<String, Object>) periods.get(0).get("totals");
    List<Map<String, Object>> rows = (List<Map<String, Object>>) periods.get(0).get("units");
    assertThat(((Number) totals.get("allocated")).intValue())
        .isEqualTo(rows.stream().mapToInt(row -> ((Number) row.get("allocated")).intValue()).sum());
    assertThat(((Number) totals.get("needed")).intValue())
        .isEqualTo(rows.stream().mapToInt(row -> ((Number) row.get("needed")).intValue()).sum());

    HttpResponse<String> allocated =
        put(
            "/api/v1/planner/units/" + unitC + "/staffing",
            "{\"allocated\":25,\"reason\":\"Funded for 25\"}",
            planner);
    assertThat(allocated.statusCode()).as(allocated.body()).isEqualTo(200);
    assertThat(units().stream().filter(row -> "C".equals(row.get("code"))).findFirst().orElseThrow()
            .get("allocated"))
        .isEqualTo(25);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'unit_staffing_changed'",
                Integer.class))
        .isPositive();

    HttpResponse<String> leave =
        put(
            "/api/v1/planner/settings/leave-allowance",
            "{\"percent\":15,\"reason\":\"Lower leave this year\"}",
            planner);
    assertThat(leave.statusCode()).as(leave.body()).isEqualTo(200);
    Map<String, Object> after = json(get("/api/v1/planner/staffing", planner));
    assertThat((Double) after.get("leaveAllowance")).isEqualTo(0.15);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'leave_allowance_changed'",
                Integer.class))
        .isPositive();

    assertThat(
            put(
                    "/api/v1/planner/settings/leave-allowance",
                    "{\"percent\":75,\"reason\":\"Too high\"}",
                    planner)
                .statusCode())
        .isEqualTo(400);
  }

  @Test
  void flaggedShiftsListFuturePublishedShiftsInAClosedUnit() throws Exception {
    UUID unitC = unitId("C");
    UUID employee =
        jdbc.queryForObject(
            "SELECT e.id FROM employee e WHERE e.home_unit_id = ? AND e.active ORDER BY e.employee_no LIMIT 1",
            UUID.class,
            unitC);
    UUID template =
        jdbc.queryForObject(
            "SELECT id FROM shift_template WHERE code = 'D8'", UUID.class);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source, status)"
            + " VALUES (?, ?, ?, ?, TIMESTAMP '2027-02-20 07:00-06',"
            + " TIMESTAMP '2027-02-20 15:00-06', DATE '2027-02-20', 'ROSTERED', 'ROTATION', 'PLANNED')",
        UUID.randomUUID(),
        employee,
        unitC,
        template);
    assertThat(
            post(
                    "/api/v1/planner/units/" + unitC + "/closures",
                    "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation\"}",
                    planner)
                .statusCode())
        .isEqualTo(201);

    List<Map<String, Object>> flagged =
        jsonList(get("/api/v1/planner/flagged-shifts", planner));
    assertThat(flagged).isNotEmpty();
    Map<String, Object> shift =
        flagged.stream()
            .filter(row -> "C".equals(row.get("unitCode")))
            .findFirst()
            .orElseThrow();
    assertThat(shift.get("shiftLabel")).asString().contains("Day 07-15 (8 h)");
    assertThat(shift.get("closedFrom")).isEqualTo("2027-02-15");
    assertThat(shift.get("reason")).isEqualTo("Renovation");
  }

  /**
   * Release v1.3 S3: a supervisor post cannot be closed (the closed-unit relief would move its
   * supervisors onto officer posts); the preview and the closure answer 409 with the plain words,
   * and nothing is written. Its minimum is changed instead.
   */
  @Test
  void aSupervisorPostCannotBeClosed() throws Exception {
    UUID post = UUID.fromString("11111111-1111-1111-1111-0000000000c3");
    jdbc.update(
        "INSERT INTO unit (id, code, name, kind, allows_12h, allows_16h)"
            + " VALUES (?, 'SUP-T', 'Supervision · Test', 'SUPERVISION', true, false)",
        post);
    try {
      HttpResponse<String> preview =
          post("/api/v1/planner/units/" + post + "/closures/preview",
              "{\"closedFrom\":\"2027-02-15\"}", planner);
      assertThat(preview.statusCode()).as(preview.body()).isEqualTo(409);
      assertThat(preview.body())
          .contains("Supervisor posts can't be closed; change the minimum instead");
      HttpResponse<String> added =
          post("/api/v1/planner/units/" + post + "/closures",
              "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation\"}", planner);
      assertThat(added.statusCode()).as(added.body()).isEqualTo(409);
      assertThat(added.body())
          .contains("Supervisor posts can't be closed; change the minimum instead");
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM unit_availability WHERE unit_id = ?", Integer.class, post))
          .isZero();
      // A closure that reached the post another way (a row written before it became a post)
      // cannot be changed through the API either; it can still be removed.
      UUID stale = UUID.randomUUID();
      jdbc.update(
          "INSERT INTO unit_availability (id, unit_id, disabled_from, reason)"
              + " VALUES (?, ?, DATE '2027-03-01', 'Written by hand')",
          stale,
          post);
      HttpResponse<String> changed =
          put("/api/v1/planner/units/" + post + "/closures/" + stale,
              "{\"closedFrom\":\"2027-03-01\",\"reopensOn\":\"2027-03-08\",\"reason\":\"Reopen it\"}",
              planner);
      assertThat(changed.statusCode()).as(changed.body()).isEqualTo(409);
      assertThat(changed.body())
          .contains("Supervisor posts can't be closed; change the minimum instead");
      assertThat(
              jdbc.queryForObject(
                  "SELECT enabled_from FROM unit_availability WHERE id = ?",
                  java.sql.Date.class,
                  stale))
          .as("the refused change wrote nothing")
          .isNull();
      // An officer unit still closes as before.
      assertThat(
              post("/api/v1/planner/units/" + unitId("C") + "/closures",
                      "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation\"}", planner)
                  .statusCode())
          .isEqualTo(201);
    } finally {
      jdbc.update("DELETE FROM unit_availability WHERE unit_id = ?", post);
      jdbc.update("DELETE FROM unit WHERE id = ?", post);
    }
  }

  @Test
  void supervisorsCannotReadOrChangeUnits() throws Exception {
    assertThat(get("/api/v1/planner/units", supervisor).statusCode()).isEqualTo(403);
    assertThat(get("/api/v1/planner/staffing", supervisor).statusCode()).isEqualTo(403);
    assertThat(get("/api/v1/planner/flagged-shifts", supervisor).statusCode()).isEqualTo(403);
  }

  private Map<String, Object> unitRow(Map<String, Object> period, UUID unitId) {
    return ((List<Map<String, Object>>) period.get("units")).stream()
        .filter(row -> unitId.toString().equals(row.get("unitId")))
        .findFirst()
        .orElseThrow();
  }

  private String firstClosureId(UUID unitId) throws Exception {
    Map<String, Object> unit =
        units().stream()
            .filter(row -> unitId.toString().equals(row.get("id")))
            .findFirst()
            .orElseThrow();
    List<Map<String, Object>> closures = (List<Map<String, Object>>) unit.get("closures");
    return (String) closures.get(0).get("id");
  }

  private List<Map<String, Object>> units() throws Exception {
    return jsonList(get("/api/v1/planner/units", planner));
  }

  private UUID unitId(String code) throws Exception {
    return UUID.fromString(
        (String)
            units().stream()
                .filter(row -> code.equals(row.get("code")))
                .findFirst()
                .orElseThrow()
                .get("id"));
  }

  private org.assertj.core.data.Offset<Double> within(double value) {
    return org.assertj.core.data.Offset.offset(value);
  }

  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private List<Map<String, Object>> jsonList(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), List.class);
  }

  private HttpResponse<String> get(String path, String token) throws Exception {
    return send("GET", path, null, token);
  }

  private HttpResponse<String> post(String path, String body, String token) throws Exception {
    return send("POST", path, body, token);
  }

  private HttpResponse<String> put(String path, String body, String token) throws Exception {
    return send("PUT", path, body, token);
  }

  private HttpResponse<String> delete(String path, String body, String token) throws Exception {
    return send("DELETE", path, body, token);
  }

  private String login(String username) throws Exception {
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
