package ca.shiftcircle.api.rules;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.build.ConsecutiveRunFactBuilder;
import ca.shiftcircle.rules.build.DaysOffFactBuilder;
import ca.shiftcircle.rules.build.LongShiftCountFactBuilder;
import ca.shiftcircle.rules.build.PostEligibilityFactBuilder;
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
import java.util.HashMap;
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

  /**
   * Who is on a proposed shift and what kind of post it is (R-01, R-02, release v1.3).
   *
   * @param position the person's position code, {@code CO} or {@code CS}
   * @param qualifications the qualification codes the person holds on the shift's date
   * @param unitKind the unit's kind; {@code SUPERVISION} is a supervisor post
   */
  public record Post(String position, java.util.Set<String> qualifications, String unitKind) {}

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
    ShiftFact proposed = factFor(change);
    shifts.add(proposed);
    return evaluateFacts(
        shifts, live, proposed, post(change.employeeId(), change.unitId(), change.startAt()));
  }

  /**
   * The planner seam (ADR-026): the same evaluation, against shifts the caller holds in memory — the
   * draft's own assignments plus the committed history before the window — instead of reading
   * shift_assignment. The proposal still goes through every fact builder and the published rule
   * base, so the generator cannot propose anything the planning board would refuse.
   */
  public OutcomeView evaluate(Change change, List<ShiftFact> employeeShifts) {
    List<ShiftFact> shifts = new ArrayList<>(employeeShifts);
    ShiftFact proposed = factFor(change);
    shifts.add(proposed);
    return evaluateFacts(
        shifts,
        published.snapshot(),
        proposed,
        post(change.employeeId(), change.unitId(), change.startAt()));
  }

  /** The same seam when the caller already holds the proposed fact (the planner builds thousands). */
  /**
   * The seam without a post: R-01 and R-02 are left out. Only for a caller that replays warnings
   * already known to come from the other rules (tests that compare with the planner's scorecard);
   * once the datasets have supervisors (release v1.3 S4) such a replay will not see R-02 warnings,
   * so a caller that checks a real proposal must pass the post.
   */
  public OutcomeView evaluate(ShiftFact proposed, List<ShiftFact> employeeShifts) {
    return evaluate(proposed, employeeShifts, null);
  }

  /**
   * The same seam with the post the proposal is on, so R-01/R-02 run in the planner as on the
   * board. A null post leaves those two rules out (the caller does not know the post).
   */
  public OutcomeView evaluate(ShiftFact proposed, List<ShiftFact> employeeShifts, Post post) {
    List<ShiftFact> shifts = new ArrayList<>(employeeShifts);
    shifts.add(proposed);
    return evaluateFacts(shifts, published.snapshot(), proposed, post);
  }

  /**
   * The post a person would work: their position, the qualifications they hold on that date (in
   * the centre's time zone) and the unit's kind. One read per check, beside the shift facts.
   */
  public Post post(UUID employeeId, UUID unitId, Instant at) {
    java.time.LocalDate day = at.atZone(java.time.ZoneId.of("America/Regina")).toLocalDate();
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT e.classification, u.kind FROM employee e JOIN unit u ON u.id = ?"
                + " WHERE e.id = ?",
            unitId,
            employeeId);
    java.util.Set<String> qualifications =
        new java.util.HashSet<>(
            jdbc.queryForList(
                "SELECT q.code FROM employee_qualification eq"
                    + " JOIN qualification q ON q.id = eq.qualification_id"
                    + " WHERE eq.employee_id = ? AND eq.valid_from <= ?"
                    + " AND (eq.valid_to IS NULL OR eq.valid_to >= ?)",
                String.class,
                employeeId,
                java.sql.Date.valueOf(day),
                java.sql.Date.valueOf(day)));
    return new Post((String) row.get("classification"), qualifications, (String) row.get("kind"));
  }

  /** Evaluate facts the caller already built; used to baseline existing warnings per officer. */
  public OutcomeView evaluateFacts(List<ShiftFact> shifts) {
    return evaluateFacts(shifts, published.snapshot());
  }

  /**
   * Every person's position and qualifications and every unit's kind, read once, for a caller that
   * checks thousands of proposals (the planner). {@link PostLookup#post} answers the same as
   * {@link #post(UUID, UUID, Instant)} without a query per proposal.
   */
  public PostLookup posts() {
    return readPosts(jdbc);
  }

  /** The same read for a caller that has only the database (the rule-set dry run). */
  public static PostLookup readPosts(JdbcTemplate jdbc) {
    Map<UUID, String> positions = new HashMap<>();
    jdbc.query(
        "SELECT id, classification FROM employee",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> positions.put(rs.getObject("id", UUID.class), rs.getString("classification")));
    Map<UUID, String> kinds = new HashMap<>();
    jdbc.query(
        "SELECT id, kind FROM unit",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> kinds.put(rs.getObject("id", UUID.class), rs.getString("kind")));
    Map<UUID, List<PostLookup.Held>> held = new HashMap<>();
    jdbc.query(
        "SELECT eq.employee_id, q.code, eq.valid_from, eq.valid_to FROM employee_qualification eq"
            + " JOIN qualification q ON q.id = eq.qualification_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                held.computeIfAbsent(rs.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                    .add(
                        new PostLookup.Held(
                            rs.getString("code"),
                            rs.getDate("valid_from").toLocalDate(),
                            rs.getDate("valid_to") == null
                                ? null
                                : rs.getDate("valid_to").toLocalDate())));
    return new PostLookup(positions, kinds, held);
  }

  /** The posts read once; see {@link #posts()}. */
  public static final class PostLookup {

    record Held(String code, java.time.LocalDate from, java.time.LocalDate to) {}

    /** A post that cannot be resolved: R-01 blocks it. */
    static final Post UNKNOWN = new Post("", java.util.Set.of(), "SUPERVISION");

    private final Map<UUID, String> positions;
    private final Map<UUID, String> kinds;
    private final Map<UUID, List<Held>> held;

    PostLookup(Map<UUID, String> positions, Map<UUID, String> kinds, Map<UUID, List<Held>> held) {
      this.positions = positions;
      this.kinds = kinds;
      this.held = held;
    }

    /**
     * The post for one proposal. It fails closed: when the person or the unit is not in the
     * snapshot, the post reads as a supervisor post worked by someone of no known position, so
     * R-01 blocks it (no acting qualification, no override) instead of the post rules being left
     * out (security review L2).
     */
    public Post post(UUID employeeId, UUID unitId, Instant at) {
      String position = positions.get(employeeId);
      String kind = kinds.get(unitId);
      if (position == null || kind == null) {
        return UNKNOWN;
      }
      java.time.LocalDate day = at.atZone(java.time.ZoneId.of("America/Regina")).toLocalDate();
      java.util.Set<String> codes = new java.util.HashSet<>();
      for (Held qualification : held.getOrDefault(employeeId, List.of())) {
        if (!qualification.from().isAfter(day)
            && (qualification.to() == null || !qualification.to().isBefore(day))) {
          codes.add(qualification.code());
        }
      }
      return new Post(position, codes, kind);
    }
  }

  /**
   * The same evaluation with extra shifts the caller holds in memory added to the officer's real
   * ones: the other drafts of a multi-item proposal, so rest, hours and runs between them show up
   * (v1.3 proposals). The extras are facts only; nothing is read for them and nothing is saved.
   *
   * <p><b>Contract:</b> an extra stands for a shift that is NOT in {@code shift_assignment} yet.
   * A decision that inserts each accepted item before checking the next must not also pass that
   * item as an extra, or the shift would be counted twice (U-05, U-14 hours). As a guard, an extra
   * that matches a stored shift (same unit, template, start and end) is dropped, so the mistake
   * cannot produce a false Block. Either evaluate every item before inserting any, or pass
   * only what is still unsaved.
   */
  public OutcomeView evaluateWithExtras(
      Change change, List<ShiftFact> extraShifts, PublishedRuleSet.Snapshot live) {
    List<ShiftFact> shifts = new ArrayList<>(existingShifts(change.employeeId(), change.startAt(), null));
    for (ShiftFact extra : extraShifts) {
      boolean alreadyStored =
          shifts.stream()
              .anyMatch(
                  stored ->
                      stored.unitCode().equals(extra.unitCode())
                          && stored.templateCode().equals(extra.templateCode())
                          && stored.start().equals(extra.start())
                          && stored.end().equals(extra.end()));
      if (!alreadyStored) {
        shifts.add(extra);
      }
    }
    ShiftFact proposed = factFor(change);
    shifts.add(proposed);
    // Who can work a post (R-01, R-02) applies to a proposal as to any board change.
    return evaluateFacts(
        shifts, live, proposed, post(change.employeeId(), change.unitId(), change.startAt()));
  }

  /** The fact for a change, under a caller-chosen id (a draft shift that is not saved). */
  public ShiftFact factOf(Change change, String factId) {
    ShiftFact proposed = factFor(change);
    return new ShiftFact(
        factId,
        proposed.employeeId(),
        proposed.unitCode(),
        proposed.templateCode(),
        proposed.start(),
        proposed.end(),
        proposed.kind(),
        proposed.extensionMinutes(),
        proposed.unitAllows12h(),
        proposed.unitAllows16h());
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
    return evaluateFacts(shifts, live, null, null);
  }

  private OutcomeView evaluateFacts(
      List<ShiftFact> shifts, PublishedRuleSet.Snapshot live, ShiftFact proposed, Post post) {
    List<Object> facts = new ArrayList<>();
    facts.addAll(new RestFactBuilder().build(shifts));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 24));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    facts.addAll(new ConsecutiveRunFactBuilder().build(shifts));
    facts.addAll(new LongShiftCountFactBuilder().build(shifts));
    facts.addAll(new DaysOffFactBuilder().build(shifts));
    facts.addAll(new ShiftLengthFactBuilder().build(shifts));
    if (proposed != null && post != null) {
      facts.add(
          new PostEligibilityFactBuilder()
              .build(proposed, post.position(), post.qualifications(), post.unitKind()));
    }

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
    // The rules see the ENVELOPE of the roster and the recorded actual: the earliest start and
    // the latest end. An actual can therefore lengthen a shift (the 4 h extension, U-04/U-05 and
    // the weekly windows still see it) but can never shorten it and relax a Block (P3-2).
    String sql =
        "SELECT s.id AS assignment_id, s.employee_id, e.employee_no, u.code AS unit_code,"
            + " u.allows_12h, u.allows_16h, t.code AS template_code, t.duration_minutes,"
            + " LEAST(s.start_at, te.start_at) AS start_at,"
            + " GREATEST(s.end_at, te.end_at) AS end_at, s.kind"
            + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
            + " JOIN unit u ON u.id = s.unit_id JOIN shift_template t ON t.id = s.shift_template_id"
            + " LEFT JOIN LATERAL (SELECT start_at, end_at FROM time_entry"
            + "   WHERE shift_assignment_id = s.id AND entry_type = 'ACTUAL'"
            + "   AND absence_type IS NULL ORDER BY created_at DESC LIMIT 1) te ON true"
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
                shifts.add(fact(resultSet, resultSet.getObject("assignment_id").toString())),
        args);
    return shifts;
  }

  /**
   * The committed history for the planner. The same row mapping and the same envelope as the board
   * path, so an actual can lengthen the history the planner sees but cannot shorten it (P3-2).
   */
  public Map<UUID, List<ShiftFact>> history(Instant from, Instant to) {
    Map<UUID, List<ShiftFact>> history = new HashMap<>();
    jdbc.query(
        "SELECT s.id AS assignment_id, s.employee_id, e.employee_no, u.code AS unit_code,"
            + " u.allows_12h, u.allows_16h, t.code AS template_code, t.duration_minutes,"
            + " LEAST(s.start_at, te.start_at) AS start_at,"
            + " GREATEST(s.end_at, te.end_at) AS end_at, s.kind"
            + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
            + " JOIN unit u ON u.id = s.unit_id JOIN shift_template t ON t.id = s.shift_template_id"
            + " LEFT JOIN LATERAL (SELECT start_at, end_at FROM time_entry"
            + "   WHERE shift_assignment_id = s.id AND entry_type = 'ACTUAL'"
            + "   AND absence_type IS NULL ORDER BY created_at DESC LIMIT 1) te ON true"
            + " WHERE s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                history
                    .computeIfAbsent(
                        resultSet.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                    .add(fact(resultSet, resultSet.getObject("employee_id").toString())),
        Timestamp.from(to),
        Timestamp.from(from));
    return history;
  }

  private static ShiftFact fact(java.sql.ResultSet resultSet, String factId)
      throws java.sql.SQLException {
    Instant start = resultSet.getTimestamp("start_at").toInstant();
    Instant end = resultSet.getTimestamp("end_at").toInstant();
    return new ShiftFact(
        factId,
        resultSet.getString("employee_no"),
        resultSet.getString("unit_code"),
        resultSet.getString("template_code"),
        start,
        end,
        "EXTRA".equals(resultSet.getString("kind")) ? ShiftKind.EXTRA : ShiftKind.ROSTERED,
        extensionMinutes(start, end, resultSet.getInt("duration_minutes")),
        resultSet.getBoolean("allows_12h"),
        resultSet.getBoolean("allows_16h"));
  }

  /** Minutes a shift runs beyond its template, when an actual end makes it longer. */
  private static int extensionMinutes(Instant start, Instant end, int templateMinutes) {
    long minutes = Duration.between(start, end).toMinutes();
    return (int) Math.max(0, minutes - templateMinutes);
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
