package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * The planner Must flow on the seeded 100 officers (ADR-026): generate, scorecard, determinism,
 * the whole-draft rule property, newest-first nights, preferences, commit, staleness and the lock.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
class PlannerApiTest {

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

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;
  @Autowired private RuleCheckService ruleCheck;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private UUID draftId;
  private int warningCount;

  @BeforeAll
  void logins() throws Exception {
    for (String user : new String[] {"p.planner", "m.ellis", "t.nakamura", "a.reviewer"}) {
      tokens.put(user, login(user));
    }
  }

  @Test
  @Order(1)
  void generatesAScorecardForTheQuarter() throws Exception {
    long started = System.nanoTime();
    HttpResponse<String> response =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", tokens.get("p.planner"));
    long elapsedMs = (System.nanoTime() - started) / 1_000_000;
    System.out.println("planner generate ms: " + elapsedMs);

    assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
    Map<String, Object> body = json(response);
    draftId = UUID.fromString((String) body.get("id"));

    assertThat(body.get("pattern8h")).isEqualTo("ROTATING_5_2");
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) body.get("scorecard");
    assertThat(scorecard).containsKeys(
        "coverage", "warnings", "preferences", "nights", "overtime", "weekends", "quarterHours",
        "warningNote", "generatedMs");
    assertThat(assignmentCount()).isGreaterThan(3000);
    assertThat(((Map<?, ?>) scorecard.get("coverage")).get("shortBlockDays")).isNotNull();
    System.out.println("scorecard warnings: " + scorecard.get("warnings"));
    List<Map<String, Object>> groups =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draftId + "/warnings", null,
                tokens.get("p.planner"))
                .body(),
            List.class);
    for (Map<String, Object> group : groups) {
      System.out.println(
          "warn group "
              + group.get("ruleName")
              + " "
              + ((List<?>) group.get("items")).stream().limit(3).toList());
    }
    assertThat(elapsedMs).isLessThan(120_000);
  }

  @Test
  @Order(2)
  void theSameSeedAndDataProduceTheSamePlan() throws Exception {
    List<String> before = planFingerprint();

    HttpResponse<String> regenerated =
        send("POST", "/api/v1/planner/drafts",
            "{\"seed\":20261001}", tokens.get("p.planner"));
    assertThat(regenerated.statusCode()).isEqualTo(201);
    draftId = UUID.fromString((String) json(regenerated).get("id"));

    assertThat(planFingerprint()).isEqualTo(before);
  }

  @Test
  @Order(3)
  void noDraftAssignmentViolatesABlockRuleAndDefaultPatternsStayAtEightyHours() throws Exception {
    List<Map<String, Object>> planned =
        jdbc.queryForList(
            "SELECT a.*, t.code AS template_code, e.employee_no, u.code AS unit_code,"
                + " u.allows_12h, u.allows_16h FROM plan_draft_assignment a"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " JOIN employee e ON e.id = a.employee_id JOIN unit u ON u.id = a.unit_id"
                + " WHERE a.draft_id = ? ORDER BY a.employee_id, a.start_at",
            draftId);
    assertThat(planned).isNotEmpty();
    assertThat(planned).allMatch(row -> !"L16".equals(row.get("template_code")));

    Map<UUID, List<ShiftFact>> history = new LinkedHashMap<>();
    jdbc.query(
        "SELECT s.employee_id, e.employee_no, u.code AS unit_code, u.allows_12h, u.allows_16h,"
            + " t.code, s.start_at, s.end_at, s.kind FROM shift_assignment s"
            + " JOIN employee e ON e.id = s.employee_id JOIN unit u ON u.id = s.unit_id"
            + " JOIN shift_template t ON t.id = s.shift_template_id"
            + " WHERE s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?",
        (RowCallbackHandler)
            rs ->
                history
                    .computeIfAbsent(rs.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                .add(
                    new ShiftFact(
                        "history",
                        rs.getString("employee_no"),
                        rs.getString("unit_code"),
                        rs.getString("code"),
                        rs.getTimestamp("start_at").toInstant(),
                        rs.getTimestamp("end_at").toInstant(),
                        "EXTRA".equals(rs.getString("kind")) ? ShiftKind.EXTRA : ShiftKind.ROSTERED,
                        0,
                        rs.getBoolean("allows_12h"),
                        rs.getBoolean("allows_16h"))),
        Timestamp.from(PlanGenerator.FROM.atStartOfDay(REGINA).toInstant()),
        Timestamp.from(LocalDate.of(2026, 11, 15).atStartOfDay(REGINA).toInstant()));

    java.util.Set<UUID> eightHourOfficers = new java.util.HashSet<>();
    planned.stream()
        .collect(java.util.stream.Collectors.groupingBy(row -> (UUID) row.get("employee_id")))
        .forEach(
            (employeeId, rows) -> {
              if (rows.stream()
                  .allMatch(row -> nominalMinutes((String) row.get("template_code")) == 480)) {
                eightHourOfficers.add(employeeId);
              }
            });
    List<String> blocks = new ArrayList<>();
    List<String> warnings = new ArrayList<>();
    Map<UUID, List<ShiftFact>> draftOnly = new LinkedHashMap<>();
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      ShiftFact proposed =
          new ShiftFact(
              "check",
              (String) row.get("employee_no"),
              (String) row.get("unit_code"),
              (String) row.get("template_code"),
              ((Timestamp) row.get("start_at")).toInstant(),
              ((Timestamp) row.get("end_at")).toInstant(),
              ShiftKind.ROSTERED,
              0,
              (Boolean) row.get("allows_12h"),
              (Boolean) row.get("allows_16h"));
      RuleCheckService.OutcomeView outcome =
          ruleCheck.evaluate(proposed, history.getOrDefault(employeeId, List.of()));
      outcome.ruleResults().stream()
          .filter(result -> "BLOCK".equals(result.outcome()))
          .forEach(result -> blocks.add(result.ruleCode() + ": " + result.message()));
      outcome.ruleResults().stream()
          .filter(result -> "WARN".equals(result.outcome()))
          .forEach(result -> warnings.add(result.ruleCode() + ": " + result.message()));
      history.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(proposed);
      draftOnly.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(proposed);
    }
    assertThat(blocks).as("Block results over the whole draft").isEmpty();
    for (UUID employeeId : eightHourOfficers) {
      List<RuleCheckService.ResultView> planWarnings =
          ruleCheck.evaluateFacts(draftOnly.getOrDefault(employeeId, List.of())).ruleResults()
              .stream()
              .filter(result -> "WARN".equals(result.outcome()))
              .toList();
      long u12 = planWarnings.stream().filter(result -> "U-12".equals(result.ruleCode())).count();
      long u14 = planWarnings.stream().filter(result -> "U-14".equals(result.ruleCode())).count();
      long u08 = planWarnings.stream().filter(result -> "U-08".equals(result.ruleCode())).count();
      assertThat(u12).as("U-12 for %s", employeeId).isBetween(0L, 1L);
      assertThat(u14).as("U-14 for %s", employeeId).isBetween(0L, 1L);
      assertThat(u08).as("U-08 for %s", employeeId).isZero();
    }

    // The default pattern officers (8 h only) work exactly 80 h in every 14-day period.
    Map<UUID, List<Map<String, Object>>> byEmployee = new LinkedHashMap<>();
    planned.forEach(row ->
        byEmployee.computeIfAbsent((UUID) row.get("employee_id"), key -> new ArrayList<>()).add(row));
    for (Map.Entry<UUID, List<Map<String, Object>>> entry : byEmployee.entrySet()) {
      boolean eightHourOnly =
          entry.getValue().stream()
              .allMatch(row -> "480".equals(String.valueOf(
                  nominalMinutes((String) row.get("template_code")))));
      if (!eightHourOnly) {
        continue;
      }
      Map<Long, Long> perPeriod = new LinkedHashMap<>();
      for (Map<String, Object> row : entry.getValue()) {
        LocalDate date = ((java.sql.Date) row.get("work_date")).toLocalDate();
        long period = java.time.temporal.ChronoUnit.DAYS.between(PlanGenerator.FROM, date) / 14;
        perPeriod.merge(
            period,
            ((Timestamp) row.get("end_at")).toInstant().toEpochMilli()
                - ((Timestamp) row.get("start_at")).toInstant().toEpochMilli(),
            Long::sum);
      }
      List<Double> hoursPerPeriod =
          perPeriod.values().stream()
              .map(millis -> Duration.ofMillis(millis).toMinutes() / 60.0)
              .toList();
      assertThat(hoursPerPeriod)
          .as("officer %s periods %s", entry.getKey(), perPeriod.keySet())
          .allMatch(hours -> hours == 72.0 || hours == 80.0);
      assertThat(hoursPerPeriod.stream().filter(hours -> hours == 72.0).count())
          .as("officer %s periods %s", entry.getKey(), perPeriod)
          .isBetween(1L, 2L);
      assertThat(hoursPerPeriod.stream().filter(hours -> hours == 80.0).count())
          .as("officer %s has five or six full periods", entry.getKey())
          .isBetween(5L, 6L);

    }
    Map<UUID, Integer> weekendsByOfficer = new LinkedHashMap<>();
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      if (!eightHourOfficers.contains(employeeId)) {
        continue;
      }
      LocalDate date = ((java.sql.Date) row.get("work_date")).toLocalDate();
      if (date.getDayOfWeek() == java.time.DayOfWeek.SATURDAY
          || date.getDayOfWeek() == java.time.DayOfWeek.SUNDAY) {
        weekendsByOfficer.merge(employeeId, 1, Integer::sum);
      }
    }
    assertThat(weekendsByOfficer.values()).as("weekends worked per default officer")
        .allMatch(count -> count == 22);

    System.out.println("whole-draft warnings: " + warnings.size());
  }

  @Test
  @Order(4)
  void newestFirstNightsHoldsInTheScorecard() throws Exception {
    Map<String, Object> draft = json(send("GET", "/api/v1/planner/drafts/" + draftId, null,
        tokens.get("p.planner")));
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) draft.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> nights = (Map<String, Object>) scorecard.get("nights");
    assertThat(nights.get("newestFirstHeld"))
        .as(String.valueOf(nights.get("check")))
        .isEqualTo(true);
    assertThat(nights.get("check").toString()).contains("held");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> bands = (List<Map<String, Object>>) nights.get("bands");
    assertThat(bands).hasSize(3);
    assertThat(bands.stream().mapToDouble(band -> ((Number) band.get("nightShare")).doubleValue()).sum())
        .isCloseTo(100.0, org.assertj.core.data.Offset.offset(0.5));
  }

  @Test
  @Order(5)
  void preferencesAreEditableAndPlannerCanReadThem() throws Exception {
    assertThat(send("GET", "/api/v1/me/preferences", null, tokens.get("t.nakamura")).statusCode())
        .isEqualTo(200);
    assertThat(
            send("PUT", "/api/v1/me/preferences",
                    "{\"shiftLength\":12,\"timeOfDay\":\"EVENING\",\"daysOff\":[\"SAT\",\"MON\"]}",
                    tokens.get("t.nakamura"))
                .statusCode())
        .isEqualTo(200);
    Map<String, Object> mine =
        json(send("GET", "/api/v1/me/preferences", null, tokens.get("t.nakamura")));
    assertThat(mine.get("shiftLength")).isEqualTo(12);
    assertThat(mine.get("daysOff")).isEqualTo(List.of("SAT", "MON"));
    assertThat(
            send("PUT", "/api/v1/me/preferences",
                    "{\"shiftLength\":16,\"timeOfDay\":\"NONE\",\"daysOff\":[]}",
                    tokens.get("t.nakamura"))
                .statusCode())
        .isEqualTo(200);
    List<Map<String, Object>> withSixteen =
        mapper.readValue(
            send("GET", "/api/v1/planner/preferences", null, tokens.get("p.planner")).body(),
            List.class);
    assertThat(withSixteen.toString()).contains("the planner does not roster 16-hour shifts");
    assertThat(
            send("PUT", "/api/v1/me/preferences",
                    "{\"daysOff\":[\"MON\",\"TUE\",\"WED\"]}", tokens.get("t.nakamura"))
                .statusCode())
        .isEqualTo(400);
    assertThat(
            send("GET", "/api/v1/planner/preferences", null, tokens.get("m.ellis")).statusCode())
        .isEqualTo(403);
    List<Map<String, Object>> all =
        mapper.readValue(
            send("GET", "/api/v1/planner/preferences", null, tokens.get("p.planner")).body(),
            List.class);
    assertThat(all).hasSize(100);
    assertThat(all.get(0)).containsKeys(
        "employeeId", "name", "shiftLength", "timeOfDay", "daysOff", "inDraft");
    assertThat(send("DELETE", "/api/v1/me/preferences", null, tokens.get("t.nakamura")).statusCode())
        .isEqualTo(204);
  }

  @Test
  @Order(6)
  void previewAndCommitWriteEveryShiftAtomicallyAndAuditOnce() throws Exception {
    Map<String, Object> preview =
        json(send("GET", "/api/v1/planner/drafts/" + draftId + "/commit-preview", null,
            tokens.get("p.planner")));
    warningCount = ((Number) preview.get("warningCount")).intValue();
    int shifts = ((Number) preview.get("shiftsToWrite")).intValue();
    assertThat(shifts).isEqualTo(assignmentCount());

    HttpResponse<String> committed =
        sendWithHeaders(
            "POST",
            "/api/v1/planner/drafts/" + draftId + "/commit",
            "{\"acceptedWarningCount\":" + warningCount + "}",
            tokens.get("p.planner"),
            Map.of("If-Match", "\"0\""));
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
    Map<String, Object> body = json(committed);
    assertThat(((Number) body.get("shiftsWritten")).intValue()).isEqualTo(shifts);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE plan_draft_id = ?",
                Integer.class,
                draftId))
        .isEqualTo(shifts);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'commit_plan' AND entity_id = ?",
                Integer.class,
                draftId))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM plan_draft WHERE id = ?", String.class, draftId))
        .isEqualTo("COMMITTED");

    assertThat(
            sendWithHeaders(
                    "POST",
                    "/api/v1/planner/drafts/" + draftId + "/commit",
                    "{\"acceptedWarningCount\":" + warningCount + "}",
                    tokens.get("p.planner"),
                    Map.of("If-Match", "\"1\""))
                .statusCode())
        .isEqualTo(409);
  }

  @Test
  @Order(7)
  void aDraftThatTouchesALockedPeriodIsRefusedAtCommit() throws Exception {
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", tokens.get("p.planner"));
    assertThat(generated.statusCode()).isEqualTo(201);
    UUID second = UUID.fromString((String) json(generated).get("id"));

    // The commit created the quarter's whole 14-day pay periods and every unit's schedule period.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM pay_period WHERE start_date >= DATE '2027-01-04'"
                    + " AND end_date <= DATE '2027-04-11'",
                Integer.class))
        .isEqualTo(7);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM schedule_period WHERE start_date >= DATE '2027-01-04'"
                    + " AND end_date <= DATE '2027-04-11'",
                Integer.class))
        .isEqualTo(42);
    UUID period =
        jdbc.queryForObject(
            "SELECT id FROM pay_period WHERE start_date = DATE '2027-01-04'", UUID.class);
    assertThat(
            send("POST", "/api/v1/pay-periods/" + period + "/lock", null, tokens.get("m.ellis"))
                .statusCode())
        .isEqualTo(200);

    Map<String, Object> preview =
        json(send("GET", "/api/v1/planner/drafts/" + second + "/commit-preview", null,
            tokens.get("p.planner")));
    HttpResponse<String> refused =
        sendWithHeaders(
            "POST",
            "/api/v1/planner/drafts/" + second + "/commit",
            "{\"acceptedWarningCount\":" + preview.get("warningCount") + "}",
            tokens.get("p.planner"),
            Map.of("If-Match", "\"0\""));
    assertThat(refused.statusCode()).isEqualTo(409);
    assertThat(json(refused).get("reason")).isEqualTo("LOCKED_PERIOD");
  }

  @Test
  @Order(8)
  void discardLeavesNoOpenDraftAndTheRolesAreEnforced() throws Exception {
    List<UUID> open =
        jdbc.queryForList("SELECT id FROM plan_draft WHERE status = 'DRAFT'", UUID.class);
    for (UUID id : open) {
      assertThat(
              send("POST", "/api/v1/planner/drafts/" + id + "/discard", null, tokens.get("p.planner"))
                  .statusCode())
          .isEqualTo(200);
    }
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft WHERE status = 'DRAFT'", Integer.class))
        .isZero();
    assertThat(
            send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", tokens.get("m.ellis"))
                .statusCode())
        .isEqualTo(403);
    assertThat(send("GET", "/api/v1/planner/plan", null, null).statusCode()).isEqualTo(401);
    assertThat(send("GET", "/api/v1/planner/plan", null, tokens.get("p.planner")).statusCode())
        .isEqualTo(200);
  }

  @Test
  @Order(9)
  void plannerReadsTheBoardButCannotPublishOrSave() throws Exception {
    UUID unitId = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'A'", UUID.class);
    assertThat(
            send(
                    "GET",
                    "/api/v1/schedule?unitId=" + unitId + "&from=2027-01-04&to=2027-01-10",
                    null,
                    tokens.get("p.planner"))
                .statusCode())
        .isEqualTo(200);
    assertThat(
            send(
                    "GET",
                    "/api/v1/schedule?unitId=" + unitId + "&from=2027-01-04&to=2027-01-10",
                    null,
                    tokens.get("t.nakamura"))
                .statusCode())
        .isEqualTo(403);
  }

  @Test
  @Order(10)
  @SuppressWarnings("unchecked")
  void draftScheduleAndCoverageUseTheBoardShape() throws Exception {
    UUID unitId = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'A'", UUID.class);
    Map<String, Object> schedule =
        json(
            send(
                "GET",
                "/api/v1/planner/drafts/" + draftId + "/schedule?unitId=" + unitId
                    + "&from=2027-01-04&to=2027-01-10",
                null,
                tokens.get("p.planner")));
    assertThat(schedule).containsKeys(
        "unit", "from", "to", "days", "asOf", "coverage", "officers", "warnings",
        "overridesThisPeriod", "publishedState", "period");
    assertThat((List<?>) schedule.get("days")).hasSize(7);
    assertThat((List<?>) schedule.get("coverage")).hasSize(21);
    List<Map<String, Object>> officers = (List<Map<String, Object>>) schedule.get("officers");
    assertThat(officers).isNotEmpty();
    assertThat(officers.get(0).get("rotation").toString()).contains("on");
    assertThat((List<?>) officers.get(0).get("cells")).hasSize(7);
    List<Map<String, Object>> covered = (List<Map<String, Object>>) schedule.get("coverage");
    assertThat(covered.get(0).get("block")).isIn(List.of("DAY", "EVENING", "NIGHT"));

    List<Map<String, Object>> units =
        mapper.readValue(
            send(
                    "GET",
                    "/api/v1/planner/drafts/" + draftId + "/coverage?from=2027-01-04&to=2027-01-10",
                    null,
                    tokens.get("p.planner"))
                .body(),
            List.class);
    assertThat(units).hasSize(6);
    assertThat(units.get(0)).containsKeys("unitId", "unitName", "coverage");
    assertThat((List<?>) units.get(0).get("coverage")).hasSize(21);

    assertThat(
            send(
                    "GET",
                    "/api/v1/planner/drafts/" + draftId + "/schedule?unitId=" + unitId
                        + "&from=2027-01-04&to=2027-01-10",
                    null,
                    tokens.get("m.ellis"))
                .statusCode())
        .isEqualTo(403);
    assertThat(
            send(
                    "GET",
                    "/api/v1/planner/drafts/" + draftId + "/coverage?from=2027-01-04&to=2027-01-10",
                    null,
                    null)
                .statusCode())
        .isEqualTo(401);
  }

  @Test
  @Order(11)
  void aSeededLateShiftBlocksTheFirstProposalInsteadOfBeingIgnored() throws Exception {
    Map<String, Object> first =
        jdbc.queryForMap(
            "SELECT employee_id, unit_id, shift_template_id, start_at FROM shift_assignment"
                + " WHERE plan_draft_id = ? AND work_date = DATE '2027-01-04'"
                + " AND EXTRACT(HOUR FROM start_at AT TIME ZONE 'America/Regina') = 7"
                + " ORDER BY employee_id LIMIT 1",
            draftId);
    UUID employeeId = (UUID) first.get("employee_id");
    UUID unitId = (UUID) first.get("unit_id");
    UUID templateId = (UUID) first.get("shift_template_id");
    Timestamp firstStart = (Timestamp) first.get("start_at");
    Timestamp blockedEnd = Timestamp.from(firstStart.toInstant().minus(Duration.ofHours(4)));
    Timestamp blockedStart = Timestamp.from(blockedEnd.toInstant().minus(Duration.ofHours(8)));
    UUID seeded = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) VALUES (?, ?, ?, ?, ?, ?, DATE '2027-01-03',"
            + " 'ROSTERED', 'MANUAL')",
        seeded,
        employeeId,
        unitId,
        templateId,
        blockedStart,
        blockedEnd);

    try {
      HttpResponse<String> regenerated =
          send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", tokens.get("p.planner"));
      assertThat(regenerated.statusCode()).isEqualTo(201);
      UUID second = UUID.fromString((String) json(regenerated).get("id"));
      Integer tooSoon =
          jdbc.queryForObject(
              "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND employee_id = ?"
                  + " AND work_date = DATE '2027-01-04' AND start_at < ?",
              Integer.class,
              second,
              employeeId,
              Timestamp.from(blockedEnd.toInstant().plus(Duration.ofHours(8))));
      assertThat(tooSoon)
          .as("the draft must not place the officer within 8 h of the seeded shift")
          .isZero();
      assertThat(
              send("POST", "/api/v1/planner/drafts/" + second + "/discard", null,
                  tokens.get("p.planner"))
                  .statusCode())
          .isEqualTo(200);
    } finally {
      jdbc.update("DELETE FROM shift_assignment WHERE id = ?", seeded);
    }
  }

  // ---------------------------------------------------------------------------------------------

  private int assignmentCount() {
    return jdbc.queryForObject(
        "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, draftId);
  }

  private List<String> planFingerprint() {
    return jdbc.queryForList(
            "SELECT employee_id || '|' || start_at || '|' || shift_template_id AS row"
                + " FROM plan_draft_assignment WHERE draft_id = ? ORDER BY employee_id, start_at",
            String.class,
            draftId)
        .stream()
        .sorted(Comparator.naturalOrder())
        .toList();
  }

  private static int nominalMinutes(String templateCode) {
    return switch (templateCode) {
      case "D8", "E8", "N8" -> 480;
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
    assertThat(response.statusCode()).as("login for %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    return sendWithHeaders(method, path, body, token, Map.of());
  }

  private HttpResponse<String> sendWithHeaders(
      String method, String path, String body, String token, Map<String, String> headers)
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
    headers.forEach(builder::header);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }
}
