package ca.shiftcircle.api.reports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import ca.shiftcircle.infrastructure.demo.DemoDataGenerator;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
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
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * Reports (docs/07 §4.6, HANDOFF step 10) on the demo dataset: the numbers reconcile with the
 * assignments and time entries, overtime matches the payroll export's OT15 rows for the locked
 * period, the overrides report has the reason, rule codes and actor, NFR-05 timings are measured,
 * and one authorization cell per role and scope rule is checked.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ReportsApiTest {

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

  private static final LocalDate LOCKED_FROM = LocalDate.of(2026, 10, 26);
  private static final LocalDate LOCKED_TO = LocalDate.of(2026, 11, 8);

  @BeforeEach
  void demoDataAndLogins() throws Exception {
    new DemoDataGenerator(jdbc, environment).generateIfEmpty();
    jdbc.update(
        "INSERT INTO app_user (id, username, display_name, employee_id) VALUES"
            + " ('22222222-2222-2222-2222-0000000000aa', 'pay.employee', 'Pay Employee',"
            + " (SELECT id FROM employee WHERE employee_no = 'E-003'))"
            + " ON CONFLICT (username) DO UPDATE SET employee_id = EXCLUDED.employee_id");
    jdbc.update(
        "INSERT INTO app_user_role (user_id, role) VALUES"
            + " ('22222222-2222-2222-2222-0000000000aa', 'EMPLOYEE') ON CONFLICT DO NOTHING");
    for (String user :
        new String[] {"m.ellis", "j.chen", "a.reviewer", "l.fraser", "tv.display", "pay.employee"}) {
      tokens.put(user, login(user));
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
    assertThat(response.statusCode()).as("login %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> get(String path, String token, String accept) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    if (accept != null) {
      builder.header("Accept", accept);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private Map<String, Object> json(HttpResponse<String> response) {
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return mapper.readValue(response.body(), Map.class);
  }

  private List<Map<String, Object>> jsonList(HttpResponse<String> response) {
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    List<Map<String, Object>> rows = new ArrayList<>();
    for (Object entry : mapper.readValue(response.body(), List.class)) {
      @SuppressWarnings("unchecked")
      Map<String, Object> row = (Map<String, Object>) entry;
      rows.add(row);
    }
    return rows;
  }

  private List<Map<String, Object>> rows(Map<String, Object> body, String key) {
    List<Map<String, Object>> rows = new ArrayList<>();
    for (Object entry : (List<?>) body.get(key)) {
      @SuppressWarnings("unchecked")
      Map<String, Object> row = (Map<String, Object>) entry;
      rows.add(row);
    }
    return rows;
  }

  private UUID unitId(String code) {
    return jdbc.queryForObject("SELECT id FROM unit WHERE code = ?", UUID.class, code);
  }

  // ---------------------------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------------------------

  @Test
  void coverageHoursReconcileWithTheAssignmentsHourByHour() throws Exception {
    UUID unitA = unitId("A");
    Map<String, Object> body =
        json(
            get(
                "/api/v1/reports/coverage?from=" + LOCKED_FROM + "&to=" + LOCKED_TO
                    + "&unitId=" + unitA + "&groupBy=day",
                tokens.get("m.ellis"),
                null));

    List<Map<String, Object>> days = rows(body, "weeks");
    assertThat(days).hasSize(14);

    Map<String, Integer> requirements =
        jdbc.query(
                "SELECT block, min_staff FROM unit_requirement WHERE unit_id = ?"
                    + " AND effective_to IS NULL",
                (rs, index) -> Map.entry(rs.getString("block"), rs.getInt("min_staff")),
                unitA)
            .stream()
            .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    double requiredPerDay = requirements.values().stream().mapToInt(Integer::intValue).sum() * 8.0;

    double requiredTotal = 0;
    double scheduledTotal = 0;
    double actualTotal = 0;
    for (int index = 0; index < days.size(); index++) {
      LocalDate date = LOCKED_FROM.plusDays(index);
      Map<String, Object> day = days.get(index);
      double scheduled = number(day.get("scheduledHours"));
      double actual = day.get("actualHours") == null ? 0 : number(day.get("actualHours"));

      java.sql.Timestamp dayStart =
          java.sql.Timestamp.from(
              date.atStartOfDay(java.time.ZoneId.of("America/Regina")).toInstant());
      java.sql.Timestamp dayEnd =
          java.sql.Timestamp.from(
              date.plusDays(1).atStartOfDay(java.time.ZoneId.of("America/Regina")).toInstant());
      // Coverage is hourly (ADR-013): a shift that covers any part of an hour counts once for
      // that hour slot, so the expected value is a slot count, not fractional hours.
      double expectedScheduled =
          queryHours(
              "SELECT count(*) FROM generate_series(?::timestamptz, ?::timestamptz"
                  + " - interval '1 hour', interval '1 hour') AS h(hour_start)"
                  + " JOIN shift_assignment s ON s.status <> 'CANCELLED'"
                  + " AND s.start_at < h.hour_start + interval '1 hour'"
                  + " AND s.end_at > h.hour_start WHERE s.unit_id = ?",
              dayStart,
              dayEnd,
              unitA);
      double expectedActual =
          queryHours(
              "SELECT count(*) FROM generate_series(?::timestamptz, ?::timestamptz"
                  + " - interval '1 hour', interval '1 hour') AS h(hour_start)"
                  + " JOIN time_entry te ON te.absence_type IS NULL"
                  + " AND te.start_at < h.hour_start + interval '1 hour'"
                  + " AND te.end_at > h.hour_start"
                  + " JOIN shift_assignment a ON a.id = te.shift_assignment_id"
                  + " WHERE a.unit_id = ?",
              dayStart,
              dayEnd,
              unitA);

      assertThat(number(day.get("requiredHours")))
          .as("required hours for %s", date)
          .isCloseTo(requiredPerDay, within(0.02));
      assertThat(scheduled).as("scheduled hours for %s", date).isCloseTo(expectedScheduled, within(0.02));
      assertThat(actual).as("actual hours for %s", date).isCloseTo(expectedActual, within(0.02));

      double expectedExtra =
          queryHours(
              "SELECT count(*) FROM generate_series(?::timestamptz, ?::timestamptz"
                  + " - interval '1 hour', interval '1 hour') AS h(hour_start)"
                  + " JOIN shift_assignment s ON s.status <> 'CANCELLED'"
                  + " AND (s.kind = 'EXTRA' OR s.source = 'OVERTIME_OFFER')"
                  + " AND s.start_at < h.hour_start + interval '1 hour'"
                  + " AND s.end_at > h.hour_start WHERE s.unit_id = ?",
              dayStart,
              dayEnd,
              unitA);
      double extra = number(day.get("extraHours"));
      assertThat(extra).as("extra hours for %s", date).isCloseTo(expectedExtra, within(0.02));
      @SuppressWarnings("unchecked")
      Map<String, Object> extraByBlock = (Map<String, Object>) day.get("extraHoursByBlock");
      assertThat(extraByBlock).containsKeys("DAY", "EVENING", "NIGHT");
      assertThat(
              extraByBlock.values().stream()
                  .mapToDouble(ReportsApiTest::number)
                  .sum())
          .as("block split for %s", date)
          .isCloseTo(extra, within(0.02));

      requiredTotal += number(day.get("requiredHours"));
      scheduledTotal += scheduled;
      actualTotal += actual;
    }

    assertThat(number(body.get("requiredHours"))).isCloseTo(requiredTotal, within(0.02));
    assertThat(number(body.get("scheduledHours"))).isCloseTo(scheduledTotal, within(0.02));
    assertThat(number(body.get("actualHours"))).isCloseTo(actualTotal, within(0.02));
  }

  @Test
  void hoursAndOvertimeReconcileWithTheTimeEntriesAndThePayrollExport() throws Exception {
    Map<String, Object> hours =
        json(
            get(
                "/api/v1/reports/hours?from=" + LOCKED_FROM + "&to=" + LOCKED_TO,
                tokens.get("a.reviewer"),
                null));
    assertThat(((Map<String, Object>) hours.get("period")).get("status")).isEqualTo("LOCKED");
    List<Map<String, Object>> rows = rows(hours, "rows");
    assertThat(rows).isNotEmpty();

    double overtimeTotal = 0;
    for (Map<String, Object> row : rows) {
      UUID employeeId = UUID.fromString((String) row.get("employeeId"));
      double scheduled =
          queryHours(
              "SELECT sum(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 3600)"
                  + " FROM shift_assignment s WHERE s.employee_id = ? AND s.status <> 'CANCELLED'"
                  + " AND s.work_date BETWEEN ? AND ?",
              employeeId,
              LOCKED_FROM,
              LOCKED_TO);
      Map<String, Object> entryTotals =
          jdbc.queryForMap(
              "SELECT coalesce(sum(hours) FILTER (WHERE absence_type IS NULL), 0) AS worked,"
                  + " coalesce(sum(hours) FILTER (WHERE absence_type = 'SICK'), 0) AS sick,"
                  + " coalesce(sum(hours) FILTER (WHERE absence_type = 'VACATION'), 0) AS vacation"
                  + " FROM time_entry WHERE employee_id = ? AND work_date BETWEEN ? AND ?",
              employeeId,
              LOCKED_FROM,
              LOCKED_TO);

      assertThat(number(row.get("scheduled")))
          .as("scheduled for %s", row.get("name"))
          .isCloseTo(scheduled, within(0.02));
      assertThat(number(row.get("worked")))
          .as("worked for %s", row.get("name"))
          .isCloseTo(number(entryTotals.get("worked")), within(0.02));
      assertThat(number(row.get("sick")))
          .as("sick for %s", row.get("name"))
          .isCloseTo(number(entryTotals.get("sick")), within(0.02));
      assertThat(number(row.get("vacation")))
          .as("vacation for %s", row.get("name"))
          .isCloseTo(number(entryTotals.get("vacation")), within(0.02));
      assertThat(number(row.get("regular")) + number(row.get("overtime15")))
          .as("regular + overtime for %s", row.get("name"))
          .isCloseTo(number(row.get("worked")), within(0.02));
      overtimeTotal += number(row.get("overtime15"));
    }

    // The payroll export is the same period's OT15 rows, one line per portion.
    HttpResponse<String> payroll =
        get(
            "/api/v1/pay-periods/"
                + jdbc.queryForObject(
                    "SELECT id::text FROM pay_period WHERE start_date = ?", String.class, LOCKED_FROM)
                + "/payroll-export",
            tokens.get("m.ellis"),
            null);
    assertThat(payroll.statusCode()).isEqualTo(200);
    double csvOvertime = 0;
    for (String line : payroll.body().lines().skip(1).toList()) {
      String[] cells = line.split(",", -1);
      if ("OT15".equals(cells[4])) {
        csvOvertime += Double.parseDouble(cells[5]);
      }
    }
    assertThat(overtimeTotal)
        .as("hours report OT15 vs payroll export OT15")
        .isCloseTo(csvOvertime, within(0.05));

    // The overtime report for the same range is the same figure, per officer.
    Map<String, Object> overtime =
        json(
            get(
                "/api/v1/reports/overtime?from=" + LOCKED_FROM + "&to=" + LOCKED_TO + "&top=100",
                tokens.get("a.reviewer"),
                null));
    Map<UUID, Double> hoursByOfficer = new LinkedHashMap<>();
    rows.forEach(
        row ->
            hoursByOfficer.put(
                UUID.fromString((String) row.get("employeeId")), number(row.get("overtime15"))));
    double reportTotal = 0;
    for (Map<String, Object> row : rows(overtime, "rows")) {
      UUID employeeId = UUID.fromString((String) row.get("employeeId"));
      reportTotal += number(row.get("hours"));
      assertThat(number(row.get("hours")))
          .as("overtime report for %s", row.get("name"))
          .isCloseTo(hoursByOfficer.getOrDefault(employeeId, 0.0), within(0.02));
    }
    assertThat(reportTotal).as("overtime report total").isCloseTo(csvOvertime, within(0.05));
  }

  @Test
  void overridesReconcileWithTheOverrideRowsAndCarryReasonActorAndRuleCodes() throws Exception {
    UUID overrideId = UUID.fromString("99999999-9999-9999-9999-0000000000aa");
    jdbc.update("DELETE FROM override WHERE id = ?", overrideId);
    jdbc.update(
        "INSERT INTO override (id, reason, rule_codes, rule_set_version_id, created_by,"
            + " created_at) VALUES (?, 'Reports test override', ARRAY['U-05'],"
            + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'),"
            + " (SELECT id FROM app_user WHERE username = 'm.ellis'),"
            + " TIMESTAMPTZ '2026-11-20 12:00:00-06')",
        overrideId);
    jdbc.update(
        "UPDATE shift_assignment SET override_id = ? WHERE id ="
            + " (SELECT id FROM shift_assignment WHERE unit_id = ? AND status <> 'CANCELLED' LIMIT 1)",
        overrideId,
        unitId("A"));

    List<Map<String, Object>> report =
        jsonList(
            get(
                "/api/v1/reports/overrides?from=2026-10-01&to=2026-11-22",
                tokens.get("a.reviewer"),
                null));
    int databaseCount =
        jdbc.queryForObject(
            "SELECT count(*) FROM override WHERE created_at >="
                + " TIMESTAMPTZ '2026-10-01 00:00:00-06' AND created_at <"
                + " TIMESTAMPTZ '2026-11-23 00:00:00-06'",
            Integer.class);
    assertThat(report).hasSize(databaseCount);

    Map<String, Object> created =
        report.stream()
            .filter(row -> overrideId.toString().equals(row.get("id")))
            .findFirst()
            .orElseThrow(() -> new AssertionError("the created override is not in the report"));
    assertThat(created.get("reason")).isEqualTo("Reports test override");
    assertThat(created.get("ruleCode")).isEqualTo("U-05");
    assertThat(created.get("actor")).isEqualTo("M. Ellis");
    assertThat(created.get("employeeName")).isNotNull();
    assertThat(created.get("unitName")).isNotNull();

    // PC-03: the auditor sees the full row, not just a degraded one.
    assertThat(report)
        .anySatisfy(
            row -> {
              assertThat(row.get("reason")).isEqualTo("Lockdown, relief unavailable");
              assertThat(row.get("ruleCode")).isEqualTo("U-05");
              assertThat(row.get("actor")).isEqualTo("M. Ellis");
              assertThat(row.get("employeeName")).isNotNull();
              assertThat(row.get("unitName")).isEqualTo("Unit C · Living unit");
            });
    // The default range (as of the demo day) includes it, so the Overrides tab is not empty.
    List<Map<String, Object>> defaults =
        jsonList(
            get(
                "/api/v1/reports/overrides",
                tokens.get("a.reviewer"),
                null));
    assertThat(defaults)
        .anySatisfy(row -> assertThat(row.get("reason")).isEqualTo("Lockdown, relief unavailable"));
  }

  @Test
  void nfr05ReportTimingsAreMeasuredOnNinetyDays() throws Exception {
    String range = "from=2026-10-01&to=2026-12-29";
    String[] paths = {
      "/api/v1/reports/coverage?" + range,
      "/api/v1/reports/hours?" + range,
      "/api/v1/reports/overtime?" + range + "&top=100",
      "/api/v1/reports/overrides?from=2026-09-01&to=2026-11-19"
    };
    String[] names = {"coverage", "hours", "overtime", "overrides"};
    Map<String, Double> medians = new LinkedHashMap<>();
    StringBuilder measured = new StringBuilder("NFR-05 medians: ");
    for (int index = 0; index < paths.length; index++) {
      // Warm up (schema/JIT), then take the median of three.
      assertThat(get(paths[index], tokens.get("a.reviewer"), null).statusCode()).isEqualTo(200);
      List<Double> times = new ArrayList<>();
      for (int run = 0; run < 3; run++) {
        long started = System.nanoTime();
        HttpResponse<String> response = get(paths[index], tokens.get("a.reviewer"), null);
        times.add((System.nanoTime() - started) / 1_000_000.0);
        assertThat(response.statusCode()).isEqualTo(200);
      }
      times.sort(Double::compareTo);
      double median = times.get(1);
      medians.put(names[index], median);
      measured.append(names[index]).append('=').append(Math.round(median)).append("ms ");
    }
    System.out.println(measured);
    medians.forEach(
        (name, median) ->
            assertThat(median).as("NFR-05 %s median", name).isLessThan(2000.0));
  }

  @Test
  void m1ReversedAndOversizeRangesAreRejectedOnEveryReport() throws Exception {
    String[] paths = {
      "/api/v1/reports/coverage?from=2026-11-10&to=2026-11-01",
      "/api/v1/reports/hours?from=2026-11-10&to=2026-11-01",
      "/api/v1/reports/overtime?from=2026-11-10&to=2026-11-01",
      "/api/v1/reports/overrides?from=2026-11-10&to=2026-11-01",
      "/api/v1/reports/coverage?from=2025-01-01&to=2026-12-31",
      "/api/v1/reports/hours?from=2025-01-01&to=2026-12-31",
      "/api/v1/reports/overtime?from=2025-01-01&to=2026-12-31",
      "/api/v1/reports/overrides?from=2025-01-01&to=2026-12-31",
      // An expanded ISO year overflowed LocalDate in the range arithmetic and answered 500.
      "/api/v1/reports/coverage?from=%2B999999999-12-31&to=%2B999999999-12-31",
      "/api/v1/reports/hours?from=%2B999999999-12-31&to=%2B999999999-12-31",
      "/api/v1/reports/overtime?from=%2B999999999-12-31&to=%2B999999999-12-31",
      "/api/v1/reports/overrides?from=%2B999999999-12-31&to=%2B999999999-12-31",
      "/api/v1/reports/overrides?from=%2B999999999-12-01&to=%2B999999999-12-31",
      "/api/v1/reports/overrides?from=-999999999-01-01&to=-999999999-01-02"
    };
    for (String path : paths) {
      assertThat(get(path, tokens.get("a.reviewer"), null).statusCode())
          .as(path)
          .isEqualTo(400);
      assertThat(get(path, tokens.get("a.reviewer"), "text/csv").statusCode())
          .as(path + " as CSV")
          .isEqualTo(400);
    }
  }

  @Test
  void m3AnUnknownGroupByIsABadRequest() throws Exception {
    HttpResponse<String> response =
        get(
            "/api/v1/reports/coverage?from=2026-10-26&to=2026-11-08&groupBy=hour",
            tokens.get("a.reviewer"),
            null);
    assertThat(response.statusCode()).isEqualTo(400);
  }

  @Test
  void m4DisplayIsDeniedEveryReport() throws Exception {
    String range = "?from=2026-10-26&to=2026-11-08";
    for (String report : new String[] {"coverage", "hours", "overtime", "overrides"}) {
      assertThat(get("/api/v1/reports/" + report + range, tokens.get("tv.display"), null).statusCode())
          .as(report)
          .isEqualTo(403);
    }
  }

  @Test
  void csvExportsUseTheDocumentedHeaders() throws Exception {
    Map<String, String> headers =
        Map.of(
            "/api/v1/reports/coverage?from=2026-10-26&to=2026-11-08",
            "week,required_hours,scheduled_hours,actual_hours,scheduled_percent,actual_percent,planned,extra_hours,extra_day,extra_evening,extra_night",
            "/api/v1/reports/hours?from=2026-10-26&to=2026-11-08",
            "employee_no,name,scheduled,worked,regular,overtime_15,overtime_20,sick,vacation",
            "/api/v1/reports/overtime?from=2026-10-26&to=2026-11-08",
            "employee_no,name,overtime_hours",
            "/api/v1/reports/overrides?from=2026-10-01&to=2026-11-19",
            "at,employee,unit,rule_codes,actor,reason");
    headers.forEach(
        (path, header) -> {
          try {
            HttpResponse<String> response = get(path, tokens.get("a.reviewer"), "text/csv");
            assertThat(response.statusCode()).as(path).isEqualTo(200);
            assertThat(response.headers().firstValue("Content-Type").orElse("")).contains("text/csv");
            assertThat(response.body().lines().findFirst().orElse("")).as(path).isEqualTo(header);
          } catch (Exception error) {
            throw new AssertionError(path, error);
          }
        });
  }

  // ---------------------------------------------------------------------------------------------
  // Authorization and scope
  // ---------------------------------------------------------------------------------------------

  @Test
  void authorizationAndScopeCells() throws Exception {
    String coverage = "/api/v1/reports/coverage?from=2026-10-26&to=2026-11-08";
    String hours = "/api/v1/reports/hours?from=2026-10-26&to=2026-11-08";

    assertThat(get(coverage, null, null).statusCode()).as("anonymous").isEqualTo(401);
    assertThat(get(coverage, tokens.get("pay.employee"), null).statusCode()).as("employee").isEqualTo(403);
    assertThat(get(coverage, tokens.get("l.fraser"), null).statusCode()).as("rules admin").isEqualTo(403);
    assertThat(get(coverage, tokens.get("tv.display"), null).statusCode()).as("display").isEqualTo(403);
    assertThat(get(coverage, tokens.get("a.reviewer"), null).statusCode()).as("auditor").isEqualTo(200);

    // A supervisor's unit filter is scoped; an out-of-scope unit answers 404.
    assertThat(
            get(coverage + "&unitId=" + unitId("A"), tokens.get("m.ellis"), null).statusCode())
        .as("m.ellis on Unit A").isEqualTo(200);
    assertThat(
            get(coverage + "&unitId=" + unitId("C"), tokens.get("m.ellis"), null).statusCode())
        .as("m.ellis on Unit C").isEqualTo(404);
    assertThat(
            get(coverage + "&unitId=" + unitId("ADM"), tokens.get("j.chen"), null).statusCode())
        .as("j.chen on Admissions").isEqualTo(200);
    assertThat(
            get(coverage + "&unitId=" + unitId("A"), tokens.get("j.chen"), null).statusCode())
        .as("j.chen on Unit A").isEqualTo(404);
    assertThat(
            get(coverage + "&unitId=" + unitId("C"), tokens.get("a.reviewer"), null).statusCode())
        .as("auditor on Unit C").isEqualTo(200);

    // Employees see their own hours report and nothing else.
    Map<String, Object> own = json(get(hours, tokens.get("pay.employee"), null));
    List<Map<String, Object>> ownRows = rows(own, "rows");
    assertThat(ownRows).hasSize(1);
    assertThat(ownRows.get(0).get("employeeId"))
        .isEqualTo(
            jdbc.queryForObject(
                    "SELECT employee_id::text FROM app_user WHERE username = 'pay.employee'",
                    String.class));
    String otherEmployee =
        jdbc.queryForObject("SELECT id::text FROM employee WHERE employee_no = 'E-004'", String.class);
    assertThat(
            get(hours + "&employeeId=" + otherEmployee, tokens.get("pay.employee"), null).statusCode())
        .as("another officer's hours answer 404")
        .isEqualTo(404);
    assertThat(get(hours, tokens.get("l.fraser"), null).statusCode()).as("rules admin hours").isEqualTo(403);

    // A supervisor may filter to an officer inside their units, not one outside them.
    String outOfScope =
        jdbc.queryForObject(
            "SELECT e.id::text FROM employee e WHERE e.home_unit_id = ?"
                + " AND NOT EXISTS (SELECT 1 FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
                + "   WHERE s.employee_id = e.id AND u.code IN ('A', 'B')) LIMIT 1",
            String.class,
            unitId("CTL"));
    assertThat(get(hours + "&employeeId=" + outOfScope, tokens.get("m.ellis"), null).statusCode())
        .as("supervisor employee filter outside their units answers 404")
        .isEqualTo(404);
  }

  @Test
  void theAuditorsUnitFilterNarrowsTheHoursAndOverridesReports() throws Exception {
    // S1: the Reports screen's unit picker. The auditor reads the facility by default, but a
    // chosen unit has to narrow every report, not only coverage and overtime.
    String range = "?from=2026-10-01&to=2026-11-19";
    String token = tokens.get("a.reviewer");

    List<Map<String, Object>> overrides = jsonList(get("/api/v1/reports/overrides" + range, token, null));
    assertThat(overrides)
        .anySatisfy(row -> assertThat(row.get("reason")).isEqualTo("Lockdown, relief unavailable"));
    List<Map<String, Object>> unitC =
        jsonList(get("/api/v1/reports/overrides" + range + "&unitId=" + unitId("C"), token, null));
    assertThat(unitC)
        .isNotEmpty()
        .allSatisfy(row -> assertThat(row.get("unitName")).isEqualTo("Unit C · Living unit"));
    List<Map<String, Object>> unitA =
        jsonList(get("/api/v1/reports/overrides" + range + "&unitId=" + unitId("A"), token, null));
    assertThat(unitA)
        .noneSatisfy(row -> assertThat(row.get("reason")).isEqualTo("Lockdown, relief unavailable"));

    Map<String, Object> facility = json(get("/api/v1/reports/hours" + range, token, null));
    Map<String, Object> unitAHours =
        json(get("/api/v1/reports/hours" + range + "&unitId=" + unitId("A"), token, null));
    assertThat(rows(unitAHours, "rows").size())
        .as("Unit A hours are narrower than the facility")
        .isLessThan(rows(facility, "rows").size())
        .isPositive();
  }

  private double queryHours(String sql, Object... args) {
    Map<String, Object> row = jdbc.queryForMap(sql, args);
    Object value = row.values().stream().filter(java.util.Objects::nonNull).findFirst().orElse(0);
    return value == null ? 0 : ((Number) value).doubleValue();
  }

  private static double number(Object value) {
    return value == null ? 0 : ((Number) value).doubleValue();
  }
}
