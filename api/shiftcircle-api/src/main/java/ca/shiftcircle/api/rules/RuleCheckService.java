package ca.shiftcircle.api.rules;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.build.ConsecutiveRunFactBuilder;
import ca.shiftcircle.rules.build.DaysOffFactBuilder;
import ca.shiftcircle.rules.build.LongShiftCountFactBuilder;
import ca.shiftcircle.rules.build.RestFactBuilder;
import ca.shiftcircle.rules.build.RollingHoursFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import ca.shiftcircle.rules.build.ShiftLengthFactBuilder;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Runs the rules engine for a proposed change (docs/07 §3).
 *
 * <p>The proposal is turned into a {@link ShiftFact} and added to the officer's real shifts around it,
 * then the same fact builders the boundary tests use produce the results. Nothing is saved here.
 */
@Service
public class RuleCheckService {

  public record Change(
      String type, UUID employeeId, UUID unitId, String shiftTemplate, Instant startAt) {}

  public record EvidenceView(String label) {}

  public record ResultView(
      String ruleCode,
      String ruleTable,
      String outcome,
      String message,
      java.util.Map<String, Object> facts,
      java.util.List<EvidenceView> evidence,
      String overridePolicy) {}

  public record OutcomeView(
      String outcome, int ruleSetVersion, boolean overridable, List<ResultView> ruleResults) {}

  private final JdbcTemplate jdbc;
  private final PublishedRuleSet published;
  private final RuleEvaluator evaluator = new RuleEvaluator();

  public RuleCheckService(JdbcTemplate jdbc, PublishedRuleSet published) {
    this.jdbc = jdbc;
    this.published = published;
  }

  public OutcomeView evaluate(Change change) {
    return evaluate(change, published.snapshot(), null);
  }

  /**
   * Evaluate a move: the assignment's own current row is left out of the officer's existing shifts,
   * so a shift cannot conflict with the slot it is replacing.
   */
  public OutcomeView evaluate(Change change, UUID excludeAssignmentId) {
    return evaluate(change, published.snapshot(), excludeAssignmentId);
  }

  /**
   * The same evaluation against one already-read snapshot.
   *
   * <p>The caller reads the snapshot once so the label it reports and the base it evaluates came
   * from the same publish; ranking 100 officers or checking a label must not straddle a hot swap.
   */
  public OutcomeView evaluate(Change change, PublishedRuleSet.Snapshot live) {
    return evaluate(change, live, null);
  }

  public OutcomeView evaluate(
      Change change, PublishedRuleSet.Snapshot live, UUID excludeAssignmentId) {
    List<ShiftFact> shifts =
        new ArrayList<>(existingShifts(change.employeeId(), change.startAt(), excludeAssignmentId));
    shifts.add(factFor(change));
    return evaluateFacts(shifts, live);
  }

  /**
   * The planner seam (ADR-026): the same evaluation, against shifts the caller holds in memory — the
   * draft's own assignments plus the committed history before the window — instead of reading
   * shift_assignment. The proposal still goes through every fact builder and the published rule
   * base, so the generator cannot propose anything the planning board would refuse.
   */
  public OutcomeView evaluate(Change change, List<ShiftFact> employeeShifts) {
    List<ShiftFact> shifts = new ArrayList<>(employeeShifts);
    shifts.add(factFor(change));
    return evaluateFacts(shifts, published.snapshot());
  }

  /** The same seam when the caller already holds the proposed fact (the planner builds thousands). */
  public OutcomeView evaluate(ShiftFact proposed, List<ShiftFact> employeeShifts) {
    List<ShiftFact> shifts = new ArrayList<>(employeeShifts);
    shifts.add(proposed);
    return evaluateFacts(shifts, published.snapshot());
  }

  private ShiftFact factFor(Change change) {
    Map<String, Object> employee =
        jdbc.queryForMap(
            "SELECT e.employee_no, u.code AS unit_code, u.allows_12h, u.allows_16h"
                + " FROM employee e JOIN unit u ON u.id = ? WHERE e.id = ?",
            change.unitId(),
            change.employeeId());
    Map<String, Object> template =
        jdbc.queryForMap(
            "SELECT duration_minutes FROM shift_template WHERE code = ?", change.shiftTemplate());

    int minutes = ((Number) template.get("duration_minutes")).intValue();
    return new ShiftFact(
        "proposed",
        (String) employee.get("employee_no"),
        (String) employee.get("unit_code"),
        change.shiftTemplate(),
        change.startAt(),
        change.startAt().plus(Duration.ofMinutes(minutes)),
        "EXTRA".equals(change.type()) ? ShiftKind.EXTRA : ShiftKind.ROSTERED,
        0,
        (Boolean) employee.get("allows_12h"),
        (Boolean) employee.get("allows_16h"));
  }

  private OutcomeView evaluateFacts(List<ShiftFact> shifts, PublishedRuleSet.Snapshot live) {
    List<Object> facts = new ArrayList<>();
    facts.addAll(new RestFactBuilder().build(shifts));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 24));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    facts.addAll(new ConsecutiveRunFactBuilder().build(shifts));
    facts.addAll(new LongShiftCountFactBuilder().build(shifts));
    facts.addAll(new DaysOffFactBuilder().build(shifts));
    facts.addAll(new ShiftLengthFactBuilder().build(shifts));

    List<RuleResult> results =
        evaluator.evaluate(live.kieBase(), String.valueOf(live.version()), facts.toArray());
    return summarise(results, live.version());
  }

  /** The live rule set's version, so a published v2 is reported without a code change (step 11). */
  public int publishedVersion() {
    return published.version();
  }

  private List<ShiftFact> existingShifts(
      UUID employeeId, Instant around, UUID excludeAssignmentId) {
    List<ShiftFact> shifts = new ArrayList<>();
    String sql =
        "SELECT s.id, e.employee_no, u.code AS unit_code, u.allows_12h, u.allows_16h,"
            + " t.code AS template_code, s.start_at, s.end_at, s.kind"
            + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
            + " JOIN unit u ON u.id = s.unit_id JOIN shift_template t ON t.id = s.shift_template_id"
            + " WHERE s.employee_id = ? AND s.status <> 'CANCELLED'"
            + " AND s.start_at BETWEEN ? AND ?"
            + (excludeAssignmentId == null ? "" : " AND s.id <> ?");
    Object[] args =
        excludeAssignmentId == null
            ? new Object[] {
              employeeId,
              Timestamp.from(around.minus(Duration.ofDays(28))),
              Timestamp.from(around.plus(Duration.ofDays(14)))
            }
            : new Object[] {
              employeeId,
              Timestamp.from(around.minus(Duration.ofDays(28))),
              Timestamp.from(around.plus(Duration.ofDays(14))),
              excludeAssignmentId
            };
    jdbc.query(
        sql,
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                shifts.add(
                    new ShiftFact(
                        resultSet.getObject("id").toString(),
                        resultSet.getString("employee_no"),
                        resultSet.getString("unit_code"),
                        resultSet.getString("template_code"),
                        resultSet.getTimestamp("start_at").toInstant(),
                        resultSet.getTimestamp("end_at").toInstant(),
                        "EXTRA".equals(resultSet.getString("kind"))
                            ? ShiftKind.EXTRA
                            : ShiftKind.ROSTERED,
                        0,
                        resultSet.getBoolean("allows_12h"),
                        resultSet.getBoolean("allows_16h"))),
        args);
    return shifts;
  }

  private OutcomeView summarise(List<RuleResult> results, int ruleSetVersion) {
    boolean blocked = results.stream().anyMatch(r -> r.outcome() == RuleOutcome.BLOCK);
    boolean warned = results.stream().anyMatch(r -> r.outcome() == RuleOutcome.WARN);
    String outcome = blocked ? "BLOCK" : warned ? "WARN" : "PASS";

    boolean overridable =
        results.stream()
            .filter(r -> r.outcome() == RuleOutcome.BLOCK)
            .allMatch(r -> r.overridePolicy() == ca.shiftcircle.rules.model.OverridePolicy.EMERGENCY);

    List<ResultView> views =
        results.stream()
            .map(
                r ->
                    new ResultView(
                        r.ruleId(),
                        r.ruleTable(),
                        r.outcome().name(),
                        r.message(),
                        java.util.Map.of(
                            "required", r.required(), "actual", r.actual(), "unit", r.unit()),
                        java.util.List.of(new EvidenceView(r.evidence())),
                        r.overridePolicy().name()))
            .toList();
    return new OutcomeView(outcome, ruleSetVersion, overridable, views);
  }
}
