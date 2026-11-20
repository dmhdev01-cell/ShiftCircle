package ca.shiftcircle.api.assignments;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
 * Moving and cancelling a shift (docs/07 §4.2): If-Match, the rule pipeline on the target, the
 * locked-period and started-shift refusals, the open-shift reset, audit rows, scope and roles.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class AssignmentMoveCancelApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID UNIT_C = UUID.fromString("11111111-1111-1111-1111-000000000003");
  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000099");

  @BeforeEach
  void fixture() {
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM absence WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "DELETE FROM open_shift WHERE filled_assignment_id IN"
            + " (SELECT id FROM shift_assignment WHERE employee_id = ?)",
        EMPLOYEE);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-MC', 'Mira', 'Cancel', ?, DATE '2018-01-01')"
            + " ON CONFLICT (id) DO UPDATE SET active = true",
        EMPLOYEE,
        UNIT_B);
  }

  // ---------------------------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------------------------

  @Test
  void cancellingMarksCancelledAuditsTheReasonAndRefusesASecondCancel() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    String token = login("m.ellis");

    HttpResponse<String> response =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}", token,
            "\"0\"");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.headers().firstValue("ETag")).contains("\"1\"");
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("status")).isEqualTo("CANCELLED");
    assertThat(body.get("version")).isEqualTo(1);
    assertThat(statusOf(id)).isEqualTo("CANCELLED");
    assertThat(versionOf(id)).as("the row is kept, never deleted").isEqualTo(1);

    Map<String, Object> audit =
        jdbc.queryForMap(
            "SELECT before::text AS before, after::text AS after FROM audit_event"
                + " WHERE action = 'cancel_assignment' AND entity_id = ?",
            id);
    assertThat((String) audit.get("before")).as("the old row is in the audit").contains("PLANNED");
    assertThat((String) audit.get("after"))
        .contains("CANCELLED")
        .contains("Sick call, no relief");

    HttpResponse<String> again =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}", token,
            "\"1\"");
    assertThat(again.statusCode()).isEqualTo(409);
    assertThat((String) mapper.readValue(again.body(), Map.class).get("type"))
        .endsWith("/already-cancelled");
  }

  @Test
  void cancelNeedsAReasonAndTheCurrentVersion() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    String token = login("m.ellis");

    HttpResponse<String> shortReason =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"too short\"}", token, "\"0\"");
    assertThat(shortReason.statusCode()).isEqualTo(400);
    assertThat(statusOf(id)).isEqualTo("PLANNED");

    HttpResponse<String> noBody =
        send("DELETE", "/api/v1/assignments/" + id, null, token, "\"0\"");
    assertThat(noBody.statusCode()).isEqualTo(400);

    HttpResponse<String> tooLong =
        send(
            "DELETE",
            "/api/v1/assignments/" + id,
            "{\"reason\":\"" + "x".repeat(501) + "\"}",
            token,
            "\"0\"");
    assertThat(tooLong.statusCode()).isEqualTo(400);
    String tooLongTitle = (String) mapper.readValue(tooLong.body(), Map.class).get("title");
    assertThat(tooLongTitle).contains("reason").contains("500");
    assertThat(statusOf(id)).isEqualTo("PLANNED");

    HttpResponse<String> noIfMatch =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}", token,
            null);
    assertThat(noIfMatch.statusCode()).isEqualTo(428);
    assertThat((String) mapper.readValue(noIfMatch.body(), Map.class).get("type"))
        .endsWith("/if-match-required");

    HttpResponse<String> stale =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}", token,
            "\"9\"");
    assertThat(stale.statusCode()).isEqualTo(412);
    assertThat((String) mapper.readValue(stale.body(), Map.class).get("type"))
        .endsWith("/stale-version");

    HttpResponse<String> weak =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}", token,
            "W/\"0\"");
    assertThat(weak.statusCode()).as("If-Match needs a strong validator").isEqualTo(400);
    assertThat(statusOf(id)).isEqualTo("PLANNED");
  }

  @Test
  void cancellingIsRefusedInALockedPayPeriod() throws Exception {
    UUID id = insertAssignment("D8", "2027-04-05T07:00:00-06:00", "ROSTERED");
    UUID period = insertPayPeriod(LocalDate.of(2027, 4, 1), LocalDate.of(2027, 4, 14), "LOCKED");
    try {
      HttpResponse<String> response =
          send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}",
              login("m.ellis"), "\"0\"");
      assertThat(response.statusCode()).isEqualTo(409);
      assertThat((String) mapper.readValue(response.body(), Map.class).get("type"))
          .endsWith("/pay-period-locked");
      assertThat(statusOf(id)).isEqualTo("PLANNED");
    } finally {
      jdbc.update("DELETE FROM pay_period WHERE id = ?", period);
    }
  }

  @Test
  void cancellingIsRefusedOnceTheShiftHasStarted() throws Exception {
    UUID id = insertAssignment("D8", "2026-11-18T07:00:00-06:00", "ROSTERED");

    HttpResponse<String> response =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}",
            login("m.ellis"), "\"0\"");

    assertThat(response.statusCode()).isEqualTo(409);
    assertThat((String) mapper.readValue(response.body(), Map.class).get("type"))
        .endsWith("/shift-started");
    assertThat(statusOf(id)).isEqualTo("PLANNED");
  }

  @Test
  void cancellingIsRefusedWhenAnActualExists() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    UUID period = insertPayPeriod(LocalDate.of(2027, 2, 1), LocalDate.of(2027, 2, 14), "OPEN");
    UUID entry = UUID.randomUUID();
    try {
      jdbc.update(
          "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
              + " start_at, end_at, hours, entry_type, pay_code, rule_set_version_id)"
              + " VALUES (?, ?, ?, ?, DATE '2027-02-01', TIMESTAMPTZ '2027-02-01 07:00:00-06',"
              + " TIMESTAMPTZ '2027-02-01 15:00:00-06', 8, 'ACTUAL', 'REG',"
              + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1))",
          entry,
          EMPLOYEE,
          period,
          id);

      HttpResponse<String> response =
          send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}",
              login("m.ellis"), "\"0\"");
      assertThat(response.statusCode()).isEqualTo(409);
      assertThat((String) mapper.readValue(response.body(), Map.class).get("type"))
          .endsWith("/actual-recorded");
      assertThat(statusOf(id)).isEqualTo("PLANNED");
    } finally {
      jdbc.update("DELETE FROM time_entry WHERE id = ?", entry);
      jdbc.update("DELETE FROM pay_period WHERE id = ?", period);
    }
  }

  @Test
  void cancellingIsRefusedWhenAnAbsenceReferencesTheShift() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    jdbc.update(
        "INSERT INTO absence (id, employee_id, shift_assignment_id, type, start_at, end_at)"
            + " VALUES (?, ?, ?, 'SICK', TIMESTAMPTZ '2027-02-01 07:00:00-06',"
            + " TIMESTAMPTZ '2027-02-01 15:00:00-06')",
        UUID.randomUUID(),
        EMPLOYEE,
        id);

    HttpResponse<String> response =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}",
            login("m.ellis"), "\"0\"");

    assertThat(response.statusCode()).isEqualTo(409);
    assertThat((String) mapper.readValue(response.body(), Map.class).get("type"))
        .endsWith("/absence-recorded");
    assertThat(statusOf(id)).isEqualTo("PLANNED");
  }

  @Test
  void cancellingAFilledOpenShiftPutsTheGapBackOnTheBoard() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "EXTRA");
    UUID open = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status,"
            + " filled_assignment_id) SELECT ?, ?, t.id, TIMESTAMPTZ '2027-02-01 07:00:00-06',"
            + " TIMESTAMPTZ '2027-02-01 15:00:00-06', 'SICK_CALL', 'FILLED', ?"
            + " FROM shift_template t WHERE t.code = 'D8'",
        open,
        UNIT_B,
        id);

    HttpResponse<String> response =
        send("DELETE", "/api/v1/assignments/" + id, "{\"reason\":\"Sick call, no relief\"}",
            login("m.ellis"), "\"0\"");

    assertThat(response.statusCode()).isEqualTo(200);
    Map<String, Object> shift =
        jdbc.queryForMap("SELECT status, filled_assignment_id FROM open_shift WHERE id = ?", open);
    assertThat(shift.get("status")).isEqualTo("OPEN");
    assertThat(shift.get("filled_assignment_id")).isNull();
  }

  @Test
  void cancelHonoursRolesScopeAndUnknownIds() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    String body = "{\"reason\":\"Sick call, no relief\"}";

    assertThat(
            send("DELETE", "/api/v1/assignments/" + id, body, login("t.nakamura"), "\"0\"")
                .statusCode())
        .as("employees cannot cancel")
        .isEqualTo(403);
    assertThat(
            send("DELETE", "/api/v1/assignments/" + id, body, login("j.chen"), "\"0\"")
                .statusCode())
        .as("another unit's supervisor sees a 404")
        .isEqualTo(404);
    assertThat(
            send("DELETE", "/api/v1/assignments/" + UUID.randomUUID(), body, login("m.ellis"),
                    "\"0\"")
                .statusCode())
        .isEqualTo(404);
  }

  // ---------------------------------------------------------------------------------------------
  // Move
  // ---------------------------------------------------------------------------------------------

  @Test
  void movingUpdatesInPlaceAuditsBothSidesAndBumpsTheVersion() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");

    HttpResponse<String> response =
        send("PATCH", "/api/v1/assignments/" + id, moveBody(UNIT_B, EMPLOYEE, "D8",
            "2027-02-02T07:00:00-06:00"), login("m.ellis"), "\"0\"");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.headers().firstValue("ETag")).contains("\"1\"");
    Map<?, ?> body = mapper.readValue(response.body(), Map.class);
    assertThat(body.get("id")).isEqualTo(id.toString());
    assertThat(body.get("version")).isEqualTo(1);
    assertThat(body.get("outcome")).isEqualTo("PASS");
    assertThat(
            jdbc.queryForObject(
                "SELECT start_at FROM shift_assignment WHERE id = ?", Timestamp.class, id)
                .toInstant())
        .isEqualTo(OffsetDateTime.parse("2027-02-02T07:00:00-06:00").toInstant());
    assertThat(versionOf(id)).isEqualTo(1);

    Map<String, Object> audit =
        jdbc.queryForMap(
            "SELECT before::text AS before, after::text AS after FROM audit_event"
                + " WHERE action = 'move_assignment' AND entity_id = ?",
            id);
    assertThat((String) audit.get("before")).contains("2027-02-01");
    assertThat((String) audit.get("after")).contains("2027-02-02");
  }

  @Test
  void movingRunsTheSameRulePipelineAndAnOverrideSavesIt() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    // A night shift ending exactly when the target starts: zero rest, U-01 blocks.
    UUID night = insertAssignment("N8", "2027-02-03T23:00:00-06:00", "ROSTERED");
    String token = login("m.ellis");
    String target = moveBody(UNIT_B, EMPLOYEE, "D8", "2027-02-04T07:00:00-06:00");

    HttpResponse<String> blocked = send("PATCH", "/api/v1/assignments/" + id, target, token, "\"0\"");
    assertThat(blocked.statusCode()).isEqualTo(422);
    assertThat((String) mapper.readValue(blocked.body(), Map.class).get("type"))
        .endsWith("/blocked-by-rules");
    assertThat(statusOf(id)).isEqualTo("PLANNED");
    assertThat(versionOf(id)).isEqualTo(0);

    List<String> warns =
        warnCodes(send("POST", "/api/v1/rule-checks", target, token, null));
    String withOverride =
        target.substring(0, target.length() - 1)
            + ",\"acknowledgeWarnings\":"
            + mapper.writeValueAsString(warns)
            + ",\"override\":{\"reason\":\"Lockdown, relief unavailable\"}}";
    HttpResponse<String> saved =
        send("PATCH", "/api/v1/assignments/" + id, withOverride, token, "\"0\"");

    assertThat(saved.statusCode()).isEqualTo(200);
    assertThat(count("SELECT count(*) FROM override WHERE reason LIKE 'Lockdown%'"))
        .isGreaterThanOrEqualTo(1);
    assertThat(jdbc.queryForObject(
            "SELECT override_id FROM shift_assignment WHERE id = ?", UUID.class, id))
        .isNotNull();
    assertThat(night).isNotEqualTo(id);
  }

  @Test
  void aMoveDoesNotConflictWithTheSlotItReplaces() throws Exception {
    UUID id = insertAssignment("P12", "2027-02-01T07:00:00-06:00", "ROSTERED");

    HttpResponse<String> response =
        send("PATCH", "/api/v1/assignments/" + id, moveBody(UNIT_B, EMPLOYEE, "P12",
            "2027-02-01T08:00:00-06:00"), login("m.ellis"), "\"0\"");

    assertThat(response.statusCode())
        .as("the old 07:00-19:00 slot is excluded, so the target is not 0 h of rest from itself")
        .isEqualTo(200);
  }

  @Test
  void movingIntoALockedPeriodOrAPastSlotIsRefused() throws Exception {
    UUID current = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    UUID period = insertPayPeriod(LocalDate.of(2027, 5, 3), LocalDate.of(2027, 5, 16), "LOCKED");
    try {
      HttpResponse<String> locked =
          send("PATCH", "/api/v1/assignments/" + current,
              moveBody(UNIT_B, EMPLOYEE, "D8", "2027-05-04T07:00:00-06:00"), login("m.ellis"),
              "\"0\"");
      assertThat(locked.statusCode()).isEqualTo(409);
      assertThat((String) mapper.readValue(locked.body(), Map.class).get("type"))
          .endsWith("/pay-period-locked");
      assertThat(versionOf(current)).isEqualTo(0);
    } finally {
      jdbc.update("DELETE FROM pay_period WHERE id = ?", period);
    }

    UUID past = insertAssignment("D8", "2026-11-18T07:00:00-06:00", "ROSTERED");
    HttpResponse<String> started =
        send("PATCH", "/api/v1/assignments/" + past,
            moveBody(UNIT_B, EMPLOYEE, "D8", "2026-11-19T07:00:00-06:00"), login("m.ellis"),
            "\"0\"");
    assertThat(started.statusCode()).isEqualTo(409);
    assertThat((String) mapper.readValue(started.body(), Map.class).get("type"))
        .endsWith("/shift-started");
  }

  @Test
  void movingAShiftThatFilledAnOpenShiftIsRefused() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "EXTRA");
    UUID open = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status,"
            + " filled_assignment_id) SELECT ?, ?, t.id, TIMESTAMPTZ '2027-02-01 07:00:00-06',"
            + " TIMESTAMPTZ '2027-02-01 15:00:00-06', 'SICK_CALL', 'FILLED', ?"
            + " FROM shift_template t WHERE t.code = 'D8'",
        open,
        UNIT_B,
        id);

    HttpResponse<String> response =
        send("PATCH", "/api/v1/assignments/" + id,
            moveBody(UNIT_B, EMPLOYEE, "D8", "2027-02-02T07:00:00-06:00"), login("m.ellis"),
            "\"0\"");

    assertThat(response.statusCode()).isEqualTo(409);
    assertThat((String) mapper.readValue(response.body(), Map.class).get("type"))
        .endsWith("/fills-open-shift");
    assertThat(versionOf(id)).isEqualTo(0);
  }

  @Test
  void aMoveNeedsBothUnitsInScopeAndAllFourFields() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");

    HttpResponse<String> outOfScope =
        send("PATCH", "/api/v1/assignments/" + id,
            moveBody(UNIT_C, EMPLOYEE, "D8", "2027-02-02T07:00:00-06:00"), login("m.ellis"),
            "\"0\"");
    assertThat(outOfScope.statusCode()).isEqualTo(404);
    assertThat(versionOf(id)).isEqualTo(0);

    String partial =
        "{\"change\":{\"unitId\":\"" + UNIT_A + "\",\"startAt\":\"2027-02-02T07:00:00-06:00\"}}";
    assertThat(send("PATCH", "/api/v1/assignments/" + id, partial, login("m.ellis"), "\"0\"")
            .statusCode())
        .isEqualTo(400);

    String valid = moveBody(UNIT_A, EMPLOYEE, "D8", "2027-02-02T07:00:00-06:00");
    assertThat(send("PATCH", "/api/v1/assignments/" + id, valid, login("m.ellis"), null)
            .statusCode())
        .isEqualTo(428);
    assertThat(send("PATCH", "/api/v1/assignments/" + id, valid, login("m.ellis"), "\"3\"")
            .statusCode())
        .isEqualTo(412);
  }

  @Test
  void movingKeepsTheKindAndSourceOfTheShift() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "EXTRA");

    HttpResponse<String> response =
        send("PATCH", "/api/v1/assignments/" + id,
            moveBody(UNIT_A, EMPLOYEE, "D8", "2027-02-02T07:00:00-06:00"), login("m.ellis"),
            "\"0\"");

    assertThat(response.statusCode()).isEqualTo(200);
    Map<String, Object> row =
        jdbc.queryForMap("SELECT kind, source, unit_id FROM shift_assignment WHERE id = ?", id);
    assertThat(row.get("kind")).isEqualTo("EXTRA");
    assertThat(row.get("source")).isEqualTo("MANUAL");
    assertThat(row.get("unit_id")).isEqualTo(UNIT_A);
  }

  @Test
  void twoConcurrentMovesWithOneVersionCannotBothWin() throws Exception {
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");
    String token = login("m.ellis");
    String first = moveBody(UNIT_B, EMPLOYEE, "D8", "2027-02-05T07:00:00-06:00");
    String second = moveBody(UNIT_B, EMPLOYEE, "D8", "2027-02-06T07:00:00-06:00");

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      CountDownLatch ready = new CountDownLatch(2);
      CountDownLatch go = new CountDownLatch(1);
      List<Future<HttpResponse<String>>> moves = new ArrayList<>();
      for (String body : List.of(first, second)) {
        moves.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  go.await();
                  return send("PATCH", "/api/v1/assignments/" + id, body, token, "\"0\"");
                }));
      }
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();

      List<Integer> statuses = new ArrayList<>();
      for (Future<HttpResponse<String>> move : moves) {
        statuses.add(move.get(30, TimeUnit.SECONDS).statusCode());
      }
      assertThat(statuses)
          .as("the first move wins; the second sees version 1 and gets 412")
          .containsExactlyInAnyOrder(200, 412);
      assertThat(versionOf(id)).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void moveHonoursRolesAndUnknownIds() throws Exception {
    String body = moveBody(UNIT_B, EMPLOYEE, "D8", "2027-02-02T07:00:00-06:00");
    UUID id = insertAssignment("D8", "2027-02-01T07:00:00-06:00", "ROSTERED");

    assertThat(send("PATCH", "/api/v1/assignments/" + id, body, login("t.nakamura"), "\"0\"")
            .statusCode())
        .isEqualTo(403);
    assertThat(send("PATCH", "/api/v1/assignments/" + UUID.randomUUID(), body, login("m.ellis"),
            "\"0\"")
            .statusCode())
        .isEqualTo(404);
  }

  // ---------------------------------------------------------------------------------------------
  // Fixtures and helpers
  // ---------------------------------------------------------------------------------------------

  private UUID insertAssignment(String template, String start, String kind) {
    UUID id = UUID.randomUUID();
    Instant startAt = OffsetDateTime.parse(start).toInstant();
    Integer minutes =
        jdbc.queryForObject(
            "SELECT duration_minutes FROM shift_template WHERE code = ?", Integer.class, template);
    Instant endAt = startAt.plusSeconds(minutes.longValue() * 60);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, ?, 'MANUAL'"
            + " FROM shift_template t WHERE t.code = ?",
        id,
        EMPLOYEE,
        UNIT_B,
        Timestamp.from(startAt),
        Timestamp.from(endAt),
        startAt.atZone(REGINA).toLocalDate(),
        kind,
        template);
    return id;
  }

  private UUID insertPayPeriod(LocalDate from, LocalDate to, String status) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, ?)",
        id,
        from,
        to,
        status);
    return id;
  }

  private String statusOf(UUID id) {
    return jdbc.queryForObject(
        "SELECT status FROM shift_assignment WHERE id = ?", String.class, id);
  }

  private int versionOf(UUID id) {
    Integer version =
        jdbc.queryForObject(
            "SELECT version FROM shift_assignment WHERE id = ?", Integer.class, id);
    return version == null ? -1 : version;
  }

  private String moveBody(UUID unitId, UUID employeeId, String template, String startAt) {
    return "{\"change\":{\"employeeId\":\"" + employeeId + "\",\"unitId\":\"" + unitId + "\","
        + "\"shiftTemplate\":\"" + template + "\",\"startAt\":\"" + startAt + "\"}}";
  }

  private List<String> warnCodes(HttpResponse<String> response) throws Exception {
    List<?> results = (List<?>) mapper.readValue(response.body(), Map.class).get("ruleResults");
    return results.stream()
        .map(result -> (Map<?, ?>) result)
        .filter(result -> "WARN".equals(result.get("outcome")))
        .map(result -> (String) result.get("ruleCode"))
        .toList();
  }

  private HttpResponse<String> send(
      String method, String path, String body, String token, String ifMatch) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body == null) {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    }
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    if (ifMatch != null) {
      builder.header("If-Match", ifMatch);
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
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private int count(String sql) {
    Integer value = jdbc.queryForObject(sql, Integer.class);
    return value == null ? 0 : value;
  }
}
