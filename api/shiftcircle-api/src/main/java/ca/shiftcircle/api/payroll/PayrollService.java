package ca.shiftcircle.api.payroll;

import ca.shiftcircle.api.csv.Csv;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import ca.shiftcircle.rules.pay.PayClassification;
import ca.shiftcircle.rules.pay.PayClassifier;
import ca.shiftcircle.rules.pay.PayPolicy;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Time and payroll (docs/07 §4.5, HANDOFF step 9).
 *
 * <p>Actuals are recorded against a rostered shift and recalculate the whole period's pay codes
 * through {@link PayClassifier}: overtime is the hours beyond the period threshold, in time order
 * (ADR-016). A period cannot be locked while a shift that has ended has no actual or absence
 * (ADR-017); a locked period is read-only and the database trigger enforces the same rule. The
 * payroll export is CSV for a locked period only, and its SHA-256 goes into {@code payroll_export}.
 */
@Service
public class PayrollService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d", Locale.CANADA);
  private static final DateTimeFormatter DAY_MONTH =
      DateTimeFormatter.ofPattern("d MMM", Locale.CANADA);
  private static final DateTimeFormatter DAY_MONTH_YEAR =
      DateTimeFormatter.ofPattern("d MMM yyyy", Locale.CANADA);
  private static final DateTimeFormatter LOCKED_AT =
      DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.CANADA);
  private static final List<String> ABSENCE_TYPES = List.of("SICK", "VACATION", "OTHER");

  private final JdbcTemplate jdbc;
  private final ScopeGuard scopeGuard;
  private final PayClassifier classifier = new PayClassifier();
  private final PayPolicy policy = classifier.policyFrom(RuleRowsV1.ruleSet());
  private final ObjectMapper mapper = new ObjectMapper();

  public PayrollService(JdbcTemplate jdbc, ScopeGuard scopeGuard) {
    this.jdbc = jdbc;
    this.scopeGuard = scopeGuard;
  }

  // ---------------------------------------------------------------------------------------------
  // Pay periods
  // ---------------------------------------------------------------------------------------------

  /** All periods, newest first. A period is facility-wide; unit scope is applied to its entries. */
  public List<PayrollViews.PayPeriodView> payPeriods(AuthPrincipal principal) {
    requireSomeScope(principal);
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT p.id, p.start_date, p.end_date, p.status, p.locked_at, u.display_name AS locked_by"
                + " FROM pay_period p LEFT JOIN app_user u ON u.id = p.locked_by"
                + " ORDER BY p.start_date DESC");
    List<PayrollViews.PayPeriodView> periods = new ArrayList<>();
    for (Map<String, Object> row : rows) {
      periods.add(periodView(row));
    }
    return periods;
  }

  private PayrollViews.PayPeriodView periodView(Map<String, Object> row) {
    UUID id = (UUID) row.get("id");
    LocalDate from = ((java.sql.Date) row.get("start_date")).toLocalDate();
    LocalDate to = ((java.sql.Date) row.get("end_date")).toLocalDate();
    Timestamp lockedAt = (Timestamp) row.get("locked_at");

    PayrollViews.Totals totals = totals(id);
    PayrollViews.ExportInfo lastExport =
        jdbc
            .query(
                "SELECT generated_at, file_sha256 FROM payroll_export WHERE pay_period_id = ?"
                    + " ORDER BY generated_at DESC LIMIT 1",
                (rs, index) ->
                    new PayrollViews.ExportInfo(
                        friendly(rs.getTimestamp("generated_at")), rs.getString("file_sha256")),
                id)
            .stream()
            .findFirst()
            .orElse(null);

    return new PayrollViews.PayPeriodView(
        id,
        label(from, to),
        from,
        to,
        (String) row.get("status"),
        (String) row.get("locked_by"),
        lockedAt == null ? null : LOCKED_AT.format(lockedAt.toInstant().atZone(REGINA)),
        lastExport,
        totals,
        policy.thresholdHours());
  }

  private PayrollViews.Totals totals(UUID periodId) {
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT count(DISTINCT employee_id) AS officers,"
                + " coalesce(sum(hours) FILTER (WHERE absence_type IS NULL), 0) AS worked"
                + " FROM time_entry WHERE pay_period_id = ?",
            periodId);
    int officers = ((Number) row.get("officers")).intValue();
    double worked = round2(((Number) row.get("worked")).doubleValue());

    double overtime = 0;
    List<Map<String, Object>> perOfficer =
        jdbc.queryForList(
            "SELECT employee_id, sum(hours) AS h FROM time_entry"
                + " WHERE pay_period_id = ? AND absence_type IS NULL GROUP BY employee_id",
            periodId);
    for (Map<String, Object> officer : perOfficer) {
      overtime +=
          classifier.classify(((Number) officer.get("h")).doubleValue(), policy).overtimeHours();
    }
    return new PayrollViews.Totals(officers, worked, round2(overtime));
  }

  private PayPeriodRecord period(UUID periodId) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, start_date, end_date, status FROM pay_period WHERE id = ?", periodId);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Pay period not found");
    }
    Map<String, Object> row = rows.get(0);
    return new PayPeriodRecord(
        (UUID) row.get("id"),
        ((java.sql.Date) row.get("start_date")).toLocalDate(),
        ((java.sql.Date) row.get("end_date")).toLocalDate(),
        (String) row.get("status"));
  }

  private record PayPeriodRecord(UUID id, LocalDate from, LocalDate to, String status) {}

  // ---------------------------------------------------------------------------------------------
  // Time entries (scheduled vs actual)
  // ---------------------------------------------------------------------------------------------

  public List<PayrollViews.TimeEntryView> timeEntries(
      UUID periodId, UUID employeeFilter, AuthPrincipal principal) {
    PayPeriodRecord period = period(periodId);
    StringBuilder sql = new StringBuilder(ENTRY_SELECT).append(ENTRY_WHERE);
    List<Object> args = new ArrayList<>(List.of(period.from(), period.to()));

    if (!addScope(principal, sql, args)) {
      return List.of();
    }
    if (employeeFilter != null) {
      requireEmployeeAccess(principal, employeeFilter, period);
      sql.append(" AND s.employee_id = ?");
      args.add(employeeFilter);
    }
    sql.append(" ORDER BY s.start_at, e.last_name, e.first_name");

    List<PayrollViews.TimeEntryView> entries = new ArrayList<>();
    Instant now = Instant.now();
    jdbc.query(
        sql.toString(),
        rs -> {
          entries.add(entryView(rs, now));
        },
        args.toArray());
    return entries;
  }

  /** Returns false when the principal has no unit scope at all, so the list is empty. */
  private boolean addScope(AuthPrincipal principal, StringBuilder sql, List<Object> args) {
    if (principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY")) {
      return true;
    }
    if (principal.hasRole("SUPERVISOR")) {
      List<String> units = principal.units();
      if (units.isEmpty()) {
        return false;
      }
      sql.append(" AND u.code IN (").append(placeholders(units.size())).append(")");
      args.addAll(units);
      return true;
    }
    if (principal.hasRole("EMPLOYEE")) {
      if (principal.employeeId() == null) {
        return false;
      }
      sql.append(" AND s.employee_id = ?");
      args.add(principal.employeeId());
      return true;
    }
    return false;
  }

  private void requireEmployeeAccess(
      AuthPrincipal principal, UUID employeeId, PayPeriodRecord period) {
    if (principal.hasRole("AUDITOR")) {
      return;
    }
    if (employeeId.equals(principal.employeeId())) {
      return;
    }
    if (principal.hasRole("SUPERVISOR") && employeeInScope(employeeId, period, principal)) {
      return;
    }
    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
  }

  private boolean employeeInScope(
      UUID employeeId, PayPeriodRecord period, AuthPrincipal principal) {
    if (principal.units().isEmpty()) {
      return false;
    }
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
                + " WHERE s.employee_id = ? AND s.work_date BETWEEN ? AND ? AND u.code IN ("
                + placeholders(principal.units().size())
                + ")",
            Integer.class,
            concat(List.of(employeeId, period.from(), period.to()), principal.units()));
    return count != null && count > 0;
  }

  private static final String ENTRY_SELECT =
      "SELECT s.id AS assignment_id, s.employee_id, e.first_name || ' ' || e.last_name AS employee_name,"
          + " s.unit_id, u.name AS unit_name, s.work_date, t.code AS template_code,"
          + " s.start_at AS scheduled_start, s.end_at AS scheduled_end,"
          + " te.id AS time_entry_id, te.start_at AS actual_start, te.end_at AS actual_end,"
          + " te.absence_type, te.hours AS actual_hours, te.pay_code,"
          + " EXISTS (SELECT 1 FROM absence a WHERE a.shift_assignment_id = s.id) AS has_absence"
          + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
          + " JOIN unit u ON u.id = s.unit_id JOIN shift_template t ON t.id = s.shift_template_id"
          + " LEFT JOIN LATERAL (SELECT te.* FROM time_entry te"
          + "   WHERE te.shift_assignment_id = s.id ORDER BY te.created_at DESC LIMIT 1) te ON true";

  private static final String ENTRY_WHERE =
      " WHERE s.work_date BETWEEN ? AND ? AND s.status <> 'CANCELLED'";

  private PayrollViews.TimeEntryView entryView(java.sql.ResultSet rs, Instant now)
      throws java.sql.SQLException {
    Timestamp scheduledStart = rs.getTimestamp("scheduled_start");
    Timestamp scheduledEnd = rs.getTimestamp("scheduled_end");
    Timestamp actualStart = rs.getTimestamp("actual_start");
    Timestamp actualEnd = rs.getTimestamp("actual_end");
    String absence = rs.getString("absence_type");
    boolean hasActual = rs.getObject("time_entry_id") != null;

    Integer unpaidExtension = null;
    if (actualEnd != null && absence == null && actualEnd.after(scheduledEnd)) {
      long minutes = (actualEnd.getTime() - scheduledEnd.getTime()) / 60_000L;
      if (minutes > 0 && minutes < 30) {
        unpaidExtension = (int) minutes;
      }
    }

    List<PayrollViews.PayCodeView> payCodes = new ArrayList<>();
    if (hasActual) {
      String code = rs.getString("pay_code");
      double hours = rs.getDouble("actual_hours");
      if (code != null) {
        payCodes.add(
            new PayrollViews.PayCodeView(
                code, round2(hours), "OT15".equals(code) ? policy.overtimeRate() : 1.0));
      }
    }

    boolean needsActual =
        !hasActual
            && !rs.getBoolean("has_absence")
            && !scheduledEnd.toInstant().isAfter(now);

    return new PayrollViews.TimeEntryView(
        (UUID) rs.getObject("assignment_id"),
        (UUID) rs.getObject("employee_id"),
        rs.getString("employee_name"),
        rs.getObject("unit_id").toString(),
        rs.getString("unit_name"),
        ((java.sql.Date) rs.getObject("work_date")).toLocalDate(),
        rs.getString("template_code"),
        format(scheduledStart),
        format(scheduledEnd),
        format(actualStart),
        format(actualEnd),
        hasActual && absence == null,
        absence,
        unpaidExtension,
        payCodes,
        needsActual);
  }

  // ---------------------------------------------------------------------------------------------
  // Record actuals and absences
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public PayrollViews.RecordActualResult recordActual(
      UUID assignmentId, PayrollInputs.RecordActual input, AuthPrincipal principal) {
    Assignment assignment = assignment(assignmentId);
    scopeGuard.requireUnit(principal, assignment.unitCode());
    PayPeriodRecord period = periodFor(assignment.workDate());
    requireOpen(period);

    if (input.absence() != null) {
      return saveAbsence(assignment, period, input.absence(), principal);
    }

    Instant start;
    Instant end;
    if (Boolean.TRUE.equals(input.workedAsScheduled())) {
      start = assignment.start();
      end = assignment.end();
    } else {
      if (input.actualStart() == null || input.actualEnd() == null) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "The adjusted times need an actual start and end");
      }
      start = input.actualStart();
      end = input.actualEnd();
      if (!end.isAfter(start)) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The actual end must be after the start");
      }
      // A ten-year actual is a typo, not a shift. Keep the window to the day either side of the
      // rostered shift; it also keeps the hours inside numeric(5,2) (review-r2 P3).
      Instant earliest = assignment.start().minusSeconds(24 * 3600);
      Instant latest = assignment.end().plusSeconds(24 * 3600);
      if (start.isBefore(earliest)
          || end.isBefore(earliest)
          || start.isAfter(latest)
          || end.isAfter(latest)) {
        throw new InvalidActualWindowException(
            "The actual times must be within 24 hours of the rostered shift ("
                + assignment.start()
                + " to "
                + assignment.end()
                + ")");
      }
    }

    jdbc.update("DELETE FROM absence WHERE shift_assignment_id = ?", assignmentId);
    UUID entryId = upsertEntry(assignment, period, start, end, null, principal);
    recalculate(period.id());
    audit(
        principal,
        "record_actual",
        "time_entry",
        entryId,
        Map.of(
            "assignmentId", assignmentId.toString(),
            "startAt", start.toString(),
            "endAt", end.toString()));

    return result(assignmentId, principal);
  }

  @Transactional
  public PayrollViews.RecordActualResult recordAbsence(
      PayrollInputs.Absence input, AuthPrincipal principal) {
    if (input.assignmentId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "assignmentId is required");
    }
    Assignment assignment = assignment(input.assignmentId());
    scopeGuard.requireUnit(principal, assignment.unitCode());
    PayPeriodRecord period = periodFor(assignment.workDate());
    requireOpen(period);
    return saveAbsence(assignment, period, input.type(), principal);
  }

  private PayrollViews.RecordActualResult saveAbsence(
      Assignment assignment, PayPeriodRecord period, String type, AuthPrincipal principal) {
    String absence = type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
    if (!ABSENCE_TYPES.contains(absence)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "An absence type is SICK, VACATION or OTHER");
    }
    String code = "VACATION".equals(absence) ? "VAC" : "SICK";

    jdbc.update(
        "DELETE FROM absence WHERE shift_assignment_id = ?", assignment.id());
    jdbc.update(
        "INSERT INTO absence (id, employee_id, shift_assignment_id, type, start_at, end_at,"
            + " recorded_by) VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM app_user WHERE username = ?))",
        UUID.randomUUID(),
        assignment.employeeId(),
        assignment.id(),
        absence,
        Timestamp.from(assignment.start()),
        Timestamp.from(assignment.end()),
        principal.username());

    UUID entryId =
        upsertEntry(
            assignment,
            period,
            assignment.start(),
            assignment.end(),
            absence,
            principal);
    recalculate(period.id());
    audit(
        principal,
        "record_absence",
        "time_entry",
        entryId,
        Map.of("assignmentId", assignment.id().toString(), "type", absence));
    return result(assignment.id(), principal);
  }

  private UUID upsertEntry(
      Assignment assignment,
      PayPeriodRecord period,
      Instant start,
      Instant end,
      String absence,
      AuthPrincipal principal) {
    double hours = round2((end.getEpochSecond() - start.getEpochSecond()) / 3600.0);
    String code =
        absence == null
            ? "REG"
            : "VACATION".equals(absence) ? "VAC" : "SICK";
    List<UUID> existing =
        jdbc.queryForList(
            "SELECT id FROM time_entry WHERE shift_assignment_id = ?"
                + " ORDER BY created_at DESC LIMIT 1",
            UUID.class,
            assignment.id());

    UUID entryId = existing.isEmpty() ? UUID.randomUUID() : existing.get(0);
    if (existing.isEmpty()) {
      jdbc.update(
          "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
              + " start_at, end_at, hours, entry_type, absence_type, pay_code,"
              + " rule_set_version_id, recorded_by)"
              + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTUAL', ?, ?,"
              + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED' LIMIT 1),"
              + " (SELECT id FROM app_user WHERE username = ?))",
          entryId,
          assignment.employeeId(),
          period.id(),
          assignment.id(),
          assignment.workDate(),
          Timestamp.from(start),
          Timestamp.from(end),
          hours,
          absence,
          code,
          principal.username());
    } else {
      jdbc.update(
          "UPDATE time_entry SET start_at = ?, end_at = ?, hours = ?, entry_type = 'ACTUAL',"
              + " absence_type = ?, pay_code = ?,"
              + " recorded_by = (SELECT id FROM app_user WHERE username = ?) WHERE id = ?",
          Timestamp.from(start),
          Timestamp.from(end),
          hours,
          absence,
          code,
          principal.username(),
          entryId);
    }
    return entryId;
  }

  private PayrollViews.RecordActualResult result(UUID assignmentId, AuthPrincipal principal) {
    List<PayrollViews.TimeEntryView> entries =
        jdbc.query(
            ENTRY_SELECT + " WHERE s.id = ?",
            (rs, index) -> entryView(rs, Instant.now()),
            assignmentId);
    PayrollViews.TimeEntryView entry =
        entries.isEmpty()
            ? null
            : entries.get(0);
    double employeeHours = 0;
    List<PayrollViews.PayCodeView> codes = new ArrayList<>();
    if (entry != null) {
      employeeHours = hoursFor(entry.employeeId(), assignmentPeriod(assignmentId));
      PayClassification classification = classifier.classify(employeeHours, policy);
      double regular = round2(classification.totalHours() - classification.overtimeHours());
      if (regular > 0) {
        codes.add(new PayrollViews.PayCodeView("REG", regular, 1.0));
      }
      if (classification.overtimeHours() > 0) {
        codes.add(
            new PayrollViews.PayCodeView(
                "OT15", round2(classification.overtimeHours()), classification.rate()));
      }
    }
    return new PayrollViews.RecordActualResult(entry, codes, round2(employeeHours));
  }

  private UUID assignmentPeriod(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT pay_period_id FROM time_entry WHERE shift_assignment_id = ?"
            + " ORDER BY created_at DESC LIMIT 1",
        UUID.class,
        assignmentId);
  }

  private double hoursFor(UUID employeeId, UUID periodId) {
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT coalesce(sum(hours), 0) AS h FROM time_entry"
                + " WHERE employee_id = ? AND pay_period_id = ? AND absence_type IS NULL",
            employeeId,
            periodId);
    return ((Number) row.get("h")).doubleValue();
  }

  /**
   * Recalculates every worked entry's pay code in the period, in time order, using the classifier.
   * Absence entries keep their SICK/VAC code.
   */
  private void recalculate(UUID periodId) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, employee_id, hours, absence_type, pay_code FROM time_entry"
                + " WHERE pay_period_id = ? ORDER BY employee_id, start_at, id",
            periodId);

    Map<UUID, List<Map<String, Object>>> byEmployee = new LinkedHashMap<>();
    for (Map<String, Object> row : rows) {
      byEmployee
          .computeIfAbsent((UUID) row.get("employee_id"), key -> new ArrayList<>())
          .add(row);
    }

    List<Object[]> updates = new ArrayList<>();
    for (List<Map<String, Object>> entries : byEmployee.values()) {
      List<Map<String, Object>> worked =
          entries.stream().filter(entry -> entry.get("absence_type") == null).toList();
      if (worked.isEmpty()) {
        continue;
      }
      List<Double> hours =
          worked.stream().map(entry -> ((Number) entry.get("hours")).doubleValue()).toList();
      List<PayClassifier.Portion> portions = classifier.allocate(hours, policy);

      int portionIndex = 0;
      for (Map<String, Object> entry : worked) {
        double remaining = ((Number) entry.get("hours")).doubleValue();
        boolean anyOvertime = false;
        while (remaining > 0.0001 && portionIndex < portions.size()) {
          PayClassifier.Portion portion = portions.get(portionIndex);
          double used = Math.min(remaining, portion.hours());
          if ("OT15".equals(portion.payCode()) && used > 0) {
            anyOvertime = true;
          }
          remaining = round2(remaining - used);
          PayClassifier.Portion rest =
              new PayClassifier.Portion(portion.payCode(), round2(portion.hours() - used));
          portions.set(portionIndex, rest);
          if (rest.hours() <= 0.0001) {
            portionIndex++;
          }
        }
        updates.add(new Object[] {anyOvertime ? "OT15" : "REG", entry.get("id")});
      }
    }
    if (!updates.isEmpty()) {
      jdbc.batchUpdate("UPDATE time_entry SET pay_code = ? WHERE id = ?", updates);
    }
  }

  private record Assignment(
      UUID id, UUID employeeId, UUID unitId, String unitCode, LocalDate workDate, Instant start,
      Instant end) {}

  private Assignment assignment(UUID assignmentId) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT s.id, s.employee_id, s.unit_id, u.code AS unit_code, s.work_date,"
                + " s.start_at, s.end_at FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
                + " WHERE s.id = ? AND s.status <> 'CANCELLED'",
            assignmentId);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Shift not found");
    }
    Map<String, Object> row = rows.get(0);
    return new Assignment(
        (UUID) row.get("id"),
        (UUID) row.get("employee_id"),
        (UUID) row.get("unit_id"),
        (String) row.get("unit_code"),
        ((java.sql.Date) row.get("work_date")).toLocalDate(),
        ((Timestamp) row.get("start_at")).toInstant(),
        ((Timestamp) row.get("end_at")).toInstant());
  }

  private PayPeriodRecord periodFor(LocalDate date) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, start_date, end_date, status FROM pay_period"
                + " WHERE ? BETWEEN start_date AND end_date",
            date);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Pay period not found");
    }
    Map<String, Object> row = rows.get(0);
    return new PayPeriodRecord(
        (UUID) row.get("id"),
        ((java.sql.Date) row.get("start_date")).toLocalDate(),
        ((java.sql.Date) row.get("end_date")).toLocalDate(),
        (String) row.get("status"));
  }

  private void requireOpen(PayPeriodRecord period) {
    if ("LOCKED".equals(period.status())) {
      throw new LockedPeriodException();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Lock, unlock, export
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public PayrollViews.PayPeriodView lock(UUID periodId, AuthPrincipal principal) {
    requireSomeScope(principal);
    PayPeriodRecord period = period(periodId);
    if (!"LOCKED".equals(period.status())) {
      List<PayrollViews.MissingActual> missing = missingActuals(period);
      if (!missing.isEmpty()) {
        throw new MissingActualsException(missing);
      }
      int locked =
          jdbc.update(
              "UPDATE pay_period SET status = 'LOCKED', locked_at = now(),"
                  + " locked_by = (SELECT id FROM app_user WHERE username = ?), unlock_reason = NULL,"
                  + " version = version + 1 WHERE id = ? AND status = 'OPEN'",
              principal.username(),
              periodId);
      if (locked > 0) {
        // A concurrent lock that lost the race changed nothing, so it must not write a second
        // audit row (review-r2 low finding).
        audit(
            principal,
            "lock_pay_period",
            "pay_period",
            periodId,
            Map.of("status", "LOCKED", "totals", totals(periodId).toString()));
      }
    }
    return periodView(periodRow(periodId));
  }

  @Transactional
  public PayrollViews.PayPeriodView unlock(
      UUID periodId, String reason, AuthPrincipal principal) {
    requireSomeScope(principal);
    PayPeriodRecord period = period(periodId);
    String clean = reason == null ? "" : reason.trim();
    if (clean.length() < 10) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "A reason of at least 10 characters is required");
    }
    if ("LOCKED".equals(period.status())) {
      jdbc.update(
          "UPDATE pay_period SET status = 'OPEN', locked_at = NULL, locked_by = NULL,"
              + " unlock_reason = ?, version = version + 1 WHERE id = ?",
          clean,
          periodId);
      audit(
          principal,
          "unlock_pay_period",
          "pay_period",
          periodId,
          Map.of("status", "OPEN", "reason", clean));
    }
    return periodView(periodRow(periodId));
  }

  private Map<String, Object> periodRow(UUID periodId) {
    return jdbc.queryForMap(
        "SELECT p.id, p.start_date, p.end_date, p.status, p.locked_at, u.display_name AS locked_by"
            + " FROM pay_period p LEFT JOIN app_user u ON u.id = p.locked_by WHERE p.id = ?",
        periodId);
  }

  private List<PayrollViews.MissingActual> missingActuals(PayPeriodRecord period) {
    Instant now = Instant.now();
    return jdbc.query(
        "SELECT s.id, s.employee_id, s.start_at FROM shift_assignment s"
            + " WHERE s.work_date BETWEEN ? AND ? AND s.status <> 'CANCELLED'"
            + " AND s.end_at <= ?"
            + " AND NOT EXISTS (SELECT 1 FROM time_entry te WHERE te.shift_assignment_id = s.id)"
            + " AND NOT EXISTS (SELECT 1 FROM absence a WHERE a.shift_assignment_id = s.id)"
            + " ORDER BY s.start_at",
        (rs, index) ->
            new PayrollViews.MissingActual(
                (UUID) rs.getObject("id"),
                (UUID) rs.getObject("employee_id"),
                format(rs.getTimestamp("start_at"))),
        period.from(),
        period.to(),
        Timestamp.from(now));
  }

  /** The payroll CSV for a locked period, plus the export record with its file hash. */
  @Transactional
  public PayrollViews.PayrollFile export(UUID periodId, AuthPrincipal principal) {
    requireSomeScope(principal);
    PayPeriodRecord period = period(periodId);
    if (!"LOCKED".equals(period.status())) {
      throw new NotLockedException("Only a locked pay period can be exported.");
    }

    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT e.employee_no, te.work_date, te.start_at, te.hours, te.absence_type,"
                + " coalesce(u.code, hu.code, '') AS unit_code"
                + " FROM time_entry te JOIN employee e ON e.id = te.employee_id"
                + " LEFT JOIN shift_assignment s ON s.id = te.shift_assignment_id"
                + " LEFT JOIN unit u ON u.id = s.unit_id"
                + " LEFT JOIN unit hu ON hu.id = e.home_unit_id"
                + " WHERE te.pay_period_id = ? ORDER BY e.employee_no, te.start_at, te.id",
            periodId);

    StringBuilder csv = new StringBuilder();
    csv.append(
        "employee_no,pay_period_start,pay_period_end,work_date,pay_code,hours,unit_code,cost_centre\n");
    int rowCount = 0;
    int index = 0;
    while (index < rows.size()) {
      String employeeNo = (String) rows.get(index).get("employee_no");
      List<Map<String, Object>> officerRows = new ArrayList<>();
      while (index < rows.size() && employeeNo.equals(rows.get(index).get("employee_no"))) {
        officerRows.add(rows.get(index));
        index++;
      }
      List<Map<String, Object>> worked =
          officerRows.stream().filter(row -> row.get("absence_type") == null).toList();
      List<Double> hours =
          worked.stream().map(row -> ((Number) row.get("hours")).doubleValue()).toList();
      List<PayClassifier.Portion> portions = classifier.allocate(hours, policy);

      int portionIndex = 0;
      for (Map<String, Object> row : officerRows) {
        if (row.get("absence_type") != null) {
          String code = "VACATION".equals(row.get("absence_type")) ? "VAC" : "SICK";
          csv.append(csvRow(period, row, code, ((Number) row.get("hours")).doubleValue()));
          rowCount++;
          continue;
        }
        double remaining = ((Number) row.get("hours")).doubleValue();
        while (remaining > 0.0001 && portionIndex < portions.size()) {
          PayClassifier.Portion portion = portions.get(portionIndex);
          double used = Math.min(remaining, portion.hours());
          csv.append(csvRow(period, row, portion.payCode(), used));
          rowCount++;
          remaining = round2(remaining - used);
          portions.set(
              portionIndex,
              new PayClassifier.Portion(portion.payCode(), round2(portion.hours() - used)));
          if (portions.get(portionIndex).hours() <= 0.0001) {
            portionIndex++;
          }
        }
      }
    }

    String content = csv.toString();
    String sha256 = sha256(content);
    jdbc.update(
        "INSERT INTO payroll_export (pay_period_id, generated_by, row_count, file_sha256)"
            + " VALUES (?, (SELECT id FROM app_user WHERE username = ?), ?, ?)",
        periodId,
        principal.username(),
        rowCount,
        sha256);
    audit(
        principal,
        "payroll_export",
        "pay_period",
        periodId,
        Map.of("rowCount", rowCount, "fileSha256", sha256));

    String fileName =
        "payroll-"
            + period.from()
            + "-"
            + period.to()
            + ".csv";
    return new PayrollViews.PayrollFile(fileName, content, sha256, rowCount);
  }

  private String csvRow(
      PayPeriodRecord period, Map<String, Object> row, String code, double hours) {
    String unitCode = String.valueOf(row.get("unit_code"));
    return String.join(
            ",",
            Csv.cell(String.valueOf(row.get("employee_no"))),
            Csv.cell(period.from().toString()),
            Csv.cell(period.to().toString()),
            Csv.cell(((java.sql.Date) row.get("work_date")).toLocalDate().toString()),
            Csv.cell(code),
            Csv.cell(String.format(Locale.ROOT, "%.2f", hours)),
            Csv.cell(unitCode),
            // The prototype has no separate cost-centre reference, so the unit code is used.
            Csv.cell(unitCode))
        + "\n";
  }

  private static String sha256(String content) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(content.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is required by the JRE", e);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  /** Pay periods are facility-wide in the prototype, so any unit scope is enough to act. */
  private void requireSomeScope(AuthPrincipal principal) {
    if (principal.hasRole("AUDITOR")) {
      return;
    }
    if (principal.units().isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Pay period not found");
    }
  }

  private void audit(
      AuthPrincipal principal,
      String action,
      String entityType,
      UUID entityId,
      Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, ?, ?, ?::jsonb)",
        principal.username(),
        action,
        entityType,
        entityId,
        mapper.writeValueAsString(after));
  }

  private static String label(LocalDate from, LocalDate to) {
    boolean sameMonth = from.getMonth() == to.getMonth() && from.getYear() == to.getYear();
    return sameMonth
        ? from.format(DAY) + " – " + to.format(DAY_MONTH_YEAR)
        : from.format(DAY_MONTH) + " – " + to.format(DAY_MONTH_YEAR);
  }

  private static String friendly(Timestamp timestamp) {
    return timestamp == null
        ? null
        : LOCKED_AT.format(timestamp.toInstant().atZone(REGINA));
  }

  private static String format(Timestamp timestamp) {
    return timestamp == null
        ? null
        : timestamp.toInstant().atZone(REGINA).toOffsetDateTime().toString();
  }

  private static String placeholders(int count) {
    return String.join(",", java.util.Collections.nCopies(count, "?"));
  }

  private static Object[] concat(List<Object> first, List<String> second) {
    List<Object> all = new ArrayList<>(first);
    all.addAll(second);
    return all.toArray();
  }

  private static double round2(double value) {
    return Math.round(value * 100.0) / 100.0;
  }
}
