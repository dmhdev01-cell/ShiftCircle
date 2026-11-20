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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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
    scopeGuard.requireUnit(principal, unitCode(request.change().unitId()));
    return ruleChecks.evaluate(change(request));
  }

  @Transactional
  public UUID assign(RuleCheckRequest request, AuthPrincipal principal) {
    String unitCode = unitCode(request.change().unitId());
    scopeGuard.requireUnit(principal, unitCode);

    RuleCheckService.OutcomeView outcome = ruleChecks.evaluate(change(request));
    boolean blocked = "BLOCK".equals(outcome.outcome());
    boolean warned = "WARN".equals(outcome.outcome());

    UUID overrideId = null;
    if (blocked) {
      if (!outcome.overridable() || request.override() == null
          || request.override().reason() == null
          || request.override().reason().trim().length() < 10) {
        throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
      }
      overrideId = createOverride(request.override().reason(), blockingCodes(outcome), principal);
    } else if (warned) {
      List<String> acknowledged =
          request.acknowledgeWarnings() == null ? List.of() : request.acknowledgeWarnings();
      boolean allAcknowledged =
          outcome.ruleResults().stream()
              .filter(result -> "WARN".equals(result.outcome()))
              .allMatch(result -> acknowledged.contains(result.ruleCode()));
      if (!allAcknowledged) {
        throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
      }
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
