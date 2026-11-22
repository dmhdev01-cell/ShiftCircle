package ca.shiftcircle.api.assignments;

import ca.shiftcircle.api.payroll.LockedPeriodException;
import ca.shiftcircle.api.rules.RuleCheckRequest;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.rules.RuleViolationException;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import ca.shiftcircle.api.time.BusinessClock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Saves a shift assignment after the rules have spoken (docs/07 §3), and moves or cancels one
 * (docs/07 §4.2).
 *
 * <p>Warn results need an explicit acknowledgement; Block results need an emergency override with a
 * reason of at least ten characters. Every save writes the override row and an audit event with the
 * actor and time (S-04, ADR-019: extra shifts are a supervisor action, never auto-approved).
 *
 * <p>Move runs the same pipeline against the target with the assignment's own current slot left
 * out, under the same per-officer advisory locks. Cancel never deletes a row and never needs a rule
 * check: removing a shift cannot create a rest or hours breach. Both check If-Match inside the lock
 * so two concurrent edits cannot both pass the version check (ADR-021).
 */
@Service
public class AssignmentService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final int MAX_REASON_LENGTH = 500;

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final ScopeGuard scopeGuard;
  private final BusinessClock clock;
  private final ObjectMapper mapper = new ObjectMapper();

  public AssignmentService(
      JdbcTemplate jdbc,
      RuleCheckService ruleChecks,
      ScopeGuard scopeGuard,
      BusinessClock clock) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
    this.scopeGuard = scopeGuard;
    this.clock = clock;
  }

  public record SaveView(UUID id, String status, int version) {}

  public record MoveView(
      UUID id,
      String status,
      int version,
      String outcome,
      int ruleSetVersion,
      boolean overridable,
      List<RuleCheckService.ResultView> ruleResults) {}

  public record CancelRequest(String reason) {}

  public record CancelView(UUID id, String status, int version) {}

  public RuleCheckService.OutcomeView preview(RuleCheckRequest request, AuthPrincipal principal) {
    requireValidChange(request);
    String unitCode = unitCode(request.change().unitId());
    if (principal.hasRole("SUPERVISOR")) {
      scopeGuard.requireUnit(principal, unitCode);
    } else {
      // An employee previews their own record only, and on their own unit (docs/07 §3, docs/09 §2).
      scopeGuard.requireEmployeeAccess(principal, request.change().employeeId(), unitCode);
      String homeUnit =
          jdbc.queryForObject(
              "SELECT u.code FROM employee e JOIN unit u ON u.id = e.home_unit_id WHERE e.id = ?",
              String.class,
              request.change().employeeId());
      if (!unitCode.equals(homeUnit)) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
      }
    }
    requireOpenPayPeriod(request.change().startAt());
    return ruleChecks.evaluate(change(request));
  }

  @Transactional
  public SaveView assign(RuleCheckRequest request, AuthPrincipal principal) {
    requireValidChange(request);
    String unitCode = unitCode(request.change().unitId());
    scopeGuard.requireUnit(principal, unitCode);
    requireOpenPayPeriod(request.change().startAt());
    Map<String, Object> template = activeTemplate(request.change().shiftTemplate());

    // Two supervisors (or a double click) must not both pass the rules against the same old roster:
    // the exclusion constraint catches true overlaps, but two saves close together can break rest
    // rules without overlapping. Serialising on the officer closes that window (review-r2 S2).
    lockOfficer(request.change().employeeId());

    RuleCheckService.OutcomeView outcome = ruleChecks.evaluate(change(request));
    UUID overrideId = decide(outcome, request, principal);

    UUID assignmentId = UUID.randomUUID();
    Instant end = endAt(request.change().startAt(), template);

    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source, override_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)",
        assignmentId,
        request.change().employeeId(),
        request.change().unitId(),
        template.get("id"),
        java.sql.Timestamp.from(request.change().startAt()),
        java.sql.Timestamp.from(end),
        request.change().startAt().atZone(REGINA).toLocalDate(),
        "EXTRA".equals(request.change().type()) ? "EXTRA" : "ROSTERED",
        overrideId);

    audit(
        principal,
        "assign_shift",
        assignmentId,
        Map.of(
            "employeeId", request.change().employeeId().toString(),
            "unit", unitCode,
            "template", request.change().shiftTemplate(),
            "startAt", request.change().startAt().toString(),
            "kind", request.change().typeOrAssign(),
            "outcome", outcome.outcome(),
            "overrideId", overrideId == null ? "" : overrideId.toString()));
    return new SaveView(assignmentId, "PLANNED", 0);
  }

  /**
   * Move a shift in place (docs/07 §4.2). The target is a full replacement, not a partial patch, and
   * the row keeps its id, kind and source.
   */
  @Transactional
  public MoveView move(
      UUID assignmentId, RuleCheckRequest request, String ifMatch, AuthPrincipal principal) {
    AssignmentRow observed = load(assignmentId);
    scopeGuard.requireUnit(principal, observed.unitCode());
    if (request == null || request.change() == null || request.change().unitId() == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "change.employeeId, change.unitId, change.shiftTemplate and change.startAt are required");
    }
    // Resolve the target unit before the rest of the body, so an unknown or out-of-scope unit is a
    // 404 by the same rule as the current one (docs/07 §4.2 check order).
    String targetUnitCode = unitCode(request.change().unitId());
    scopeGuard.requireUnit(principal, targetUnitCode);
    requireValidChange(request);
    Map<String, Object> template = activeTemplate(request.change().shiftTemplate());
    int expected = parseIfMatch(ifMatch);

    // If the officer changes, take both locks in id order so two opposite moves cannot deadlock.
    lockOfficers(List.of(observed.employeeId(), request.change().employeeId()));

    AssignmentRow current = load(assignmentId);
    scopeGuard.requireUnit(principal, current.unitCode());
    if (current.version() != expected) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.STALE_VERSION);
    }
    if ("CANCELLED".equals(current.status())) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.ALREADY_CANCELLED);
    }
    requireOpenPayPeriod(current.startAt());
    if (hasStarted(current)) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.SHIFT_STARTED);
    }
    if (fillsOpenShift(current.id())) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.FILLS_OPEN_SHIFT);
    }
    requireOpenPayPeriod(request.change().startAt());

    RuleCheckService.Change change =
        new RuleCheckService.Change(
            current.kind(),
            request.change().employeeId(),
            request.change().unitId(),
            request.change().shiftTemplate(),
            request.change().startAt());
    RuleCheckService.OutcomeView outcome = ruleChecks.evaluate(change, assignmentId);
    UUID overrideId = decide(outcome, request, principal);

    Instant end = endAt(request.change().startAt(), template);
    LocalDate workDate = request.change().startAt().atZone(REGINA).toLocalDate();
    int version = current.version() + 1;

    int updated =
        jdbc.update(
            "UPDATE shift_assignment SET employee_id = ?, unit_id = ?, shift_template_id = ?,"
                + " start_at = ?, end_at = ?, work_date = ?, override_id = ?, version = ?"
                + " WHERE id = ? AND version = ?",
            request.change().employeeId(),
            request.change().unitId(),
            template.get("id"),
            java.sql.Timestamp.from(request.change().startAt()),
            java.sql.Timestamp.from(end),
            workDate,
            overrideId,
            version,
            assignmentId,
            current.version());
    if (updated != 1) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.STALE_VERSION);
    }

    Map<String, Object> after = snapshot(current, version);
    after.put("employeeId", request.change().employeeId().toString());
    after.put("unitId", request.change().unitId().toString());
    after.put("unit", targetUnitCode);
    after.put("shiftTemplate", request.change().shiftTemplate());
    after.put("startAt", request.change().startAt().toString());
    after.put("endAt", end.toString());
    after.put("outcome", outcome.outcome());
    after.put("overrideId", overrideId == null ? "" : overrideId.toString());
    audit(principal, "move_assignment", assignmentId, snapshot(current), after);

    return new MoveView(
        assignmentId,
        "PLANNED",
        version,
        outcome.outcome(),
        outcome.ruleSetVersion(),
        outcome.overridable(),
        outcome.ruleResults());
  }

  /** Cancel a shift (docs/07 §4.2): status CANCELLED, version+1, reason in the audit row. */
  @Transactional
  public CancelView cancel(
      UUID assignmentId, CancelRequest request, String ifMatch, AuthPrincipal principal) {
    AssignmentRow observed = load(assignmentId);
    scopeGuard.requireUnit(principal, observed.unitCode());
    String reason = request == null ? null : request.reason();
    if (reason == null || reason.trim().length() < 10) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "reason is required and must be at least 10 characters");
    }
    if (reason.trim().length() > MAX_REASON_LENGTH) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "reason must be at most " + MAX_REASON_LENGTH + " characters");
    }
    int expected = parseIfMatch(ifMatch);
    lockOfficer(observed.employeeId());

    AssignmentRow current = load(assignmentId);
    scopeGuard.requireUnit(principal, current.unitCode());
    if (current.version() != expected) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.STALE_VERSION);
    }
    if ("CANCELLED".equals(current.status())) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.ALREADY_CANCELLED);
    }
    requireOpenPayPeriod(current.startAt());
    if (hasStarted(current)) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.SHIFT_STARTED);
    }
    if (hasActual(current.id())) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.ACTUAL_RECORDED);
    }
    if (hasAbsence(current.id())) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.ABSENCE_RECORDED);
    }

    int version = current.version() + 1;
    int updated =
        jdbc.update(
            "UPDATE shift_assignment SET status = 'CANCELLED', version = ?"
                + " WHERE id = ? AND version = ?",
            version,
            assignmentId,
            current.version());
    if (updated != 1) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.STALE_VERSION);
    }
    // The gap must be visible and offerable again; the confirmed offer keeps its history.
    jdbc.update(
        "UPDATE open_shift SET status = 'OPEN', filled_assignment_id = NULL"
            + " WHERE filled_assignment_id = ? AND status = 'FILLED'",
        assignmentId);

    audit(
        principal,
        "cancel_assignment",
        assignmentId,
        snapshot(current),
        Map.of("status", "CANCELLED", "reason", reason.trim()));
    return new CancelView(assignmentId, "CANCELLED", version);
  }

  private record AssignmentRow(
      UUID id,
      UUID employeeId,
      UUID unitId,
      String unitCode,
      String templateCode,
      Instant startAt,
      Instant endAt,
      LocalDate workDate,
      String kind,
      String source,
      String status,
      int version,
      UUID overrideId) {}

  private AssignmentRow load(UUID assignmentId) {
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT s.id, s.employee_id, s.unit_id, u.code AS unit_code, t.code AS template_code,"
                + " s.start_at, s.end_at, s.work_date, s.kind, s.source, s.status, s.version,"
                + " s.override_id"
                + " FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
                + " JOIN shift_template t ON t.id = s.shift_template_id WHERE s.id = ?",
            assignmentId);
    return new AssignmentRow(
        (UUID) row.get("id"),
        (UUID) row.get("employee_id"),
        (UUID) row.get("unit_id"),
        (String) row.get("unit_code"),
        (String) row.get("template_code"),
        ((java.sql.Timestamp) row.get("start_at")).toInstant(),
        ((java.sql.Timestamp) row.get("end_at")).toInstant(),
        localDate(row.get("work_date")),
        (String) row.get("kind"),
        (String) row.get("source"),
        (String) row.get("status"),
        ((Number) row.get("version")).intValue(),
        (UUID) row.get("override_id"));
  }

  private RuleCheckService.Change change(RuleCheckRequest request) {
    return new RuleCheckService.Change(
        request.change().typeOrAssign(),
        request.change().employeeId(),
        request.change().unitId(),
        request.change().shiftTemplate(),
        request.change().startAt());
  }

  private void requireValidChange(RuleCheckRequest request) {
    if (request == null
        || request.change() == null
        || request.change().employeeId() == null
        || request.change().unitId() == null
        || request.change().shiftTemplate() == null
        || request.change().shiftTemplate().isBlank()
        || request.change().startAt() == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "change.employeeId, change.unitId, change.shiftTemplate and change.startAt are required");
    }
    if (request.override() != null
        && request.override().reason() != null
        && request.override().reason().trim().length() > MAX_REASON_LENGTH) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "override.reason must be at most " + MAX_REASON_LENGTH + " characters");
    }
    // The type is ASSIGN or EXTRA only; anything else is a validation problem, not a conflict.
    request.change().typeOrAssign();
    LocalDate day = request.change().startAt().atZone(REGINA).toLocalDate();
    LocalDate today = clock.today();
    if (day.isBefore(today.minusYears(5)) || day.isAfter(today.plusYears(5))) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "The start date (startAt) must be within five years of today (" + today + ")");
    }
  }

  /**
   * The shared rule contract: Block needs an overridable result and a reason of ten characters,
   * and an override excuses blocks, never warnings. Nothing auto-approves (docs/07 §3).
   */
  private UUID decide(
      RuleCheckService.OutcomeView outcome, RuleCheckRequest request, AuthPrincipal principal) {
    boolean blocked = "BLOCK".equals(outcome.outcome());
    List<String> warnCodes = warnCodes(outcome);
    List<String> acknowledged =
        request.acknowledgeWarnings() == null ? List.of() : request.acknowledgeWarnings();
    boolean allWarningsAcknowledged = acknowledged.containsAll(warnCodes);

    if (blocked) {
      if (!outcome.overridable()
          || request.override() == null
          || request.override().reason() == null
          || request.override().reason().trim().length() < 10) {
        throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
      }
      if (!allWarningsAcknowledged) {
        throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
      }
      return createOverride(request.override().reason(), blockingCodes(outcome), principal);
    }
    if (!warnCodes.isEmpty() && !allWarningsAcknowledged) {
      throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
    }
    return null;
  }

  private void lockOfficer(UUID employeeId) {
    long key = employeeId.getMostSignificantBits() ^ employeeId.getLeastSignificantBits();
    jdbc.queryForList("SELECT pg_advisory_xact_lock(?)", Object.class, key);
  }

  private void lockOfficers(List<UUID> employeeIds) {
    employeeIds.stream().distinct().sorted().forEach(this::lockOfficer);
  }

  private boolean hasStarted(AssignmentRow row) {
    return !row.startAt().isAfter(clock.now());
  }

  private boolean hasActual(UUID assignmentId) {
    Boolean exists =
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM time_entry WHERE shift_assignment_id = ?)",
            Boolean.class,
            assignmentId);
    return Boolean.TRUE.equals(exists);
  }

  private boolean hasAbsence(UUID assignmentId) {
    Boolean exists =
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM absence WHERE shift_assignment_id = ?)",
            Boolean.class,
            assignmentId);
    return Boolean.TRUE.equals(exists);
  }

  private boolean fillsOpenShift(UUID assignmentId) {
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM open_shift WHERE filled_assignment_id = ?",
            Integer.class,
            assignmentId);
    return count != null && count > 0;
  }

  /**
   * A shift whose work date falls in a locked pay period is read-only (docs/07 E4, ADR-017). The
   * lock would otherwise strand it: the shift could be saved, but its actual never recorded.
   */
  private void requireOpenPayPeriod(Instant startAt) {
    LocalDate workDate = startAt.atZone(REGINA).toLocalDate();
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT status FROM pay_period WHERE ? BETWEEN start_date AND end_date", workDate);
    if (!periods.isEmpty() && "LOCKED".equals(periods.get(0).get("status"))) {
      throw new LockedPeriodException();
    }
  }

  private Instant endAt(Instant startAt, Map<String, Object> template) {
    return startAt.plusSeconds(((Number) template.get("duration_minutes")).longValue() * 60);
  }

  private static LocalDate localDate(Object value) {
    if (value instanceof LocalDate date) {
      return date;
    }
    return ((java.sql.Date) value).toLocalDate();
  }

  /** Parses the version from an If-Match header, or refuses with 428 / 400. */
  static int parseIfMatch(String ifMatch) {
    if (ifMatch == null || ifMatch.isBlank()) {
      throw new AssignmentProblemException(AssignmentProblemException.Kind.IF_MATCH_REQUIRED);
    }
    String value = ifMatch.trim();
    if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
      value = value.substring(1, value.length() - 1);
    }
    try {
      int version = Integer.parseInt(value);
      if (version < 0) {
        throw new NumberFormatException("version must not be negative");
      }
      return version;
    } catch (NumberFormatException notAVersion) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "If-Match must be the shift's version, for example \"3\"");
    }
  }

  private List<String> warnCodes(RuleCheckService.OutcomeView outcome) {
    return outcome.ruleResults().stream()
        .filter(result -> "WARN".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  /**
   * A new assignment or move may only name an active template. A retired template (L16 since V13)
   * still renders on old rows, but it cannot be selected for new work.
   */
  private Map<String, Object> activeTemplate(String code) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, duration_minutes FROM shift_template WHERE code = ? AND active", code);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "That shift type is retired; choose another shift type.");
    }
    return rows.get(0);
  }

  private String unitCode(UUID unitId) {
    return jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, unitId);
  }

  private List<String> blockingCodes(RuleCheckService.OutcomeView outcome) {
    return outcome.ruleResults().stream()
        .filter(result -> "BLOCK".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  private UUID createOverride(String reason, List<String> ruleCodes, AuthPrincipal principal) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO override (id, reason, rule_codes, rule_set_version_id, created_by)"
            + " VALUES (?, ?, ?, (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'),"
            + " (SELECT id FROM app_user WHERE username = ?))",
        id,
        reason,
        ruleCodes.toArray(new String[0]),
        principal.username());
    audit(principal, "override_rule", id, Map.of("reason", reason, "rules", ruleCodes.toString()));
    return id;
  }

  private Map<String, Object> snapshot(AssignmentRow row, int version) {
    Map<String, Object> before = new LinkedHashMap<>();
    before.put("employeeId", row.employeeId().toString());
    before.put("unitId", row.unitId().toString());
    before.put("unit", row.unitCode());
    before.put("shiftTemplate", row.templateCode());
    before.put("startAt", row.startAt().toString());
    before.put("endAt", row.endAt().toString());
    before.put("workDate", row.workDate().toString());
    before.put("kind", row.kind());
    before.put("source", row.source());
    before.put("status", row.status());
    before.put("version", version);
    return before;
  }

  private Map<String, Object> snapshot(AssignmentRow row) {
    return snapshot(row, row.version());
  }

  private void audit(
      AuthPrincipal principal, String action, UUID entityId, Map<String, Object> after) {
    audit(principal, action, entityId, null, after);
  }

  private void audit(
      AuthPrincipal principal,
      String action,
      UUID entityId,
      Map<String, Object> before,
      Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, before, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, 'shift_assignment', ?,"
            + " ?::jsonb, ?::jsonb)",
        principal.username(),
        action,
        entityId,
        before == null ? null : mapper.writeValueAsString(before),
        mapper.writeValueAsString(after));
  }
}
