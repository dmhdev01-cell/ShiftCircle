package ca.shiftcircle.api.reports;

import ca.shiftcircle.api.csv.Csv;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import ca.shiftcircle.rules.pay.PayClassifier;
import ca.shiftcircle.rules.pay.PayPolicy;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The reports (docs/07 §4.6, HANDOFF step 10).
 *
 * <p>Coverage is hourly (ADR-013 revised): for every hour in the range it counts the rostered shifts
 * that cover the hour and the actual entries that worked it, and compares both with the unit
 * requirement for that hour's block. Hours and overtime come from the same time entries and
 * assignments the payroll export uses, and the overtime classification is the same
 * {@link PayClassifier} call, so the numbers reconcile (the tests compare them).
 *
 * <p>Scope is docs/09 §2: a supervisor sees their units, an auditor the whole facility, an employee
 * only their own hours report. Unit filters outside a supervisor's scope answer 404.
 */
@Service
public class ReportsService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final DateTimeFormatter DAY_MONTH =
      DateTimeFormatter.ofPattern("d MMM", Locale.CANADA);
  private static final DateTimeFormatter DAY_MONTH_YEAR =
      DateTimeFormatter.ofPattern("d MMM yyyy", Locale.CANADA);
  private static final DateTimeFormatter STAMP =
      DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.CANADA);
  private static final int MAX_DAYS = 366;

  private final JdbcTemplate jdbc;
  private final ScopeGuard scopeGuard;
  private final PayClassifier classifier = new PayClassifier();
  private final PayPolicy policy = classifier.policyFrom(RuleRowsV1.ruleSet());
  private final LocalDate asOf;
  private final Instant asOfInstant;

  public ReportsService(
      JdbcTemplate jdbc, ScopeGuard scopeGuard, @Value("${sc.demo.today:2026-11-19}") String today) {
    this.jdbc = jdbc;
    this.scopeGuard = scopeGuard;
    this.asOf = LocalDate.parse(today);
    this.asOfInstant = asOf.atTime(LocalTime.NOON).atZone(REGINA).toInstant();
  }

  // ---------------------------------------------------------------------------------------------
  // Coverage
  // ---------------------------------------------------------------------------------------------

  public ReportsViews.CoverageReport coverage(
      AuthPrincipal principal, LocalDate fromInput, LocalDate toInput, String groupBy, String unitId) {
    LocalDate monday = asOf.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    LocalDate from = fromInput != null ? fromInput : monday.minusWeeks(5);
    LocalDate to = toInput != null ? toInput : monday.plusWeeks(1).plusDays(6);
    validate(from, to);
    if (groupBy != null
        && !groupBy.isBlank()
        && !"day".equalsIgnoreCase(groupBy)
        && !"week".equalsIgnoreCase(groupBy)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "groupBy must be day or week");
    }
    boolean byWeek = groupBy == null || groupBy.isBlank() || "week".equalsIgnoreCase(groupBy);

    Scope scope = scope(principal, unitId);
    if (scope.unitIds().isEmpty()) {
      return emptyCoverage(from, to);
    }

    Instant start = from.atStartOfDay(REGINA).toInstant();
    Instant end = to.plusDays(1).atStartOfDay(REGINA).toInstant();

    long slotCount = java.time.Duration.between(start, end).toHours();
    int[] scheduled = new int[(int) slotCount];
    int[] actual = new int[(int) slotCount];
    int[] extra = new int[(int) slotCount];

    // Count the intervals in Java rather than joining every hour slot to every shift in SQL: the
    // 90-day report then reads the shifts once (NFR-05).
    List<Map<String, Object>> assignments =
        jdbc.queryForList(
            "SELECT start_at, end_at, kind, source FROM shift_assignment s"
                + " WHERE s.status <> 'CANCELLED'"
                + " AND s.unit_id IN (" + placeholders(scope.unitIds().size()) + ")"
                + " AND s.start_at < ? AND s.end_at > ?",
            args(
                scope.unitIds(),
                List.of(Timestamp.from(end), Timestamp.from(start))));
    for (Map<String, Object> assignment : assignments) {
      Instant assignmentStart = ((Timestamp) assignment.get("start_at")).toInstant();
      Instant assignmentEnd = ((Timestamp) assignment.get("end_at")).toInstant();
      mark(scheduled, start, slotCount, assignmentStart, assignmentEnd);
      boolean overtime =
          "EXTRA".equals(String.valueOf(assignment.get("kind")))
              || "OVERTIME_OFFER".equals(String.valueOf(assignment.get("source")));
      if (overtime) {
        mark(extra, start, slotCount, assignmentStart, assignmentEnd);
      }
    }

    List<Map<String, Object>> entries =
        jdbc.queryForList(
            "SELECT te.start_at, te.end_at FROM time_entry te"
                + " JOIN shift_assignment a ON a.id = te.shift_assignment_id"
                + " WHERE te.absence_type IS NULL AND a.unit_id IN ("
                + placeholders(scope.unitIds().size()) + ")"
                + " AND te.start_at < ? AND te.end_at > ?",
            args(
                scope.unitIds(),
                List.of(Timestamp.from(end), Timestamp.from(start))));
    for (Map<String, Object> entry : entries) {
      mark(actual, start, slotCount,
          ((Timestamp) entry.get("start_at")).toInstant(),
          ((Timestamp) entry.get("end_at")).toInstant());
    }

    Map<LocalDate, double[]> totals = new LinkedHashMap<>();
    Map<LocalDate, Map<String, double[]>> extraByBlock = new LinkedHashMap<>();
    Map<LocalDate, LocalDate> ends = new LinkedHashMap<>();
    Instant slotStart = start;
    for (int slot = 0; slot < slotCount; slot++, slotStart = slotStart.plusSeconds(3600)) {
      java.time.ZonedDateTime local = slotStart.atZone(REGINA);
      LocalDate date = local.toLocalDate();
      LocalDate bucket = byWeek ? date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)) : date;
      LocalDate bucketEnd = byWeek ? bucket.plusDays(6) : date;

      int required = 0;
      int block = blockOf(local.getHour());
      for (Map<String, Integer> blocks : scope.requirements().values()) {
        required += blocks.getOrDefault(blockName(block), 0);
      }

      double[] bucketTotals = totals.computeIfAbsent(bucket, key -> new double[5]);
      bucketTotals[0] += required;
      if (slotStart.isBefore(asOfInstant)) {
        bucketTotals[1] += required;
      }
      bucketTotals[2] += scheduled[slot];
      bucketTotals[3] += actual[slot];
      bucketTotals[4] += extra[slot];
      extraByBlock
          .computeIfAbsent(bucket, key -> new LinkedHashMap<>())
          .computeIfAbsent(blockName(block), key -> new double[1])[0] += extra[slot];
      ends.put(bucket, bucketEnd);
    }

    List<ReportsViews.CoverageWeek> weeks = new ArrayList<>();
    double requiredTotal = 0;
    double scheduledTotal = 0;
    double actualTotal = 0;
    double extraTotal = 0;
    List<Map.Entry<LocalDate, double[]>> ordered = new ArrayList<>(totals.entrySet());
    ordered.sort(Map.Entry.comparingByKey());
    for (Map.Entry<LocalDate, double[]> entry : ordered) {
      double[] values = entry.getValue();
      boolean planned = entry.getKey().isAfter(asOf);
      double scheduledPercent = values[0] > 0 ? values[2] / values[0] * 100.0 : 100.0;
      double extraPercent = values[0] > 0 ? values[4] / values[0] * 100.0 : 0.0;
      Double actualPercent =
          planned || values[1] <= 0 ? null : values[3] / values[1] * 100.0;
      Map<String, Double> blocks = new LinkedHashMap<>();
      Map<String, double[]> perBlock = extraByBlock.get(entry.getKey());
      for (String name : List.of("DAY", "EVENING", "NIGHT")) {
        double[] value = perBlock == null ? null : perBlock.get(name);
        blocks.put(name, round2(value == null ? 0 : value[0]));
      }
      weeks.add(
          new ReportsViews.CoverageWeek(
              label(entry.getKey(), ends.get(entry.getKey()), byWeek),
              round2(scheduledPercent),
              round2(extraPercent),
              actualPercent == null ? null : round2(actualPercent),
              planned,
              round2(values[0]),
              round2(values[2]),
              planned ? null : round2(values[3]),
              round2(values[4]),
              blocks));
      requiredTotal += values[0];
      scheduledTotal += values[2];
      actualTotal += values[3];
      extraTotal += values[4];
    }

    List<Double> percentages = new ArrayList<>();
    weeks.forEach(
        week -> {
          percentages.add(week.scheduledPercent());
          percentages.add(week.scheduledPercent() - week.extraPercent());
          if (week.actualPercent() != null) {
            percentages.add(week.actualPercent());
          }
        });
    double min = percentages.stream().mapToDouble(Double::doubleValue).min().orElse(98);
    double max = percentages.stream().mapToDouble(Double::doubleValue).max().orElse(102);
    int axisFrom = Math.min(98, Math.max(0, ((int) Math.floor(min) / 2) * 2 - 2));
    int axisTo = Math.max(100, ((int) Math.ceil(max / 2)) * 2);
    if (axisTo <= axisFrom) {
      axisTo = axisFrom + 2;
    }

    Double actualHours = from.isAfter(asOf) ? null : round2(actualTotal);
    return new ReportsViews.CoverageReport(
        weeks,
        axisFrom,
        axisTo,
        round2(requiredTotal),
        round2(scheduledTotal),
        actualHours,
        round2(extraTotal));
  }

  private ReportsViews.CoverageReport emptyCoverage(LocalDate from, LocalDate to) {
    return new ReportsViews.CoverageReport(
        List.of(), 98, 102, 0, 0, from.isAfter(asOf) ? null : 0.0, 0);
  }

  /** Adds one to each hour slot the interval covers, clipped to the report window. */
  private static void mark(int[] slots, Instant rangeStart, long slotCount, Instant from, Instant to) {
    if (!to.isAfter(rangeStart) || !from.isBefore(rangeStart.plusSeconds(slotCount * 3600))) {
      return;
    }
    long first = Math.max(0, java.time.Duration.between(rangeStart, from).toSeconds() / 3600);
    long last =
        Math.min(
            slotCount - 1,
            (java.time.Duration.between(rangeStart, to).toSeconds() - 1) / 3600);
    for (long slot = first; slot <= last; slot++) {
      slots[(int) slot]++;
    }
  }

  private static int blockOf(int hour) {
    if (hour >= 7 && hour < 15) {
      return 0;
    }
    if (hour >= 15 && hour < 23) {
      return 1;
    }
    return 2;
  }

  private static String blockName(int block) {
    return block == 0 ? "DAY" : block == 1 ? "EVENING" : "NIGHT";
  }

  // ---------------------------------------------------------------------------------------------
  // Hours by officer
  // ---------------------------------------------------------------------------------------------

  public ReportsViews.HoursReport hours(
      AuthPrincipal principal,
      LocalDate fromInput,
      LocalDate toInput,
      String unitId,
      UUID employeeId) {
    PayPeriodRecord period = defaultHoursPeriod();
    LocalDate from = fromInput != null ? fromInput : period.from();
    LocalDate to = toInput != null ? toInput : period.to();
    validate(from, to);

    boolean employeeRole = principal.hasRole("EMPLOYEE") && !principal.hasRole("SUPERVISOR")
        && !principal.hasRole("AUDITOR");
    UUID employeeFilter = employeeId;
    if (employeeRole) {
      if (principal.employeeId() == null) {
        return new ReportsViews.HoursReport(hoursPeriod(period), List.of(), 0);
      }
      if (employeeFilter != null && !employeeFilter.equals(principal.employeeId())) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
      }
      employeeFilter = principal.employeeId();
    }

    Scope scope = employeeRole ? new Scope(List.of(), Map.of()) : scope(principal, unitId);
    if (!employeeRole && scope.unitIds().isEmpty()) {
      return new ReportsViews.HoursReport(hoursPeriod(period), List.of(), 0);
    }
    if (!employeeRole
        && !principal.hasRole("AUDITOR")
        && employeeFilter != null
        && !employeeInScope(employeeFilter, from, to, scope.unitIds())) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
    }

    boolean facility = employeeRole || principal.hasRole("AUDITOR");

    List<Object> hoursArgs = new ArrayList<>(List.of(from, to));
    if (!facility) {
      hoursArgs.addAll(scope.unitIds());
    }
    if (employeeFilter != null) {
      hoursArgs.add(employeeFilter);
    }
    List<Map<String, Object>> scheduledRows =
        jdbc.queryForList(
            scheduledSql(facility, scope.unitIds().size(), employeeFilter != null),
            hoursArgs.toArray());

    List<Map<String, Object>> entryRows =
        jdbc.queryForList(
            entriesSql(facility, scope.unitIds().size(), employeeFilter != null),
            hoursArgs.toArray());

    record Officer(String name, String employeeNo, double scheduled, List<Map<String, Object>> entries) {}
    Map<UUID, Officer> officers = new LinkedHashMap<>();
    for (Map<String, Object> row : scheduledRows) {
      UUID id = (UUID) row.get("employee_id");
      officers.put(
          id,
          new Officer(
              (String) row.get("name"),
              (String) row.get("employee_no"),
              ((Number) row.get("scheduled")).doubleValue(),
              new ArrayList<>()));
    }
    for (Map<String, Object> entry : entryRows) {
      UUID id = (UUID) entry.get("employee_id");
      officers
          .computeIfAbsent(
              id,
              key ->
                  new Officer(
                      (String) entry.get("name"), (String) entry.get("employee_no"), 0, new ArrayList<>()))
          .entries()
          .add(entry);
    }

    List<ReportsViews.HoursByOfficer> rows = new ArrayList<>();
    officers.forEach(
        (id, officer) -> {
          double worked = 0;
          double sick = 0;
          double vacation = 0;
          Map<UUID, List<Double>> byPeriod = new LinkedHashMap<>();
          for (Map<String, Object> entry : officer.entries()) {
            double entryHours = ((Number) entry.get("hours")).doubleValue();
            String absence = (String) entry.get("absence_type");
            if (absence == null) {
              worked += entryHours;
              byPeriod
                  .computeIfAbsent((UUID) entry.get("pay_period_id"), key -> new ArrayList<>())
                  .add(entryHours);
            } else if ("VACATION".equals(absence)) {
              vacation += entryHours;
            } else {
              sick += entryHours;
            }
          }
          double overtime = 0;
          for (List<Double> hoursInOrder : byPeriod.values()) {
            overtime +=
                classifier.allocate(hoursInOrder, policy).stream()
                    .filter(portion -> "OT15".equals(portion.payCode()))
                    .mapToDouble(PayClassifier.Portion::hours)
                    .sum();
          }
          rows.add(
              new ReportsViews.HoursByOfficer(
                  id,
                  officer.name(),
                  round2(officer.scheduled()),
                  round2(worked),
                  round2(Math.max(0, worked - overtime)),
                  round2(overtime),
                  0,
                  round2(sick),
                  round2(vacation)));
        });
    rows.sort(Comparator.comparing(ReportsViews.HoursByOfficer::name));

    PayPeriodRecord header = periodFor(from).orElse(period);
    return new ReportsViews.HoursReport(hoursPeriod(header), rows, rows.size());
  }

  private String scheduledSql(boolean facility, int unitCount, boolean employeeFilter) {
    return "SELECT s.employee_id, e.first_name || ' ' || e.last_name AS name, e.employee_no,"
        + " sum(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 3600) AS scheduled"
        + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
        + " WHERE s.status <> 'CANCELLED' AND s.work_date BETWEEN ? AND ?"
        + (facility ? "" : " AND s.unit_id IN (" + placeholders(unitCount) + ")")
        + (employeeFilter ? " AND s.employee_id = ?" : "")
        + " GROUP BY s.employee_id, e.first_name, e.last_name, e.employee_no";
  }

  private String entriesSql(boolean facility, int unitCount, boolean employeeFilter) {
    return "SELECT te.employee_id, e.first_name || ' ' || e.last_name AS name, e.employee_no,"
        + " te.pay_period_id, te.hours, te.absence_type, te.start_at"
        + " FROM time_entry te JOIN employee e ON e.id = te.employee_id"
        + " LEFT JOIN shift_assignment s ON s.id = te.shift_assignment_id"
        + " WHERE te.work_date BETWEEN ? AND ?"
        + (facility
            ? ""
            : " AND coalesce(s.unit_id, e.home_unit_id) IN (" + placeholders(unitCount) + ")")
        + (employeeFilter ? " AND te.employee_id = ?" : "")
        + " ORDER BY te.employee_id, te.pay_period_id, te.start_at";
  }

  private boolean employeeInScope(UUID employeeId, LocalDate from, LocalDate to, List<UUID> unitIds) {
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment WHERE employee_id = ?"
                + " AND work_date BETWEEN ? AND ? AND status <> 'CANCELLED'"
                + " AND unit_id IN (" + placeholders(unitIds.size()) + ")",
            Integer.class,
            args(List.of(employeeId, from, to), unitIds));
    return count != null && count > 0;
  }

  private PayPeriodRecord defaultHoursPeriod() {
    List<Map<String, Object>> locked =
        jdbc.queryForList(
            "SELECT id, start_date, end_date, status FROM pay_period"
                + " WHERE status = 'LOCKED' ORDER BY end_date DESC LIMIT 1");
    if (!locked.isEmpty()) {
      return periodRecord(locked.get(0));
    }
    return periodFor(asOf)
        .orElseGet(
            () ->
                new PayPeriodRecord(
                    UUID.nameUUIDFromBytes(("report:" + asOf).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    asOf.minusDays(13),
                    asOf,
                    "OPEN"));
  }

  private record PayPeriodRecord(UUID id, LocalDate from, LocalDate to, String status) {}

  private java.util.Optional<PayPeriodRecord> periodFor(LocalDate date) {
    return jdbc
        .queryForList(
            "SELECT id, start_date, end_date, status FROM pay_period"
                + " WHERE ? BETWEEN start_date AND end_date",
            date)
        .stream()
        .findFirst()
        .map(ReportsService::periodRecord);
  }

  private static PayPeriodRecord periodRecord(Map<String, Object> row) {
    return new PayPeriodRecord(
        (UUID) row.get("id"),
        ((java.sql.Date) row.get("start_date")).toLocalDate(),
        ((java.sql.Date) row.get("end_date")).toLocalDate(),
        (String) row.get("status"));
  }

  private ReportsViews.HoursPeriod hoursPeriod(PayPeriodRecord period) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT p.locked_at, u.display_name AS locked_by FROM pay_period p"
                + " LEFT JOIN app_user u ON u.id = p.locked_by WHERE p.id = ?",
            period.id());
    if (rows.isEmpty()) {
      // A range with no pay period (M5): a clear empty report, not a failed query.
      return new ReportsViews.HoursPeriod(
          period.id(), label(period.from(), period.to(), false), period.status(), null, null);
    }
    Map<String, Object> row = rows.get(0);
    Timestamp lockedAt = (Timestamp) row.get("locked_at");
    return new ReportsViews.HoursPeriod(
        period.id(),
        label(period.from(), period.to(), false),
        period.status(),
        (String) row.get("locked_by"),
        lockedAt == null ? null : STAMP.format(lockedAt.toInstant().atZone(REGINA)));
  }

  // ---------------------------------------------------------------------------------------------
  // Overtime
  // ---------------------------------------------------------------------------------------------

  public ReportsViews.OvertimeReport overtime(
      AuthPrincipal principal, LocalDate fromInput, LocalDate toInput, String unitId, Integer top) {
    LocalDate from = fromInput != null ? fromInput : firstOfQuarter(asOf);
    LocalDate to = toInput != null ? toInput : asOf;
    validate(from, to);
    // The screen's chart is "top 8" (docs/ui/README.md §5.5); ?top= can ask for more.
    int limit = top == null || top < 1 ? 8 : Math.min(top, 100);

    Scope scope = scope(principal, unitId);
    if (scope.unitIds().isEmpty()) {
      return new ReportsViews.OvertimeReport(List.of(), 0);
    }

    List<Map<String, Object>> entries =
        jdbc.queryForList(
            entriesSql(false, scope.unitIds().size(), false),
            args(List.of(from, to), scope.unitIds()));

    record Officer(String name, String employeeNo, Map<UUID, List<Double>> byPeriod) {}
    Map<UUID, Officer> officers = new LinkedHashMap<>();
    for (Map<String, Object> entry : entries) {
      if (entry.get("absence_type") != null) {
        continue;
      }
      UUID id = (UUID) entry.get("employee_id");
      officers
          .computeIfAbsent(
              id,
              key ->
                  new Officer(
                      (String) entry.get("name"), (String) entry.get("employee_no"), new LinkedHashMap<>()))
          .byPeriod()
          .computeIfAbsent((UUID) entry.get("pay_period_id"), key -> new ArrayList<>())
          .add(((Number) entry.get("hours")).doubleValue());
    }

    List<ReportsViews.OvertimeByOfficer> all = new ArrayList<>();
    double total = 0;
    for (Map.Entry<UUID, Officer> entry : officers.entrySet()) {
      double hours = 0;
      for (List<Double> hoursInOrder : entry.getValue().byPeriod().values()) {
        hours +=
            classifier.allocate(hoursInOrder, policy).stream()
                .filter(portion -> "OT15".equals(portion.payCode()))
                .mapToDouble(PayClassifier.Portion::hours)
                .sum();
      }
      if (hours > 0) {
        all.add(
            new ReportsViews.OvertimeByOfficer(entry.getKey(), entry.getValue().name(), round2(hours)));
        total += hours;
      }
    }
    all.sort(
        Comparator.comparingDouble(ReportsViews.OvertimeByOfficer::hours)
            .reversed()
            .thenComparing(ReportsViews.OvertimeByOfficer::name));

    int officersInScope = officers.isEmpty() ? 0 : countOfficers(scope.unitIds(), from, to);
    double average = officersInScope == 0 ? 0 : total / officersInScope;
    return new ReportsViews.OvertimeReport(
        all.stream().limit(limit).toList(), round2(average));
  }

  private int countOfficers(List<UUID> unitIds, LocalDate from, LocalDate to) {
    Object[] args = args(List.of(from, to), unitIds, List.of(from, to), unitIds);
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM ("
                + " SELECT s.employee_id FROM shift_assignment s"
                + " WHERE s.status <> 'CANCELLED' AND s.work_date BETWEEN ? AND ?"
                + " AND s.unit_id IN (" + placeholders(unitIds.size()) + ")"
                + " UNION"
                + " SELECT te.employee_id FROM time_entry te"
                + " LEFT JOIN shift_assignment s2 ON s2.id = te.shift_assignment_id"
                + " JOIN employee e2 ON e2.id = te.employee_id"
                + " WHERE te.work_date BETWEEN ? AND ?"
                + " AND coalesce(s2.unit_id, e2.home_unit_id) IN (" + placeholders(unitIds.size()) + ")"
                + ") officers",
            Integer.class,
            args);
    return count == null ? 0 : count;
  }

  // ---------------------------------------------------------------------------------------------
  // Overrides
  // ---------------------------------------------------------------------------------------------

  public List<ReportsViews.OverrideRow> overrides(
      AuthPrincipal principal, LocalDate fromInput, LocalDate toInput, String unitId) {
    LocalDate from = fromInput != null ? fromInput : asOf.minusDays(27);
    LocalDate to = toInput != null ? toInput : asOf;
    validate(from, to);

    Scope scope = scope(principal, unitId);
    boolean facility = principal.hasRole("AUDITOR");
    if (!facility && scope.unitIds().isEmpty()) {
      return List.of();
    }

    Instant start = from.atStartOfDay(REGINA).toInstant();
    Instant end = to.plusDays(1).atStartOfDay(REGINA).toInstant();
    List<Object> overrideArgs = new ArrayList<>(List.of(Timestamp.from(start), Timestamp.from(end)));
    if (!facility) {
      overrideArgs.addAll(scope.unitIds());
    }
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT o.id, o.created_at, o.reason, o.rule_codes, u.display_name AS actor,"
                + " e.first_name || ' ' || e.last_name AS employee_name, un.name AS unit_name"
                + " FROM override o"
                + " LEFT JOIN app_user u ON u.id = o.created_by"
                + " LEFT JOIN shift_assignment s ON s.override_id = o.id"
                + " LEFT JOIN employee e ON e.id = s.employee_id"
                + " LEFT JOIN unit un ON un.id = s.unit_id"
                + " WHERE o.created_at >= ? AND o.created_at < ?"
                + (facility ? "" : " AND s.unit_id IN (" + placeholders(scope.unitIds().size()) + ")")
                + " ORDER BY o.created_at DESC",
            overrideArgs.toArray());

    Set<UUID> seen = new LinkedHashSet<>();
    List<ReportsViews.OverrideRow> result = new ArrayList<>();
    for (Map<String, Object> row : rows) {
      UUID id = (UUID) row.get("id");
      if (!seen.add(id)) {
        continue;
      }
      String ruleCode = null;
      Object codes = row.get("rule_codes");
      if (codes instanceof java.sql.Array array) {
        try {
          codes = array.getArray();
        } catch (java.sql.SQLException ignored) {
          codes = null;
        }
      }
      if (codes instanceof Object[] values && values.length > 0) {
        List<String> text = new ArrayList<>();
        for (Object value : values) {
          text.add(String.valueOf(value));
        }
        ruleCode = String.join(", ", text);
      }
      Timestamp at = (Timestamp) row.get("created_at");
      result.add(
          new ReportsViews.OverrideRow(
              id,
              STAMP.format(at.toInstant().atZone(REGINA)),
              (String) row.get("employee_name"),
              (String) row.get("unit_name"),
              (String) row.get("reason"),
              ruleCode,
              (String) row.get("actor")));
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // CSV exports
  // ---------------------------------------------------------------------------------------------

  public String coverageCsv(
      AuthPrincipal principal, LocalDate from, LocalDate to, String groupBy, String unitId) {
    ReportsViews.CoverageReport report = coverage(principal, from, to, groupBy, unitId);
    StringBuilder csv =
        new StringBuilder(
            "week,required_hours,scheduled_hours,actual_hours,scheduled_percent,actual_percent,"
                + "planned,extra_hours,extra_day,extra_evening,extra_night\n");
    for (ReportsViews.CoverageWeek week : report.weeks()) {
      csv.append(Csv.cell(week.label()))
          .append(',')
          .append(money(week.requiredHours()))
          .append(',')
          .append(money(week.scheduledHours()))
          .append(',')
          .append(money(week.actualHours()))
          .append(',')
          .append(money(week.scheduledPercent()))
          .append(',')
          .append(money(week.actualPercent()))
          .append(',')
          .append(week.planned())
          .append(',')
          .append(money(week.extraHours()))
          .append(',')
          .append(money(week.extraHoursByBlock().get("DAY")))
          .append(',')
          .append(money(week.extraHoursByBlock().get("EVENING")))
          .append(',')
          .append(money(week.extraHoursByBlock().get("NIGHT")))
          .append('\n');
    }
    return csv.toString();
  }

  public String hoursCsv(
      AuthPrincipal principal,
      LocalDate from,
      LocalDate to,
      String unitId,
      UUID employeeId) {
    ReportsViews.HoursReport report = hours(principal, from, to, unitId, employeeId);
    StringBuilder csv =
        new StringBuilder(
            "employee_no,name,scheduled,worked,regular,overtime_15,overtime_20,sick,vacation\n");
    Map<UUID, String> numbers =
        employeeNumbers(
            report.rows().stream().map(ReportsViews.HoursByOfficer::employeeId).toList());
    for (ReportsViews.HoursByOfficer row : report.rows()) {
      csv.append(Csv.cell(numbers.getOrDefault(row.employeeId(), row.employeeId().toString())))
          .append(',')
          .append(Csv.cell(row.name()))
          .append(',')
          .append(money(row.scheduled()))
          .append(',')
          .append(money(row.worked()))
          .append(',')
          .append(money(row.regular()))
          .append(',')
          .append(money(row.overtime15()))
          .append(',')
          .append(money(row.overtime20()))
          .append(',')
          .append(money(row.sick()))
          .append(',')
          .append(money(row.vacation()))
          .append('\n');
    }
    return csv.toString();
  }

  public String overtimeCsv(
      AuthPrincipal principal, LocalDate from, LocalDate to, String unitId, Integer top) {
    ReportsViews.OvertimeReport report = overtime(principal, from, to, unitId, top);
    Map<UUID, String> numbers =
        employeeNumbers(report.rows().stream().map(ReportsViews.OvertimeByOfficer::employeeId).toList());
    StringBuilder csv = new StringBuilder("employee_no,name,overtime_hours\n");
    for (ReportsViews.OvertimeByOfficer row : report.rows()) {
      csv.append(Csv.cell(numbers.getOrDefault(row.employeeId(), row.employeeId().toString())))
          .append(',')
          .append(Csv.cell(row.name()))
          .append(',')
          .append(money(row.hours()))
          .append('\n');
    }
    return csv.toString();
  }

  public String overridesCsv(
      AuthPrincipal principal, LocalDate from, LocalDate to, String unitId) {
    List<ReportsViews.OverrideRow> rows = overrides(principal, from, to, unitId);
    StringBuilder csv = new StringBuilder("at,employee,unit,rule_codes,actor,reason\n");
    for (ReportsViews.OverrideRow row : rows) {
      csv.append(Csv.cell(row.at()))
          .append(',')
          .append(Csv.cell(row.employeeName() == null ? "" : row.employeeName()))
          .append(',')
          .append(Csv.cell(row.unitName() == null ? "" : row.unitName()))
          .append(',')
          .append(Csv.cell(row.ruleCode() == null ? "" : row.ruleCode()))
          .append(',')
          .append(Csv.cell(row.actor() == null ? "" : row.actor()))
          .append(',')
          .append(Csv.cell(row.reason()))
          .append('\n');
    }
    return csv.toString();
  }

  private Map<UUID, String> employeeNumbers(List<UUID> ids) {
    Map<UUID, String> numbers = new HashMap<>();
    if (ids.isEmpty()) {
      return numbers;
    }
    jdbc.query(
        "SELECT id, employee_no FROM employee WHERE id IN (" + placeholders(ids.size()) + ")",
        rs -> {
          numbers.put((UUID) rs.getObject("id"), rs.getString("employee_no"));
        },
        ids.toArray());
    return numbers;
  }

  // ---------------------------------------------------------------------------------------------
  // Scope and helpers
  // ---------------------------------------------------------------------------------------------

  private record Scope(
      List<UUID> unitIds, Map<UUID, Map<String, Integer>> requirements) {}

  private Scope scope(AuthPrincipal principal, String unitId) {
    List<UUID> unitIds = new ArrayList<>();
    if (unitId != null && !unitId.isBlank()) {
      UUID unitKey;
      try {
        unitKey = UUID.fromString(unitId);
      } catch (IllegalArgumentException error) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unit not found");
      }
      Map<String, Object> unit =
          jdbc
              .queryForList("SELECT id, code FROM unit WHERE id = ?", unitKey)
              .stream()
              .findFirst()
              .orElseThrow(
                  () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unit not found"));
      AuthPrincipal caller = principal;
      scopeGuard.requireUnit(caller, (String) unit.get("code"));
      unitIds.add((UUID) unit.get("id"));
    } else if (principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY")) {
      jdbc.query(
          "SELECT id FROM unit WHERE active ORDER BY code",
          rs -> {
            unitIds.add((UUID) rs.getObject("id"));
          });
    } else {
      for (String code : principal.units()) {
        List<UUID> found =
            jdbc.queryForList("SELECT id FROM unit WHERE code = ? AND active", UUID.class, code);
        unitIds.addAll(found);
      }
    }

    Map<UUID, Map<String, Integer>> requirements = new LinkedHashMap<>();
    if (!unitIds.isEmpty()) {
      jdbc.query(
          "SELECT unit_id, block, min_staff FROM unit_requirement"
              + " WHERE effective_to IS NULL AND unit_id IN (" + placeholders(unitIds.size()) + ")",
          rs -> {
            requirements
                .computeIfAbsent((UUID) rs.getObject("unit_id"), key -> new LinkedHashMap<>())
                .put(rs.getString("block"), rs.getInt("min_staff"));
          },
          unitIds.toArray());
    }
    return new Scope(unitIds, requirements);
  }

  private static LocalDate firstOfQuarter(LocalDate date) {
    int firstMonth = ((date.getMonthValue() - 1) / 3) * 3 + 1;
    return LocalDate.of(date.getYear(), firstMonth, 1);
  }

  private static void validate(LocalDate from, LocalDate to) {
    if (to.isBefore(from)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "to must not be before from");
    }
    if (from.plusDays(MAX_DAYS).isBefore(to)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "The range must span at most " + MAX_DAYS + " days");
    }
  }

  private static String label(LocalDate from, LocalDate to, boolean week) {
    if (!week && from.equals(to)) {
      return from.format(DAY_MONTH);
    }
    if (from.getYear() == to.getYear() && from.getMonth() == to.getMonth()) {
      return from.format(DateTimeFormatter.ofPattern("d", Locale.CANADA))
          + " – "
          + to.format(DAY_MONTH);
    }
    return from.format(DAY_MONTH) + " – " + to.format(DAY_MONTH_YEAR);
  }

  private static String placeholders(int count) {
    return String.join(",", java.util.Collections.nCopies(count, "?"));
  }

  private static Object[] args(List<?>... parts) {
    List<Object> all = new ArrayList<>();
    for (List<?> part : parts) {
      all.addAll(part);
    }
    return all.toArray();
  }

  private static double round2(double value) {
    return Math.round(value * 100.0) / 100.0;
  }

  private static String money(Double value) {
    return value == null ? "" : String.format(Locale.ROOT, "%.2f", value);
  }


  /** Kept so the coverage CSV can be extended with the raw hours without another query. */
  public LocalDate asOf() {
    return asOf;
  }
}
