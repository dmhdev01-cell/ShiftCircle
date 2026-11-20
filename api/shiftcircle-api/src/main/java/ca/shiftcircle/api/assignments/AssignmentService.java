package ca.shiftcircle.api.assignments;

import ca.shiftcircle.api.rules.RuleCheckRequest;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.rules.RuleViolationException;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import java.time.Instant;
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
 * Saves a shift assignment after the rules have spoken (docs/07 §3).
 *
 * <p>Warn results need an explicit acknowledgement; Block results need an emergency override with a
 * reason of at least ten characters. Every save writes the override row and an audit event with the
 * actor and time (S-04, ADR-019: extra shifts are a supervisor action, never auto-approved).
 */
@Service
public class AssignmentService {

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final ScopeGuard scopeGuard;
  private final ObjectMapper mapper = new ObjectMapper();

  public AssignmentService(JdbcTemplate jdbc, RuleCheckService ruleChecks, ScopeGuard scopeGuard) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
    this.scopeGuard = scopeGuard;
  }

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
    return ruleChecks.evaluate(change(request));
  }

  @Transactional
  public UUID assign(RuleCheckRequest request, AuthPrincipal principal) {
    requireValidChange(request);
    String unitCode = unitCode(request.change().unitId());
    scopeGuard.requireUnit(principal, unitCode);

    // Two supervisors (or a double click) must not both pass the rules against the same old roster:
    // the exclusion constraint catches true overlaps, but two saves close together can break rest
    // rules without overlapping. Serialising on the officer closes that window (review-r2 S2).
    lockOfficer(request.change().employeeId());

    RuleCheckService.OutcomeView outcome = ruleChecks.evaluate(change(request));
    boolean blocked = "BLOCK".equals(outcome.outcome());
    List<String> warnCodes = warnCodes(outcome);
    List<String> acknowledged =
        request.acknowledgeWarnings() == null ? List.of() : request.acknowledgeWarnings();
    boolean allWarningsAcknowledged = acknowledged.containsAll(warnCodes);

    UUID overrideId = null;
    if (blocked) {
      if (!outcome.overridable() || request.override() == null
          || request.override().reason() == null
          || request.override().reason().trim().length() < 10) {
        throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
      }
      // An override excuses the blocks, never the warnings: nothing auto-approves (docs/07 §3).
      if (!allWarningsAcknowledged) {
        throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
      }
      overrideId = createOverride(request.override().reason(), blockingCodes(outcome), principal);
    } else if (!warnCodes.isEmpty() && !allWarningsAcknowledged) {
      throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
    }

    Map<String, Object> template =
        jdbc.queryForMap(
            "SELECT id, duration_minutes FROM shift_template WHERE code = ?",
            request.change().shiftTemplate());
    UUID assignmentId = UUID.randomUUID();
    Instant end = request.change().startAt().plusSeconds(((Number) template.get("duration_minutes")).longValue() * 60);

    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source, override_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)",
        assignmentId,
        request.change().employeeId(),
        request.change().unitId(),
        template.get("id"),
        java.sql.Timestamp.from(request.change().startAt()),
        java.sql.Timestamp.from(end),
        request.change().startAt().atZone(java.time.ZoneId.of("America/Regina")).toLocalDate(),
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
    return assignmentId;
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
  }

  private void lockOfficer(UUID employeeId) {
    long key = employeeId.getMostSignificantBits() ^ employeeId.getLeastSignificantBits();
    jdbc.queryForList("SELECT pg_advisory_xact_lock(?)", Object.class, key);
  }

  private List<String> warnCodes(RuleCheckService.OutcomeView outcome) {
    return outcome.ruleResults().stream()
        .filter(result -> "WARN".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
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

  private void audit(AuthPrincipal principal, String action, UUID entityId, Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, 'shift_assignment', ?,"
            + " ?::jsonb)",
        principal.username(),
        action,
        entityId,
        mapper.writeValueAsString(after));
  }
}
