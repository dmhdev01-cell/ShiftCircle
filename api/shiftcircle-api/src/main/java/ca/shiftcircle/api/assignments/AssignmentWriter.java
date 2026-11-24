package ca.shiftcircle.api.assignments;

import ca.shiftcircle.api.rules.RuleCheckRequest;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.rules.RuleViolationException;
import ca.shiftcircle.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * The one write path for a new shift assignment: the rule decision (Warn needs an acknowledgement,
 * Block needs an emergency override where one is allowed), the insert and the {@code assign_shift}
 * audit row. The planning board, the overtime confirm and the shift-proposal decision all create
 * shifts through here, so they cannot drift apart on what a rule result allows (v1.3 P2, plan
 * .factory/plans/v1.2-proposals.md §2).
 *
 * <p>The caller owns everything around the write: unit scope, the locked pay period and the
 * per-officer advisory lock, all of which must be taken before {@link #create} is called. This
 * class reads and writes inside the caller's transaction.
 */
@Component
public class AssignmentWriter {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final ObjectMapper mapper = new ObjectMapper();

  public AssignmentWriter(JdbcTemplate jdbc, RuleCheckService ruleChecks) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
  }

  /**
   * One new shift.
   *
   * @param change the shift; its type decides the kind (EXTRA, or ROSTERED for ASSIGN)
   * @param acknowledgeWarnings the Warn codes the person acknowledged
   * @param override the emergency override, or null
   * @param allowOverride false refuses every Block, with or without an override (proposals)
   * @param source the {@code shift_assignment.source}: MANUAL, OVERTIME_OFFER or PROPOSAL
   * @param auditExtras extra keys for the {@code assign_shift} audit row (for example the
   *     proposal id), or an empty map
   */
  public record NewShift(
      RuleCheckService.Change change,
      List<String> acknowledgeWarnings,
      RuleCheckRequest.Override override,
      boolean allowOverride,
      String source,
      Map<String, Object> auditExtras) {}

  public record Written(UUID assignmentId, RuleCheckService.OutcomeView outcome, UUID overrideId) {}

  /** Evaluate the rules now, decide, insert and audit. Throws {@link RuleViolationException}. */
  public Written create(NewShift shift, AuthPrincipal principal) {
    RuleCheckService.Change change = shift.change();
    Map<String, Object> template = activeTemplate(change.shiftTemplate());
    String unitCode =
        jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, change.unitId());

    RuleCheckService.OutcomeView outcome = ruleChecks.evaluate(change);
    UUID overrideId =
        decide(
            outcome,
            shift.acknowledgeWarnings(),
            shift.override(),
            shift.allowOverride(),
            principal);

    UUID assignmentId = UUID.randomUUID();
    Instant end =
        change
            .startAt()
            .plusSeconds(((Number) template.get("duration_minutes")).longValue() * 60);
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source, override_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        assignmentId,
        change.employeeId(),
        change.unitId(),
        template.get("id"),
        java.sql.Timestamp.from(change.startAt()),
        java.sql.Timestamp.from(end),
        change.startAt().atZone(REGINA).toLocalDate(),
        "EXTRA".equals(change.type()) ? "EXTRA" : "ROSTERED",
        shift.source(),
        overrideId);

    Map<String, Object> after = new LinkedHashMap<>();
    after.put("employeeId", change.employeeId().toString());
    after.put("unit", unitCode);
    after.put("template", change.shiftTemplate());
    after.put("startAt", change.startAt().toString());
    after.put("kind", change.type());
    after.put("outcome", outcome.outcome());
    after.put("overrideId", overrideId == null ? "" : overrideId.toString());
    if (shift.auditExtras() != null) {
      after.putAll(shift.auditExtras());
    }
    audit(principal, "assign_shift", assignmentId, after);
    return new Written(assignmentId, outcome, overrideId);
  }

  /**
   * The shared rule contract: Block needs an overridable result and a reason of ten characters,
   * and an override excuses blocks, never warnings. Nothing auto-approves (docs/07 §3). With
   * {@code allowOverride} false a Block is always refused.
   *
   * @return the override row's id when one was created, else null
   */
  public UUID decide(
      RuleCheckService.OutcomeView outcome,
      List<String> acknowledgeWarnings,
      RuleCheckRequest.Override override,
      boolean allowOverride,
      AuthPrincipal principal) {
    boolean blocked = "BLOCK".equals(outcome.outcome());
    List<String> warnCodes = codes(outcome, "WARN");
    List<String> acknowledged = acknowledgeWarnings == null ? List.of() : acknowledgeWarnings;
    boolean allWarningsAcknowledged = acknowledged.containsAll(warnCodes);

    if (blocked) {
      if (!allowOverride
          || !outcome.overridable()
          || override == null
          || override.reason() == null
          || override.reason().trim().length() < 10) {
        throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
      }
      if (!allWarningsAcknowledged) {
        throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
      }
      return createOverride(override.reason(), codes(outcome, "BLOCK"), principal);
    }
    if (!warnCodes.isEmpty() && !allWarningsAcknowledged) {
      throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
    }
    return null;
  }

  /**
   * A new assignment may only name an active template. A retired template (L16 since V13) still
   * renders on old rows, but it cannot be selected for new work.
   */
  public Map<String, Object> activeTemplate(String code) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, duration_minutes FROM shift_template WHERE code = ? AND active", code);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "That shift type is retired; choose another shift type.");
    }
    return rows.get(0);
  }

  private static List<String> codes(RuleCheckService.OutcomeView outcome, String level) {
    return outcome.ruleResults().stream()
        .filter(result -> level.equals(result.outcome()))
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

  private void audit(
      AuthPrincipal principal, String action, UUID entityId, Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, before, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, 'shift_assignment', ?,"
            + " ?::jsonb, ?::jsonb)",
        principal.username(),
        action,
        entityId,
        null,
        mapper.writeValueAsString(after));
  }
}
