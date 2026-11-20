package ca.shiftcircle.api.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * docs/07 §4.8 and docs/09 §2: the audit trail is readable by an auditor facility-wide and by a
 * supervisor for their units only, filters and pages, and the API offers no way to change or
 * remove an event. The audit rows are inserted once and cannot be deleted afterwards (the trigger
 * refuses), so the class keeps its own action name and filters on it.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class AuditApiTest {

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
  /**
   * Assignments and entries are dated off the demo day on purpose: the wall-display test asserts
   * exact hourly coverage for Unit A on 2026-11-19, and every class shares one database.
   */
  private static final LocalDate FIXTURE_DAY = TODAY.minusDays(9);
  private static final String ACTION = "audit_viewer_fixture";
  private static final String OTHER_ACTION = "audit_viewer_other";

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID EMP_A = UUID.fromString("99999999-9999-9999-9999-000000000011");
  private static final UUID EMP_B = UUID.fromString("99999999-9999-9999-9999-000000000012");
  private static final UUID ASSIGN_A = UUID.fromString("99999999-9999-9999-9999-000000000013");
  private static final UUID ASSIGN_B = UUID.fromString("99999999-9999-9999-9999-000000000014");
  private static final UUID ENTRY_A = UUID.fromString("99999999-9999-9999-9999-000000000015");
  private static final UUID RULE_ENTITY = UUID.fromString("99999999-9999-9999-9999-000000000016");

  private static final UUID ELLIS = UUID.fromString("22222222-2222-2222-2222-000000000001");
  private static final UUID CHEN = UUID.fromString("22222222-2222-2222-2222-000000000002");

  private UUID period;
  private long assignARow;
  private long assignBRow;
  private long entryRow;
  private long periodRow;
  private long ruleRow;

  @BeforeAll
  void fixture() throws Exception {
    employee(EMP_A, "E-AUD-A", "Avery", "Audit", UNIT_A);
    employee(EMP_B, "E-AUD-B", "Blair", "Audit", UNIT_B);
    assignment(ASSIGN_A, EMP_A, UNIT_A);
    assignment(ASSIGN_B, EMP_B, UNIT_B);
    period = periodContainingToday();
    jdbc.update(
        "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
            + " start_at, end_at, hours, entry_type, pay_code)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, 8.0, 'ACTUAL', 'REG') ON CONFLICT (id) DO NOTHING",
        ENTRY_A,
        EMP_A,
        period,
        ASSIGN_A,
        FIXTURE_DAY,
        Timestamp.from(FIXTURE_DAY.atTime(7, 0).atZone(REGINA).toInstant()),
        Timestamp.from(FIXTURE_DAY.atTime(15, 0).atZone(REGINA).toInstant()));

    assignARow = audit(ELLIS, "shift_assignment", ASSIGN_A, "2026-11-19T18:00:00Z");
    assignBRow = audit(ELLIS, "shift_assignment", ASSIGN_B, "2026-11-18T18:00:00Z");
    entryRow = audit(ELLIS, "time_entry", ENTRY_A, "2026-11-19T19:00:00Z");
    periodRow = audit(CHEN, "pay_period", period, "2026-11-19T20:00:00Z");
    ruleRow = audit(CHEN, "rule_set_version", RULE_ENTITY, "2026-11-18T17:00:00Z");
    auditRow(CHEN, OTHER_ACTION, "shift_assignment", ASSIGN_A, "2026-11-19T21:00:00Z");

    for (String user :
        new String[] {
          "a.reviewer", "m.ellis", "j.chen", "t.nakamura", "l.fraser", "p.singh", "tv.display"
        }) {
      tokens.put(user, login(user));
    }
  }

  private void employee(UUID id, String number, String first, String last, UUID unit) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, ?, ?, ?, ?, DATE '2015-01-01') ON CONFLICT (id) DO NOTHING",
        id,
        number,
        first,
        last,
        unit);
  }

  private void assignment(UUID id, UUID employee, UUID unit) {
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source)"
            + " SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED', 'ROTATION'"
            + " FROM shift_template t WHERE t.code = 'D8' ON CONFLICT (id) DO NOTHING",
        id,
        employee,
        unit,
        Timestamp.from(FIXTURE_DAY.atTime(7, 0).atZone(REGINA).toInstant()),
        Timestamp.from(FIXTURE_DAY.atTime(15, 0).atZone(REGINA).toInstant()),
        FIXTURE_DAY);
  }

  private UUID periodContainingToday() {
    List<UUID> existing =
        jdbc.queryForList(
            "SELECT id FROM pay_period WHERE ? BETWEEN start_date AND end_date", UUID.class, TODAY);
    if (!existing.isEmpty()) {
      return existing.get(0);
    }
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, 'OPEN')",
        id,
        TODAY.minusDays(5),
        TODAY.plusDays(5));
    return id;
  }

  private long audit(UUID actor, String entityType, UUID entityId, String occurredAt) {
    return auditRow(actor, ACTION, entityType, entityId, occurredAt);
  }

  private long auditRow(
      UUID actor, String action, String entityType, UUID entityId, String occurredAt) {
    return jdbc.queryForObject(
        "INSERT INTO audit_event (occurred_at, actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES (?::timestamptz, ?, ?, ?, ?, '{\"fixture\":true}'::jsonb) RETURNING id",
        Long.class,
        occurredAt,
        actor,
        action,
        entityType,
        entityId);
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

  private HttpResponse<String> send(String method, String path, String user) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .method(
                method,
                method.equals("DELETE")
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString("{}"))
            .header("Content-Type", "application/json");
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
  private List<Map<String, Object>> items(HttpResponse<String> response) throws Exception {
    return (List<Map<String, Object>>) json(response).get("items");
  }

  private static long id(Map<String, Object> item) {
    return ((Number) item.get("id")).longValue();
  }

  @Test
  void theAuditorSeesEverythingAndTheFiltersNarrowIt() throws Exception {
    HttpResponse<String> response = get("/api/v1/audit-events?action=" + ACTION, "a.reviewer");

    assertThat(response.statusCode()).isEqualTo(200);
    List<Map<String, Object>> items = items(response);
    assertThat(items).hasSize(5);
    Map<String, Object> newest = items.get(0);
    assertThat(id(newest)).isEqualTo(ruleRow);
    assertThat(newest.get("entityType")).isEqualTo("rule_set_version");
    Map<String, Object> actor = (Map<String, Object>) newest.get("actor");
    assertThat(actor.get("username")).isEqualTo("j.chen");
    assertThat(actor.get("displayName")).isEqualTo("J. Chen");
    assertThat(newest.get("occurredAt")).isEqualTo("2026-11-18T17:00:00Z");
    assertThat(newest.get("after")).isEqualTo(Map.of("fixture", true));

    assertThat(items(get("/api/v1/audit-events?action=" + ACTION + "&actor=m.ellis", "a.reviewer")))
        .hasSize(3);
    assertThat(items(get("/api/v1/audit-events?action=" + ACTION + "&actor=j.chen", "a.reviewer")))
        .hasSize(2);
    assertThat(
            items(get("/api/v1/audit-events?action=" + ACTION + "&actor=nobody", "a.reviewer")))
        .isEmpty();

    List<Map<String, Object>> byEntity =
        items(
            get(
                "/api/v1/audit-events?action="
                    + ACTION
                    + "&entityType=shift_assignment&entityId="
                    + ASSIGN_A,
                "a.reviewer"));
    assertThat(byEntity).hasSize(1);
    assertThat(id(byEntity.get(0))).isEqualTo(assignARow);

    List<Map<String, Object>> onTheNineteenth =
        items(
            get(
                "/api/v1/audit-events?action="
                    + ACTION
                    + "&entityType=shift_assignment&from=2026-11-19&to=2026-11-19",
                "a.reviewer"));
    assertThat(onTheNineteenth).hasSize(1);
    assertThat(id(onTheNineteenth.get(0))).isEqualTo(assignARow);
  }

  @Test
  void aSupervisorSeesOnlyTheirUnitsAndNotRuleChanges() throws Exception {
    String action = "/api/v1/audit-events?action=" + ACTION;

    assertThat(items(get(action + "&entityId=" + ASSIGN_A, "m.ellis"))).hasSize(1);
    assertThat(items(get(action + "&entityId=" + ASSIGN_B, "m.ellis"))).hasSize(1);
    assertThat(items(get(action + "&entityId=" + ASSIGN_A, "j.chen"))).isEmpty();
    assertThat(items(get(action + "&entityId=" + ASSIGN_B, "j.chen"))).isEmpty();

    assertThat(items(get(action + "&entityId=" + ENTRY_A, "m.ellis"))).hasSize(1);
    assertThat(items(get(action + "&entityId=" + ENTRY_A, "j.chen"))).isEmpty();

    // A facility-wide pay period is visible to any supervisor with a scope; a rule change is not a
    // supervisor's business.
    assertThat(items(get(action + "&entityId=" + period, "m.ellis"))).hasSize(1);
    assertThat(items(get(action + "&entityId=" + period, "j.chen"))).hasSize(1);
    assertThat(items(get(action + "&entityId=" + RULE_ENTITY, "m.ellis"))).isEmpty();
    assertThat(items(get(action + "&entityId=" + RULE_ENTITY, "j.chen"))).isEmpty();
    assertThat(items(get(action + "&entityId=" + RULE_ENTITY, "a.reviewer"))).hasSize(1);
  }

  @Test
  void pagesWalkBackwardsWithoutDuplicates() throws Exception {
    String path = "/api/v1/audit-events?action=" + ACTION + "&limit=2";
    List<Long> seen = new ArrayList<>();
    Long before = null;
    int pages = 0;
    while (true) {
      HttpResponse<String> response = get(path + (before == null ? "" : "&beforeId=" + before), "a.reviewer");
      assertThat(response.statusCode()).isEqualTo(200);
      List<Map<String, Object>> items = items(response);
      items.forEach(item -> seen.add(id(item)));
      pages++;
      Object next = json(response).get("nextBeforeId");
      if (next == null) {
        break;
      }
      before = ((Number) next).longValue();
      assertThat(pages).isLessThan(10);
    }

    assertThat(seen).hasSize(5).doesNotHaveDuplicates();
    assertThat(seen).isSortedAccordingTo((left, right) -> Long.compare(right, left));
    assertThat(pages).isEqualTo(3);
  }

  @Test
  void theTrailCannotBeChangedThroughTheApiOrTheDatabase() throws Exception {
    for (String method : new String[] {"POST", "PUT", "PATCH", "DELETE"}) {
      assertThat(send(method, "/api/v1/audit-events", "a.reviewer").statusCode())
          .as(method + " must not be accepted")
          .isEqualTo(405);
    }

    try {
      jdbc.update("UPDATE audit_event SET action = 'tampered' WHERE id = ?", assignARow);
      fail("the append-only trigger must refuse UPDATE");
    } catch (DataAccessException expected) {
      assertThat(sqlState(expected)).isEqualTo("42501");
    }
    try {
      jdbc.update("DELETE FROM audit_event WHERE id = ?", assignARow);
      fail("the append-only trigger must refuse DELETE");
    } catch (DataAccessException expected) {
      assertThat(sqlState(expected)).isEqualTo("42501");
    }
  }

  @Test
  void onlyTheAuditorAndSupervisorsMayReadTheTrail() throws Exception {
    for (String user : new String[] {"a.reviewer", "m.ellis", "j.chen"}) {
      assertThat(get("/api/v1/audit-events?limit=1", user).statusCode()).isEqualTo(200);
    }
    for (String user : new String[] {"t.nakamura", "l.fraser", "p.singh", "tv.display"}) {
      assertThat(get("/api/v1/audit-events?limit=1", user).statusCode())
          .as(user + " may not read the audit trail")
          .isEqualTo(403);
    }
    assertThat(get("/api/v1/audit-events", null).statusCode()).isEqualTo(401);
  }

  private static String sqlState(Throwable error) {
    Throwable cause = error;
    while (cause.getCause() != null) {
      cause = cause.getCause();
    }
    return cause instanceof java.sql.SQLException sql ? sql.getSQLState() : null;
  }
}
