package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.schedule.ScheduleQuery;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.domain.Position;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.sql.Array;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * The quarter planner (ADR-026): drafts over the next quarter, a deterministic generator, a
 * rule-checked commit, and the preference model. The draft never touches shift_assignment until
 * commit writes every row in one transaction and one audited event.
 */
@Service
public class PlannerService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final LocalDate FROM = PlanGenerator.FROM;
  private static final LocalDate TO = PlanGenerator.TO;
  private static final List<String> PATTERNS =
      List.of("ROTATING_5_2", "5_ON_2_OFF", "7_ON_3_OFF");
  private static final List<String> WEEKDAYS =
      List.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");
  private static final Set<String> TIMES = Set.of("DAY", "EVENING", "NIGHT", "NONE");
  private static final long DEFAULT_SEED = 20261001L;

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleCheck;
  private final ScheduleQuery scheduleQuery;
  private final ca.shiftcircle.api.units.ActiveUnits activeUnits;
  private final ca.shiftcircle.api.units.UnitsService unitsService;
  private final ca.shiftcircle.api.config.PublishedRuleSet publishedRuleSet;
  private final ObjectMapper mapper = new ObjectMapper();

  public PlannerService(
      JdbcTemplate jdbc,
      RuleCheckService ruleCheck,
      ScheduleQuery scheduleQuery,
      ca.shiftcircle.api.units.ActiveUnits activeUnits,
      ca.shiftcircle.api.units.UnitsService unitsService,
      ca.shiftcircle.api.config.PublishedRuleSet publishedRuleSet) {
    this.jdbc = jdbc;
    this.ruleCheck = ruleCheck;
    this.scheduleQuery = scheduleQuery;
    this.activeUnits = activeUnits;
    this.unitsService = unitsService;
    this.publishedRuleSet = publishedRuleSet;
  }

  public record CommitAttempt(int status, Object body) {}

  // ---------------------------------------------------------------------------------------------
  // State and drafts
  // ---------------------------------------------------------------------------------------------

  public PlannerViews.PlanState state() {
    Map<String, Object> open =
        jdbc.queryForList(
                "SELECT d.*, u.display_name AS created_by_name FROM plan_draft d"
                    + " LEFT JOIN app_user u ON u.id = d.created_by"
                    + " WHERE d.status = 'DRAFT' ORDER BY d.created_at DESC LIMIT 1")
            .stream()
            .findFirst()
            .orElse(null);
    Map<String, Object> committed =
        jdbc.queryForList(
                "SELECT d.*, cu.display_name AS created_by_name,"
                    + " u.display_name AS committed_by_name FROM plan_draft d"
                    + " LEFT JOIN app_user cu ON cu.id = d.created_by"
                    + " LEFT JOIN app_user u ON u.id = d.committed_by"
                    + " WHERE d.status = 'COMMITTED' ORDER BY d.committed_at DESC LIMIT 1")
            .stream()
            .findFirst()
            .orElse(null);
    return new PlannerViews.PlanState(
        new PlannerViews.Window(FROM, TO, PlanGenerator.PERIODS),
        DEFAULT_SEED,
        PATTERNS,
        open != null ? "DRAFT" : committed != null ? "COMMITTED" : "NONE",
        open == null ? null : draftSummary(open),
        committed == null ? null : lastCommitted(committed),
        committed == null ? null : draftSummary(committed));
  }

  @Transactional
  public PlannerViews.DraftSummary generate(
      PlannerViews.DraftCreation creation, AuthPrincipal principal) {
    long seed = creation.seed() == 0 ? DEFAULT_SEED : creation.seed();
    // No parameter means every 8 h officer uses their own pattern. The old facility-wide
    // pattern is still accepted for one release and overrides all 8 h officers when sent.
    String pattern = creation.pattern8h();
    if (pattern != null && !PATTERNS.contains(pattern)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "pattern8h must be ROTATING_5_2, 5_ON_2_OFF or 7_ON_3_OFF");
    }
    PlannerViews.PlanOptions options = planOptions(creation);
    Map<String, Object> committed =
        jdbc.queryForList(
                "SELECT d.id, d.committed_at, u.display_name FROM plan_draft d"
                    + " LEFT JOIN app_user u ON u.id = d.committed_by"
                    + " WHERE d.status = 'COMMITTED' AND d.from_date <= ? AND d.to_date >= ?"
                    + " ORDER BY d.committed_at DESC LIMIT 1",
                TO,
                FROM)
            .stream()
            .findFirst()
            .orElse(null);
    if (committed != null) {
      String when =
          committed.get("committed_at") == null
              ? "an earlier date"
              : ((Timestamp) committed.get("committed_at")).toInstant().toString().substring(0, 10);
      throw new PlannerConflictException(
          "ALREADY_COMMITTED_WINDOW",
          "This quarter is already committed ("
              + when
              + ", by "
              + committed.get("display_name")
              + "). To start over in the demo use Reset the demo data.");
    }
    jdbc.update("DELETE FROM plan_draft WHERE status = 'DRAFT'");

    List<PlanGenerator.Unit> units = loadUnits();
    List<PlanGenerator.Employee> employees = loadEmployees(units);
    Map<String, PlanGenerator.Template> templates = loadTemplates();
    Map<UUID, List<ShiftFact>> history =
        loadHistory(
            FROM.minusDays(PlanGenerator.HISTORY_DAYS).atStartOfDay(REGINA).toInstant(),
            FROM.atStartOfDay(REGINA).toInstant());
    // Warnings the seeded history already has are not this plan's warnings: subtract them so the
    // scorecard counts what the draft adds, not the same history window repeated per proposal.
    Map<UUID, Set<String>> baselineWarnings = new HashMap<>();
    history.forEach(
        (employeeId, shifts) ->
            baselineWarnings.put(employeeId, warningKeys(ruleCheck.evaluateFacts(shifts))));

    // R-01/R-02 run in the planner as on the board: the post of each proposal, read once.
    RuleCheckService.PostLookup posts = ruleCheck.posts();
    PlanGenerator.Verifier verifier =
        (employee, unit, template, start, current) -> {
          ShiftFact proposed =
              new ShiftFact(
                  "proposed",
                  employee.employeeNo(),
                  unit.code(),
                  template.code(),
                  start,
                  start.plus(Duration.ofMinutes(template.minutes())),
                  ShiftKind.ROSTERED,
                  0,
                  unit.allows12h(),
                  unit.allows16h());
          RuleCheckService.OutcomeView outcome = ruleCheck.evaluate(
                  proposed, current, posts.post(employee.id(), unit.id(), start));
          boolean blocked =
              outcome.ruleResults().stream().anyMatch(result -> "BLOCK".equals(result.outcome()));

          Set<String> baseline =
              baselineWarnings.getOrDefault(employee.id(), Set.of());
          List<PlanGenerator.RuleWarning> warnings =
              outcome.ruleResults().stream()
                  .filter(result -> "WARN".equals(result.outcome()))
                  .filter(result -> !baseline.contains(warningKey(result)))
                  .map(result -> new PlanGenerator.RuleWarning(result.ruleCode(), result.message()))
                  .toList();
          return new PlanGenerator.Check(blocked, warnings);
        };

    long before = System.nanoTime();
    PlanGenerator.Options chosen = generatorOptions(options);
    List<PlanInputs.LeaveDay> leaveDays = loadLeaveDays();
    Map<UUID, java.util.Set<LocalDate>> leave = leaveSets(leaveDays);
    PlanGenerator.Result result =
        new PlanGenerator()
            .generate(
                employees,
                units,
                templates,
                history,
                pattern,
                seed,
                verifier,
                leave,
                activeUnits::active,
                chosen,
                // Only the cross-unit fill reads qualifications; skip the two queries otherwise.
                chosen.crossUnitFill() ? loadQualifications() : PlanGenerator.Qualifications.NONE);
    if (chosen.fillPartTimeToFte() || chosen.crossUnitFill()) {
      // The extra passes each keep their own warning de-duplication, so the same officer and rule
      // can be counted twice and the commit's recount would refuse the draft (WARNINGS_CHANGED).
      // Score the finished draft once, chronologically, exactly as a hand edit and the commit do.
      // The default path is not re-scored, so its plans and pinned figures are untouched.
      // The verifier carries the same history baseline the commit subtracts (same rule check, same
      // 35-day history, same start-then-employee order, same officer|rule de-duplication), so the
      // re-score and the commit's recount agree; PlannerOptionsApiTest commits a draft per option.
      Object crossUnit = result.scorecard().get("crossUnit");
      result =
          new PlanGenerator()
              .assess(
                  employees,
                  units,
                  templates,
                  history,
                  pattern,
                  verifier,
                  leave,
                  activeUnits::active,
                  result.assignments());
      if (crossUnit != null) {
        result.scorecard().put("crossUnit", crossUnit);
      }
      // The Generated in tile shows the whole run, not only the re-score (UI test N1).
      result.scorecard().put("generatedMs", (System.nanoTime() - before) / 1_000_000);
    }
    operationalCards(result.scorecard(), result.assignments());
    int generatedMs = (int) ((System.nanoTime() - before) / 1_000_000);
    // PR-M: what this draft was generated with, from the same lists the generator was given, so
    // the draft still says so after staff change. It sits beside the generator's own cards.
    result.scorecard().put("inputs", inputs(units, employees, leaveDays, seed, pattern, options));

    UUID id = UUID.randomUUID();
    String scorecardJson = mapper.writeValueAsString(result.scorecard());
    String warningsJson = mapper.writeValueAsString(warningMaps(result.warnings()));
    jdbc.update(
        "INSERT INTO plan_draft (id, from_date, to_date, seed, pattern8h, status, version,"
            + " created_by, generated_ms, scorecard, warnings, warning_count,"
            + " staff_types, part_time_fill, cross_unit_fill)"
            + " VALUES (?, ?, ?, ?, ?, 'DRAFT', 0, (SELECT id FROM app_user WHERE username = ?),"
            + " ?, ?::jsonb, ?::jsonb, ?, ?::text[], ?, ?)",
        id,
        FROM,
        TO,
        seed,
        pattern,
        principal.username(),
        generatedMs,
        scorecardJson,
        warningsJson,
        result.warnings().size(),
        "{" + String.join(",", options.staffTypes()) + "}",
        options.partTimeFill(),
        options.crossUnitFill());
    List<Object[]> assignmentRows = new ArrayList<>();
    for (PlanGenerator.Assignment assignment : result.assignments()) {
      assignmentRows.add(
          new Object[] {
            UUID.randomUUID(),
            id,
            assignment.employeeId(),
            assignment.unitId(),
            assignment.templateId(),
            assignment.date(),
            Timestamp.from(assignment.start()),
            Timestamp.from(assignment.end()),
            "ROSTERED",
            0
          });
    }
    jdbc.batchUpdate(
        "INSERT INTO plan_draft_assignment (id, draft_id, employee_id, unit_id,"
            + " shift_template_id, work_date, start_at, end_at, kind, sort_order)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        assignmentRows);

    List<Object[]> gapRows = new ArrayList<>();
    for (PlanGenerator.Gap gap : result.gaps()) {
      gapRows.add(
          new Object[] {
            UUID.randomUUID(), id, gap.unitId(), gap.date(), gap.block(), gap.required(),
            gap.placed(), gap.reason()
          });
    }
    jdbc.batchUpdate(
        "INSERT INTO plan_draft_gap (id, draft_id, unit_id, gap_date, block, required, placed,"
            + " reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        gapRows);

    Map<String, Object> generated = new LinkedHashMap<>();
    generated.put("assignments", result.assignments().size());
    generated.put("gaps", result.gaps().size());
    generated.put("warnings", result.warnings().size());
    generated.put("seed", seed);
    generated.put("pattern8h", pattern == null ? "PER_OFFICER" : pattern);
    generated.put("generatedMs", generatedMs);
    generated.put("staffTypes", options.staffTypes());
    generated.put("partTimeFill", options.partTimeFill());
    generated.put("crossUnitFill", options.crossUnitFill());
    audit(principal, "generate_plan", "plan_draft", id, generated);

    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT d.*, u.display_name AS created_by_name FROM plan_draft d"
                + " LEFT JOIN app_user u ON u.id = d.created_by WHERE d.id = ?",
            id);
    return draftSummary(row);
  }

  private static final List<String> STAFF_TYPES = List.of("FULL_TIME", "PART_TIME");
  private static final List<String> PART_TIME_FILLS = List.of("AFTER_FULL_TIME", "UP_TO_FTE");
  private static final List<String> ON_OFF = List.of("OFF", "ON");

  /**
   * The tailoring options, validated (PR-N). Omitted values take the defaults; anything else that
   * is not one of the documented values is a 400 problem detail naming the field.
   */
  static PlannerViews.PlanOptions planOptions(PlannerViews.DraftCreation creation) {
    PlannerViews.PlanOptions defaults = PlannerViews.PlanOptions.DEFAULT;
    List<String> staffTypes = defaults.staffTypes();
    if (creation.staffTypes() != null) {
      Set<String> chosen = new HashSet<>();
      for (String value : creation.staffTypes()) {
        if (value == null || !STAFF_TYPES.contains(value)) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "staffTypes may contain only FULL_TIME and PART_TIME");
        }
        chosen.add(value);
      }
      if (!chosen.contains("FULL_TIME")) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "staffTypes must include FULL_TIME: the full-time crews are the plan");
      }
      staffTypes = STAFF_TYPES.stream().filter(chosen::contains).toList();
    }
    String partTimeFill =
        creation.partTimeFill() == null ? defaults.partTimeFill() : creation.partTimeFill();
    if (!PART_TIME_FILLS.contains(partTimeFill)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "partTimeFill must be AFTER_FULL_TIME or UP_TO_FTE");
    }
    if ("UP_TO_FTE".equals(partTimeFill) && !staffTypes.contains("PART_TIME")) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "partTimeFill UP_TO_FTE needs PART_TIME in staffTypes: there is no one to fill");
    }
    String crossUnitFill =
        creation.crossUnitFill() == null ? defaults.crossUnitFill() : creation.crossUnitFill();
    if (!ON_OFF.contains(crossUnitFill)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "crossUnitFill must be OFF or ON");
    }
    return new PlannerViews.PlanOptions(staffTypes, partTimeFill, crossUnitFill);
  }

  private static PlanGenerator.Options generatorOptions(PlannerViews.PlanOptions options) {
    return new PlanGenerator.Options(
        options.staffTypes().contains("PART_TIME"),
        "UP_TO_FTE".equals(options.partTimeFill()),
        "ON".equals(options.crossUnitFill()));
  }

  /** Who holds which qualification, and what each unit block with a qualified minimum asks for. */
  private PlanGenerator.Qualifications loadQualifications() {
    Map<UUID, Map<String, UUID>> required = new HashMap<>();
    jdbc.query(
        "SELECT unit_id, block, qualification_id FROM unit_requirement"
            + " WHERE effective_to IS NULL AND qualification_id IS NOT NULL"
            + " AND min_with_qualification > 0",
        (RowCallbackHandler)
            rs ->
                required
                    .computeIfAbsent(rs.getObject("unit_id", UUID.class), key -> new HashMap<>())
                    .put(rs.getString("block"), rs.getObject("qualification_id", UUID.class)));
    Map<UUID, Set<UUID>> held = new HashMap<>();
    jdbc.query(
        "SELECT employee_id, qualification_id FROM employee_qualification",
        (RowCallbackHandler)
            rs ->
                held.computeIfAbsent(rs.getObject("employee_id", UUID.class), key -> new HashSet<>())
                    .add(rs.getObject("qualification_id", UUID.class)));
    return new PlanGenerator.Qualifications(required, held);
  }

  public PlannerViews.DraftSummary draft(UUID id) {
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT d.*, u.display_name AS created_by_name FROM plan_draft d"
                + " LEFT JOIN app_user u ON u.id = d.created_by WHERE d.id = ?",
            id);
    return draftSummary(row);
  }

  /** The two cards both a generated and a re-scored draft carry. */
  private void operationalCards(
      Map<String, Object> scorecard, List<PlanGenerator.Assignment> assignments) {
    scorecard.put("staffing", unitsService.staffing());
    scorecard.put(
        "qualification", QualificationCoverage.card(jdbc, assignments, activeUnits::active));
  }

  /**
   * Re-score a draft after one hand edit (release 7). It reads the edited draft rows, rebuilds
   * warnings, gaps and the whole scorecard with the generator's own assessment helpers; it never
   * generates or moves a shift. The caller owns the row change, the version increment and the audit
   * event, inside one transaction and the demo lock.
   */
  public Map<String, Object> recomputeDraft(UUID id) {
    Map<String, Object> draft = requireDraft(id);
    if (!"DRAFT".equals(draft.get("status"))) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Only a draft can be changed; this plan is committed or discarded.");
    }
    List<PlanGenerator.Unit> units = loadUnits();
    List<PlanGenerator.Employee> employees = loadEmployees(units);
    Map<String, PlanGenerator.Template> templates = loadTemplates();
    Map<UUID, List<ShiftFact>> history =
        loadHistory(
            FROM.minusDays(PlanGenerator.HISTORY_DAYS).atStartOfDay(REGINA).toInstant(),
            FROM.atStartOfDay(REGINA).toInstant());
    Map<UUID, Set<String>> baselineWarnings = new HashMap<>();
    history.forEach(
        (employeeId, shifts) ->
            baselineWarnings.put(employeeId, warningKeys(ruleCheck.evaluateFacts(shifts))));
    // R-01/R-02 run in the planner as on the board: the post of each proposal, read once.
    RuleCheckService.PostLookup posts = ruleCheck.posts();
    PlanGenerator.Verifier verifier =
        (employee, unit, template, start, current) -> {
          ShiftFact proposed =
              new ShiftFact(
                  "proposed",
                  employee.employeeNo(),
                  unit.code(),
                  template.code(),
                  start,
                  start.plus(Duration.ofMinutes(template.minutes())),
                  ShiftKind.ROSTERED,
                  0,
                  unit.allows12h(),
                  unit.allows16h());
          RuleCheckService.OutcomeView outcome = ruleCheck.evaluate(
                  proposed, current, posts.post(employee.id(), unit.id(), start));
          boolean blocked =
              outcome.ruleResults().stream().anyMatch(result -> "BLOCK".equals(result.outcome()));
          Set<String> baseline = baselineWarnings.getOrDefault(employee.id(), Set.of());
          List<PlanGenerator.RuleWarning> warnings =
              outcome.ruleResults().stream()
                  .filter(result -> "WARN".equals(result.outcome()))
                  .filter(result -> !baseline.contains(warningKey(result)))
                  .map(
                      result ->
                          new PlanGenerator.RuleWarning(result.ruleCode(), result.message()))
                  .toList();
          return new PlanGenerator.Check(blocked, warnings);
        };
    List<PlanGenerator.Assignment> assignments =
        jdbc.query(
            "SELECT a.id, a.employee_id, e.first_name || ' ' || e.last_name AS employee_name,"
                + " a.unit_id, u.code AS unit_code, a.shift_template_id, t.code AS template_code,"
                + " a.work_date, a.start_at, a.end_at, a.kind FROM plan_draft_assignment a"
                + " JOIN employee e ON e.id = a.employee_id JOIN unit u ON u.id = a.unit_id"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY a.start_at, a.employee_id",
            (rs, row) ->
                new PlanGenerator.Assignment(
                    rs.getObject("employee_id", UUID.class),
                    rs.getString("employee_name"),
                    rs.getObject("unit_id", UUID.class),
                    rs.getString("unit_code"),
                    rs.getObject("shift_template_id", UUID.class),
                    rs.getString("template_code"),
                    rs.getDate("work_date").toLocalDate(),
                    rs.getTimestamp("start_at").toInstant(),
                    rs.getTimestamp("end_at").toInstant(),
                    "EXTRA".equals(rs.getString("kind"))
                        ? ShiftKind.EXTRA
                        : ShiftKind.ROSTERED,
                    List.of()),
            id);
    long started = System.nanoTime();
    PlanGenerator.Result result =
        new PlanGenerator()
            .assess(
                employees,
                units,
                templates,
                history,
                (String) draft.get("pattern8h"),
                verifier,
                loadLeave(),
                activeUnits::active,
                assignments);
    operationalCards(result.scorecard(), result.assignments());
    // A hand edit changes shifts, not what the draft was generated with: keep the snapshot, and
    // the cross-unit card, which is measured when the draft is generated.
    Map<String, Object> previous = storedScorecard(draft);
    for (String kept : List.of("inputs", "crossUnit")) {
      if (previous.get(kept) != null) {
        result.scorecard().put(kept, previous.get(kept));
      }
    }
    String scorecardJson = mapper.writeValueAsString(result.scorecard());
    String warningsJson = mapper.writeValueAsString(warningMaps(result.warnings()));
    int generatedMs = (int) ((System.nanoTime() - started) / 1_000_000);
    jdbc.update(
        "UPDATE plan_draft SET scorecard = ?::jsonb, warnings = ?::jsonb, warning_count = ?,"
            + " generated_ms = ? WHERE id = ? AND status = 'DRAFT'",
        scorecardJson,
        warningsJson,
        result.warnings().size(),
        generatedMs,
        id);
    jdbc.update("DELETE FROM plan_draft_gap WHERE draft_id = ?", id);
    if (!result.gaps().isEmpty()) {
      jdbc.batchUpdate(
          "INSERT INTO plan_draft_gap (id, draft_id, unit_id, gap_date, block, required, placed,"
              + " reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          result.gaps().stream()
              .map(
                  gap ->
                      new Object[] {
                        UUID.randomUUID(),
                        id,
                        gap.unitId(),
                        java.sql.Date.valueOf(gap.date()),
                        gap.block(),
                        gap.required(),
                        gap.placed(),
                        gap.reason()
                      })
              .toList());
    }
    return result.scorecard();
  }

  public List<PlannerViews.GapView> gaps(UUID id) {
    requireDraft(id);
    return jdbc.query(
        "SELECT g.unit_id, u.code, u.name, g.gap_date, g.block, g.required, g.placed, g.reason"
            + " FROM plan_draft_gap g JOIN unit u ON u.id = g.unit_id"
            + " WHERE g.draft_id = ? ORDER BY g.gap_date, u.code, g.block",
        (rs, row) ->
            new PlannerViews.GapView(
                rs.getObject("unit_id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getDate("gap_date").toLocalDate(),
                rs.getString("block"),
                rs.getInt("required"),
                rs.getInt("placed"),
                rs.getString("reason")),
        id);
  }

  public List<PlannerViews.WarningGroup> warnings(UUID id) {
    requireDraft(id);
    List<Map<String, Object>> stored = storedWarnings(id);
    Map<String, List<PlannerViews.WarningItem>> groups = new LinkedHashMap<>();
    for (Map<String, Object> warning : stored) {
      String ruleName = String.valueOf(warning.get("ruleName"));
      groups
          .computeIfAbsent(ruleName, key -> new ArrayList<>())
          .add(
              new PlannerViews.WarningItem(
                  String.valueOf(warning.get("unitCode")),
                  LocalDate.parse(String.valueOf(warning.get("date"))),
                  String.valueOf(warning.get("employeeName")),
                  String.valueOf(warning.get("shift")),
                  String.valueOf(warning.get("message"))));
    }
    return groups.entrySet().stream()
        .map(entry -> new PlannerViews.WarningGroup(entry.getKey(), entry.getValue().size(), entry.getValue()))
        .sorted(Comparator.comparing(PlannerViews.WarningGroup::ruleName))
        .toList();
  }

  public PlannerViews.CommitPreview preview(UUID id) {
    Map<String, Object> draft = requireDraft(id);
    RankSplit split = draftSplit(id);
    int gaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ?", Integer.class, id);
    return new PlannerViews.CommitPreview(
        ((Number) draft.get("version")).intValue(),
        split.shifts(),
        split.officers(),
        gaps,
        ((Number) draft.get("warning_count")).intValue(),
        ((java.sql.Date) draft.get("from_date")).toLocalDate(),
        ((java.sql.Date) draft.get("to_date")).toLocalDate(),
        split.supervisors(),
        split.officerShifts(),
        split.supervisorShifts());
  }

  /** A draft's shifts and people split by rank (release v1.3). */
  record RankSplit(int officerShifts, int supervisorShifts, int officers, int supervisors) {
    int shifts() {
      return officerShifts + supervisorShifts;
    }
  }

  /**
   * The supervisors, by the same reading as the planner: a rank this build does not know is not a
   * supervisor ({@link Position#fromCodeOrDefault}).
   */
  private Set<UUID> supervisorIds() {
    Set<UUID> ids = new HashSet<>();
    jdbc.query(
        "SELECT id, classification FROM employee",
        (RowCallbackHandler)
            rs -> {
              if (Position.fromCodeOrDefault(rs.getString("classification")).isSupervisory()) {
                ids.add(rs.getObject("id", UUID.class));
              }
            });
    return ids;
  }

  private RankSplit draftSplit(UUID draftId) {
    Set<UUID> supervisors = supervisorIds();
    int[] counts = new int[4];
    jdbc.query(
        "SELECT employee_id, count(*) AS shifts FROM plan_draft_assignment WHERE draft_id = ?"
            + " GROUP BY employee_id",
        (RowCallbackHandler)
            rs -> {
              boolean supervisor = supervisors.contains(rs.getObject("employee_id", UUID.class));
              counts[supervisor ? 1 : 0] += rs.getInt("shifts");
              counts[supervisor ? 3 : 2]++;
            },
        draftId);
    return new RankSplit(counts[0], counts[1], counts[2], counts[3]);
  }

  @Transactional
  public PlannerViews.DiscardResult discard(UUID id, AuthPrincipal principal) {
    Map<String, Object> draft = requireDraft(id);
    if (!"DRAFT".equals(draft.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a draft can be discarded");
    }
    if (jdbc.update(
            "UPDATE plan_draft SET status = 'DISCARDED', version = version + 1"
                + " WHERE id = ? AND status = 'DRAFT'",
            id)
        == 0) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "The draft was committed or discarded while this request ran");
    }
    audit(principal, "discard_plan", "plan_draft", id, Map.of("assignments", shiftCount(id)));
    return new PlannerViews.DiscardResult(id, "DISCARDED");
  }

  // ---------------------------------------------------------------------------------------------
  // Draft schedule and coverage (same shapes as the planning board)
  // ---------------------------------------------------------------------------------------------

  public ca.shiftcircle.api.schedule.ScheduleQuery.SchedulePayload schedule(
      UUID id, UUID unitId, LocalDate from, LocalDate to) {
    Map<String, Object> draft = requireDraft(id);
    validateRange(from, to);
    Map<String, Object> unit =
        jdbc.queryForMap("SELECT id, name, active FROM unit WHERE id = ?", unitId);
    Map<String, Integer> required = required(unitId);
    List<Map<String, Object>> planned = plannedForUnit(id, unitId, from, to);
    List<LocalDate> days = days(from, to);
    List<LocalDate> activeDays = days.stream().filter(day -> activeUnits.active(unitId, day)).toList();
    List<ca.shiftcircle.api.schedule.ScheduleQuery.BlockCoverage> coverage =
        coverageFor(required, planned, activeDays, true);
    List<LocalDate> closedDates =
        Boolean.TRUE.equals(unit.get("active"))
            ? activeUnits.closedDates(unitId, from, to)
            : days;
    List<ca.shiftcircle.api.units.ActiveUnits.Closure> closures =
        activeUnits.closuresIn(unitId, from, to);
    LocalDate closedFrom = closures.isEmpty() ? null : closures.get(0).closedFrom();
    LocalDate closedTo =
        closures.isEmpty() || closures.get(0).reopensOn() == null
            ? null
            : closures.get(0).reopensOn().minusDays(1);
    String closedLabel =
        Boolean.TRUE.equals(unit.get("active"))
            ? activeUnits.closedLabel(unitId, from, to)
            : "Switched off";
    String closedReason = closures.isEmpty() ? null : closures.get(0).reason();

    Set<UUID> editedAssignments = new HashSet<>(editedAssignmentIds(id));
    Map<UUID, List<Map<String, Object>>> byOfficer = new LinkedHashMap<>();
    Map<UUID, Map<String, Object>> officerRows = new LinkedHashMap<>();
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      officerRows.putIfAbsent(employeeId, row);
      byOfficer.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(row);
    }
    // Planned leave (fit-gap B1-lite): shown as Vac/Sick/Other chips instead of Off. Officers of
    // this unit who are on leave and have no draft shift anywhere in the range get a leave-only row.
    PlannedLeave leave = plannedLeave(id, unitId, from, to, officerRows.keySet());
    Set<UUID> rowIds = new HashSet<>(officerRows.keySet());
    rowIds.addAll(leave.leaveOnlyNames().keySet());
    Map<UUID, List<String>> qualifications = qualifications(rowIds);
    String pattern = (String) draft.get("pattern8h");
    LocalDate periodStart =
        ((java.sql.Date) draft.get("from_date")).toLocalDate()
            .plusDays((java.time.temporal.ChronoUnit.DAYS.between(
                        ((java.sql.Date) draft.get("from_date")).toLocalDate(), from) / 14) * 14);
    LocalDate periodEnd = periodStart.plusDays(13);
    List<ca.shiftcircle.api.schedule.ScheduleQuery.OfficerRow> officers = new ArrayList<>();
    officerRows.forEach(
        (employeeId, row) -> {
          Map<LocalDate, List<Object>> cells = new LinkedHashMap<>();
          days.forEach(day -> cells.put(day, new ArrayList<>()));
          double periodHours = 0;
          for (Map<String, Object> shift : byOfficer.getOrDefault(employeeId, List.of())) {
            LocalDate date = ((java.sql.Date) shift.get("work_date")).toLocalDate();
            Instant start = ((Timestamp) shift.get("start_at")).toInstant();
            Instant end = ((Timestamp) shift.get("end_at")).toInstant();
            if (!date.isBefore(periodStart) && !date.isAfter(periodEnd)) {
              periodHours += Duration.between(start, end).toMinutes() / 60.0;
            }
            cells
                .getOrDefault(date, new ArrayList<>())
                .add(
                    new ca.shiftcircle.api.schedule.ScheduleQuery.ShiftItem(
                        "SHIFT",
                        (UUID) shift.get("id"),
                        (String) shift.get("template_code"),
                        start.toString(),
                        end.toString(),
                        "ROSTERED",
                        false,
                        0,
                        editedAssignments.contains((UUID) shift.get("id"))));
          }
          leave.addTo(employeeId, cells);
          periodHours = Math.round(periodHours * 100.0) / 100.0;
          String status = periodHours >= 80 ? "IN_OVERTIME" : periodHours >= 72 ? "APPROACHING" : "UNDER";
          List<ca.shiftcircle.api.schedule.ScheduleQuery.DayCell> dayCells = new ArrayList<>();
          cells.forEach(
              (date, items) ->
                  dayCells.add(new ca.shiftcircle.api.schedule.ScheduleQuery.DayCell(date, items)));
          officers.add(
              new ca.shiftcircle.api.schedule.ScheduleQuery.OfficerRow(
                  employeeId,
                  (String) row.get("employee_name"),
                  rotation(row, pattern),
                  qualifications.getOrDefault(employeeId, List.of()),
                  periodHours,
                  80.0,
                  status,
                  dayCells,
                  // Placed away from home (cross-unit fill or closed-unit relief): say from where.
                  unitId.equals(row.get("home_unit_id")) ? null : (String) row.get("home_unit_name")));
        });
    leave.leaveOnlyNames()
        .forEach(
            (employeeId, name) -> {
              Map<LocalDate, List<Object>> cells = new LinkedHashMap<>();
              days.forEach(day -> cells.put(day, new ArrayList<>()));
              leave.addTo(employeeId, cells);
              List<ca.shiftcircle.api.schedule.ScheduleQuery.DayCell> dayCells = new ArrayList<>();
              cells.forEach(
                  (date, items) ->
                      dayCells.add(
                          new ca.shiftcircle.api.schedule.ScheduleQuery.DayCell(date, items)));
              officers.add(
                  new ca.shiftcircle.api.schedule.ScheduleQuery.OfficerRow(
                      employeeId,
                      name,
                      "On leave",
                      qualifications.getOrDefault(employeeId, List.of()),
                      0.0,
                      80.0,
                      "UNDER",
                      dayCells,
                      null));
            });
    return new ca.shiftcircle.api.schedule.ScheduleQuery.SchedulePayload(
        new ca.shiftcircle.api.schedule.ScheduleQuery.UnitView(
            unitId,
            (String) unit.get("name"),
            closedFrom,
            closedTo,
            closedLabel,
            closedReason,
            closedDates),
        from,
        to,
        days,
        LocalDate.now(REGINA).toString(),
        null,
        coverage,
        officers,
        ((Number) draft.get("warning_count")).intValue(),
        0,
        new ca.shiftcircle.api.schedule.ScheduleQuery.PublishedState(false, null),
        null);
  }

  public List<PlannerViews.UnitCoverage> draftCoverage(UUID id, LocalDate from, LocalDate to) {
    requireDraft(id);
    validateRange(from, to);
    List<LocalDate> days = days(from, to);
    List<PlannerViews.UnitCoverage> result = new ArrayList<>();
    for (Map<String, Object> unit : jdbc.queryForList("SELECT id, name, active FROM unit ORDER BY code")) {
      UUID unitId = (UUID) unit.get("id");
      List<Map<String, Object>> planned = plannedForUnit(id, unitId, from, to);
      List<LocalDate> activeDays =
          days.stream().filter(day -> activeUnits.active(unitId, day)).toList();
      List<LocalDate> closedDates =
          Boolean.TRUE.equals(unit.get("active"))
              ? activeUnits.closedDates(unitId, from, to)
              : days;
      List<ca.shiftcircle.api.units.ActiveUnits.Closure> closures =
          activeUnits.closuresIn(unitId, from, to);
      LocalDate closedFrom = closures.isEmpty() ? null : closures.get(0).closedFrom();
      LocalDate closedTo =
          closures.isEmpty() || closures.get(0).reopensOn() == null
              ? null
              : closures.get(0).reopensOn().minusDays(1);
      String closedLabel =
          Boolean.TRUE.equals(unit.get("active"))
              ? activeUnits.closedLabel(unitId, from, to)
              : "Switched off";
      String closedReason = closures.isEmpty() ? null : closures.get(0).reason();
      result.add(
          new PlannerViews.UnitCoverage(
              unitId,
              (String) unit.get("name"),
              closedFrom,
              closedTo,
              closedLabel,
              closedReason,
              closedDates,
              coverageFor(required(unitId), planned, activeDays, false)));
    }
    return result;
  }

  private void validateRange(LocalDate from, LocalDate to) {
    if (to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > 31) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "from and to must span at most 31 days, in order");
    }
  }

  private Map<String, Integer> required(UUID unitId) {
    Map<String, Integer> required = new LinkedHashMap<>();
    jdbc.query(
        "SELECT block, min_staff FROM unit_requirement WHERE unit_id = ? AND effective_to IS NULL",
        (RowCallbackHandler) rs -> required.put(rs.getString("block"), rs.getInt("min_staff")),
        unitId);
    return required;
  }

  /** Planned leave in a draft roster range: employee -> date -> absence types, plus leave-only rows. */
  private record PlannedLeave(
      Map<UUID, Map<LocalDate, Set<String>>> byOfficer, Map<UUID, String> leaveOnlyNames) {
    void addTo(UUID employeeId, Map<LocalDate, List<Object>> cells) {
      byOfficer
          .getOrDefault(employeeId, Map.of())
          .forEach(
              (date, types) -> {
                List<Object> items = cells.get(date);
                if (items != null) {
                  types.forEach(type -> items.add(new PlannerViews.LeaveItem("ABSENCE", type)));
                }
              });
    }
  }

  /**
   * Absences with no shift assignment (planned leave: the planner's POST /planner/absences and the
   * Dataset 150 seed) that overlap the range, in Regina days. An officer already on the roster gets
   * chips on their row; an active officer whose home unit is this unit, with no draft shift in any
   * unit in the range, gets a leave-only row so a full week of leave is visible, not missing.
   */
  private PlannedLeave plannedLeave(
      UUID draftId, UUID unitId, LocalDate from, LocalDate to, Set<UUID> onRoster) {
    Map<UUID, Map<LocalDate, Set<String>>> byOfficer = new HashMap<>();
    Map<UUID, String> leaveOnly = new LinkedHashMap<>();
    Map<UUID, String> names = new HashMap<>();
    jdbc.query(
        "SELECT a.employee_id, a.type, a.start_at, a.end_at,"
            + " e.first_name || ' ' || e.last_name AS employee_name,"
            + " (e.active AND e.home_unit_id = ? AND NOT EXISTS (SELECT 1 FROM plan_draft_assignment d"
            + "   WHERE d.draft_id = ? AND d.employee_id = a.employee_id"
            + "   AND d.work_date BETWEEN ? AND ?)) AS leave_only"
            + " FROM absence a JOIN employee e ON e.id = a.employee_id"
            + " WHERE a.shift_assignment_id IS NULL AND a.start_at < ? AND a.end_at > ?"
            + " ORDER BY a.start_at",
        (RowCallbackHandler)
            rs -> {
              UUID employeeId = rs.getObject("employee_id", UUID.class);
              if (!onRoster.contains(employeeId) && !rs.getBoolean("leave_only")) {
                return;
              }
              if (!onRoster.contains(employeeId)) {
                names.put(employeeId, rs.getString("employee_name"));
              }
              Instant start = rs.getTimestamp("start_at").toInstant();
              Instant end = rs.getTimestamp("end_at").toInstant();
              LocalDate endDate = end.atZone(REGINA).toLocalDate();
              if (end.equals(endDate.atStartOfDay(REGINA).toInstant())) {
                endDate = endDate.minusDays(1);
              }
              for (LocalDate date = start.atZone(REGINA).toLocalDate();
                  !date.isAfter(endDate);
                  date = date.plusDays(1)) {
                if (!date.isBefore(from) && !date.isAfter(to)) {
                  byOfficer
                      .computeIfAbsent(employeeId, key -> new java.util.TreeMap<>())
                      .computeIfAbsent(date, key -> new java.util.LinkedHashSet<>())
                      .add(rs.getString("type"));
                }
              }
            },
        unitId,
        draftId,
        from,
        to,
        Timestamp.from(to.plusDays(1).atStartOfDay(REGINA).toInstant()),
        Timestamp.from(from.atStartOfDay(REGINA).toInstant()));
    names.entrySet().stream()
        .filter(entry -> byOfficer.containsKey(entry.getKey()))
        .sorted(Map.Entry.comparingByValue())
        .forEach(entry -> leaveOnly.put(entry.getKey(), entry.getValue()));
    return new PlannedLeave(byOfficer, leaveOnly);
  }

  private List<Map<String, Object>> plannedForUnit(
      UUID draftId, UUID unitId, LocalDate from, LocalDate to) {
    return jdbc.queryForList(
        "SELECT a.id, a.employee_id, a.work_date, a.start_at, a.end_at,"
            + " e.first_name || ' ' || e.last_name AS employee_name, e.shift_pattern,"
            + " t.code AS template_code, t.duration_minutes, e.home_unit_id,"
            + " hu.name AS home_unit_name"
            + " FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
            + " JOIN shift_template t ON t.id = a.shift_template_id"
            + " LEFT JOIN unit hu ON hu.id = e.home_unit_id"
            + " WHERE a.draft_id = ? AND a.unit_id = ? AND a.work_date BETWEEN ? AND ?"
            + " ORDER BY a.start_at",
        draftId,
        unitId,
        from,
        to);
  }

  private List<ca.shiftcircle.api.schedule.ScheduleQuery.BlockCoverage> coverageFor(
      Map<String, Integer> required,
      List<Map<String, Object>> planned,
      List<LocalDate> days,
      boolean withActual) {
    List<ca.shiftcircle.api.schedule.ScheduleQuery.BlockCoverage> coverage = new ArrayList<>();
    Map<LocalDate, List<ca.shiftcircle.api.coverage.CoverageCalculator.Interval>> intervals =
        new HashMap<>();
    for (Map<String, Object> row : planned) {
      intervals
          .computeIfAbsent(
              ((java.sql.Date) row.get("work_date")).toLocalDate(), key -> new ArrayList<>())
          .add(
              new ca.shiftcircle.api.coverage.CoverageCalculator.Interval(
                  ((Timestamp) row.get("start_at")).toInstant(),
                  ((Timestamp) row.get("end_at")).toInstant()));
    }
    for (LocalDate date : days) {
      List<ca.shiftcircle.api.coverage.CoverageCalculator.BlockCoverage> blocks =
          new ca.shiftcircle.api.coverage.CoverageCalculator()
              .forDay(date, required, intervals.getOrDefault(date, List.of()));
      for (ca.shiftcircle.api.coverage.CoverageCalculator.BlockCoverage block : blocks) {
        List<ca.shiftcircle.api.schedule.ScheduleQuery.ShortHour> shortHours = new ArrayList<>();
        block
            .coverage()
            .shortHours()
            .forEach(
                shortHour ->
                    shortHours.add(
                        new ca.shiftcircle.api.schedule.ScheduleQuery.ShortHour(
                            shortHour.from(), shortHour.to(), shortHour.count())));
        coverage.add(
            new ca.shiftcircle.api.schedule.ScheduleQuery.BlockCoverage(
                block.block(),
                date,
                block.required(),
                new ca.shiftcircle.api.schedule.ScheduleQuery.HourlyCoverage(
                    block.coverage().lowestHourly(),
                    shortHours,
                    block.coverage().maxHourly()),
                null,
                block.covered()));
      }
    }
    return coverage;
  }

  private List<LocalDate> days(LocalDate from, LocalDate to) {
    List<LocalDate> days = new ArrayList<>();
    for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
      days.add(date);
    }
    return days;
  }

  private Map<UUID, List<String>> qualifications(java.util.Collection<UUID> employeeIds) {
    Map<UUID, List<String>> result = new HashMap<>();
    if (employeeIds.isEmpty()) {
      return result;
    }
    jdbc.query(
        "SELECT eq.employee_id, q.code FROM employee_qualification eq"
            + " JOIN qualification q ON q.id = eq.qualification_id",
        (RowCallbackHandler)
            rs ->
            result
                .computeIfAbsent(rs.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                .add(rs.getString("code")));
    return result;
  }

  private static String rotation(Map<String, Object> row, String pattern8h) {
    int minutes = ((Number) row.get("duration_minutes")).intValue();
    if (minutes == 960) {
      return "1 on, 2 off";
    }
    if (minutes == 720) {
      return "4 on, 4 off";
    }
    String pattern =
        row.get("shift_pattern") == null ? pattern8h : (String) row.get("shift_pattern");
    return switch (pattern == null ? "ROTATING_5_2" : pattern) {
      case "ROTATING_5_2" -> "5 on, 2 off (weekends rotate)";
      case "7_ON_3_OFF" -> "7 on, 3 off";
      default -> "5 on, 2 off";
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public CommitAttempt commit(
      UUID id, PlannerViews.CommitInput input, Integer ifMatch, AuthPrincipal principal) {
    Map<String, Object> draft = requireDraft(id);
    if (!"DRAFT".equals(draft.get("status"))) {
      return new CommitAttempt(
          HttpStatus.CONFLICT.value(),
          Map.of("reason", "ALREADY_COMMITTED", "status", draft.get("status")));
    }
    int version = ((Number) draft.get("version")).intValue();
    if (ifMatch == null) {
      return new CommitAttempt(
          HttpStatus.PRECONDITION_REQUIRED.value(),
          Map.of("reason", "Send If-Match with the draft version", "version", version));
    }
    if (ifMatch != version) {
      return new CommitAttempt(
          HttpStatus.PRECONDITION_FAILED.value(),
          Map.of("reason", "The draft changed since it was read; reload before committing", "version", version));
    }
    int storedWarnings = ((Number) draft.get("warning_count")).intValue();
    int accepted = input == null || input.acceptedWarningCount() == null
        ? -1
        : input.acceptedWarningCount();
    if (accepted != storedWarnings) {
      return new CommitAttempt(
          HttpStatus.CONFLICT.value(),
          Map.of(
              "reason", "WARNINGS_NOT_ACKNOWLEDGED",
              "warningCount", storedWarnings,
              "acceptedWarningCount", accepted));
    }

    Integer locked =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment a JOIN pay_period p"
                + " ON a.work_date BETWEEN p.start_date AND p.end_date"
                + " WHERE a.draft_id = ? AND p.status = 'LOCKED'",
            Integer.class,
            id);
    if (locked != null && locked > 0) {
      return new CommitAttempt(
          HttpStatus.CONFLICT.value(),
          Map.of("reason", "LOCKED_PERIOD", "assignments", locked));
    }

    ensurePlanPeriods();
    List<Map<String, Object>> planned =
        jdbc.queryForList(
            "SELECT a.*, t.code AS template_code, e.first_name || ' ' || e.last_name AS employee_name,"
                + " u.code AS unit_code, u.allows_12h, u.allows_16h"
                + " FROM plan_draft_assignment a JOIN shift_template t ON t.id = a.shift_template_id"
                + " JOIN employee e ON e.id = a.employee_id JOIN unit u ON u.id = a.unit_id"
                + " WHERE a.draft_id = ? ORDER BY a.start_at, a.employee_id",
            id);
    Map<UUID, List<ShiftFact>> facts =
        loadHistory(
            FROM.minusDays(PlanGenerator.HISTORY_DAYS).atStartOfDay(REGINA).toInstant(),
            TO.plusDays(1).atStartOfDay(REGINA).toInstant());
    Map<UUID, Set<String>> baselineWarnings = new HashMap<>();
    facts.forEach(
        (employeeId, shifts) ->
            baselineWarnings.put(employeeId, warningKeys(ruleCheck.evaluateFacts(shifts))));
    RuleCheckService.PostLookup posts = ruleCheck.posts();
    List<PlannerViews.CommitFailure> failures = new ArrayList<>();
    Set<String> warningKeys = new HashSet<>();
    int warnings = 0;
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      UUID unitId = (UUID) row.get("unit_id");
      String templateCode = (String) row.get("template_code");
      LocalDate date = ((java.sql.Date) row.get("work_date")).toLocalDate();
      Instant start = ((Timestamp) row.get("start_at")).toInstant();
      Instant end = ((Timestamp) row.get("end_at")).toInstant();
      Instant clippedStart = start.isBefore(FROM.atStartOfDay(REGINA).toInstant())
          ? FROM.atStartOfDay(REGINA).toInstant()
          : start;
      boolean overlaps =
          jdbc.queryForObject(
                  "SELECT count(*) FROM shift_assignment s WHERE s.employee_id = ?"
                      + " AND s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?",
                  Integer.class,
                  employeeId,
                  Timestamp.from(end),
                  Timestamp.from(start))
              > 0;
      if (overlaps) {
        failures.add(
            new PlannerViews.CommitFailure(
                (String) row.get("unit_code"),
                date,
                (String) row.get("employee_name"),
                templateCode,
                List.of("The officer already has a shift at that time")));
        continue;
      }
      String employeeNo =
          jdbc.queryForObject(
              "SELECT employee_no FROM employee WHERE id = ?", String.class, employeeId);
      ShiftFact proposed =
          new ShiftFact(
              "proposed",
              employeeNo,
              (String) row.get("unit_code"),
              templateCode,
              start,
              end,
              ShiftKind.ROSTERED,
              0,
              (Boolean) row.get("allows_12h"),
              (Boolean) row.get("allows_16h"));
      RuleCheckService.OutcomeView outcome =
          ruleCheck.evaluate(
              proposed,
              facts.getOrDefault(employeeId, List.of()),
              posts.post(employeeId, unitId, start));
      List<String> blocks =
          outcome.ruleResults().stream()
              .filter(result -> "BLOCK".equals(result.outcome()))
              .map(result -> result.ruleCode() + ": " + result.message())
              .toList();
      Set<String> baseline = baselineWarnings.getOrDefault(employeeId, Set.of());
      for (RuleCheckService.ResultView result : outcome.ruleResults()) {
        if ("WARN".equals(result.outcome()) && !baseline.contains(warningKey(result))) {
          warningKeys.add(employeeId + "|" + result.ruleCode());
        }
      }
      warnings = warningKeys.size();
      if (!blocks.isEmpty()) {
        failures.add(
            new PlannerViews.CommitFailure(
                (String) row.get("unit_code"),
                date,
                (String) row.get("employee_name"),
                templateCode,
                blocks));
      } else {
        facts
            .computeIfAbsent(employeeId, key -> new ArrayList<>())
            .add(
                new ShiftFact(
                    "draft",
                    employeeNo,
                    (String) row.get("unit_code"),
                    templateCode,
                    start,
                    end,
                    ShiftKind.ROSTERED,
                    0,
                    (Boolean) row.get("allows_12h"),
                    (Boolean) row.get("allows_16h")));
      }
    }
    if (!failures.isEmpty()) {
      return new CommitAttempt(
          HttpStatus.UNPROCESSABLE_CONTENT.value(), Map.of("failures", failures));
    }
    if (warnings != storedWarnings) {
      return new CommitAttempt(
          HttpStatus.CONFLICT.value(),
          Map.of(
              "reason", "WARNINGS_CHANGED",
              "warningCount", warnings,
              "acceptedWarningCount", storedWarnings));
    }

    List<Object[]> rows = new ArrayList<>();
    List<String> units = new ArrayList<>();
    for (Map<String, Object> row : planned) {
      rows.add(
          new Object[] {
            UUID.randomUUID(),
            row.get("employee_id"),
            row.get("unit_id"),
            row.get("shift_template_id"),
            row.get("start_at"),
            row.get("end_at"),
            row.get("work_date"),
            "ROSTERED",
            "PROPOSAL",
            id,
            (String) row.get("unit_code")
          });
      String unitCode = (String) row.get("unit_code");
      if (!units.contains(unitCode)) {
        units.add(unitCode);
      }
    }
    jdbc.batchUpdate(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source, plan_draft_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows.stream().map(row -> java.util.Arrays.copyOf(row, 10)).toList());
    int committedRows =
        jdbc.update(
            "UPDATE plan_draft SET status = 'COMMITTED', version = version + 1,"
                + " committed_at = now(), committed_by = (SELECT id FROM app_user WHERE username = ?)"
                + " WHERE id = ? AND status = 'DRAFT'",
            principal.username(),
            id);
    if (committedRows == 0) {
      // The draft was discarded between the read and this write. Roll back the assignments and
      // the audit: a discard that won must not leave a committed quarter behind.
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "The draft was discarded or committed while this request ran");
    }
    RankSplit split = draftSplit(id);
    long auditId =
        jdbc.queryForObject(
            "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
                + " VALUES ((SELECT id FROM app_user WHERE username = ?), 'commit_plan', 'plan_draft',"
                + " ?, ?::jsonb) RETURNING id",
            Long.class,
            principal.username(),
            id,
            mapper.writeValueAsString(
                Map.of(
                    "assignments", rows.size(),
                    "officers", split.officers(),
                    "supervisors", split.supervisors(),
                    "warnings", warnings,
                    "units", units)));
    return new CommitAttempt(
        HttpStatus.OK.value(),
        new PlannerViews.CommitResult(
            rows.size(),
            LocalDate.now(REGINA).toString(),
            auditId,
            units,
            ((java.sql.Date) draft.get("from_date")).toLocalDate(),
            split.officerShifts(),
            split.supervisorShifts()));
  }

  /**
   * Draft versus the board (docs/07 §4.9): every measure is computed twice, once from the committed
   * shifts the board shows and once from the draft. Coverage uses the board's own absolute-time
   * calculator for both sides, so a 23:00 shift counts after midnight and the two columns are
   * comparable; the plan's own gap count uses the same measure.
   */
  public PlannerViews.CompareView compare(UUID id) {
    Map<String, Object> draftRow = requireDraft(id);
    int draftWarnings = ((Number) draftRow.get("warning_count")).intValue();

    List<Map<String, Object>> units = jdbc.queryForList("SELECT id, code FROM unit ORDER BY code");
    Map<UUID, int[]> boardGapsByUnit = new LinkedHashMap<>();
    long boardGaps = 0;
    double boardGapHours = 0;
    for (Map<String, Object> unit : units) {
      UUID unitId = (UUID) unit.get("id");
      ScheduleQuery.SchedulePayload payload = scheduleQuery.forUnit(unitId, FROM, TO);
      int gaps = 0;
      for (ScheduleQuery.BlockCoverage block : payload.coverage()) {
        if (!block.covered()) {
          gaps++;
          int missing = Math.max(0, block.required() - block.scheduled().lowestHourly());
          boardGapHours += missing * 8.0;
        }
      }
      boardGaps += gaps;
      boardGapsByUnit.put(unitId, new int[] {gaps});
    }

    int draftGaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ?", Integer.class, id);
    double draftGapHours =
        jdbc.queryForObject(
            "SELECT coalesce(sum(greatest(required - placed, 0) * 8), 0) FROM plan_draft_gap"
                + " WHERE draft_id = ?",
            Double.class,
            id);
    Map<UUID, Integer> draftGapsByUnit = new HashMap<>();
    jdbc.query(
        "SELECT unit_id, count(*) AS gaps FROM plan_draft_gap WHERE draft_id = ? GROUP BY unit_id",
        (RowCallbackHandler)
            rs -> draftGapsByUnit.put((UUID) rs.getObject("unit_id"), rs.getInt("gaps")),
        id);

    List<Map<String, Object>> boardRows =
        jdbc.queryForList(
            "SELECT a.employee_id, t.code, t.duration_minutes, t.start_time, a.work_date"
                + " FROM shift_assignment a JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.status <> 'CANCELLED' AND a.work_date BETWEEN ? AND ?",
            FROM,
            TO);
    List<Map<String, Object>> draftRows =
        jdbc.queryForList(
            "SELECT a.employee_id, t.code, t.duration_minutes, t.start_time, a.work_date"
                + " FROM plan_draft_assignment a"
                + " JOIN shift_template t ON t.id = a.shift_template_id WHERE a.draft_id = ?",
            id);
    // The weekend and preference rows are the scorecard's officer figures (release v1.3), so they
    // read over the officers; shifts, people and hours count everyone, with the rank split below.
    Set<UUID> supervisorIds = supervisorIds();
    List<UUID> employeeIds =
        jdbc.queryForList("SELECT id FROM employee WHERE active ORDER BY employee_no", UUID.class)
            .stream()
            .filter(employeeId -> !supervisorIds.contains(employeeId))
            .toList();
    Map<UUID, PlanGenerator.Pref> prefs = preferencesById();
    Stats board = stats(boardRows, employeeIds, prefs, supervisorIds);
    Stats draft = stats(draftRows, employeeIds, prefs, supervisorIds);
    boolean ranks =
        !supervisorIds.isEmpty()
            || jdbc.queryForObject(
                    "SELECT count(*) FROM unit WHERE kind = 'SUPERVISION'", Integer.class)
                > 0;
    List<Map<String, Object>> committed =
        jdbc.queryForList(
            "SELECT warning_count FROM plan_draft WHERE status = 'COMMITTED'"
                + " AND from_date <= ? AND to_date >= ? ORDER BY committed_at DESC LIMIT 1",
            TO,
            FROM);
    int boardWarnings =
        committed.isEmpty() ? 0 : ((Number) committed.get(0).get("warning_count")).intValue();

    List<PlannerViews.CompareRow> rows = new ArrayList<>();
    rows.add(row("coverageGaps", "Coverage gaps (short block-days)", boardGaps, draftGaps,
        "count", "LOWER_IS_BETTER"));
    rows.add(row("gapHours", "Unfilled gap hours", boardGapHours, draftGapHours, "hours",
        "LOWER_IS_BETTER"));
    rows.add(row("shifts", "Shifts", board.shifts(), draft.shifts(), "count", "NEUTRAL"));
    rows.add(row("officers", "Officers scheduled", board.officers(), draft.officers(), "count",
        "NEUTRAL"));
    if (ranks) {
      // The split appears once there is a supervisor or a supervisor post (release v1.3).
      rows.add(row("officerShifts", "Officer shifts", board.shifts() - board.supervisorShifts(),
          draft.shifts() - draft.supervisorShifts(), "count", "NEUTRAL"));
      rows.add(row("supervisorShifts", "Supervisor shifts", board.supervisorShifts(),
          draft.supervisorShifts(), "count", "NEUTRAL"));
      rows.add(row("supervisors", "Supervisors scheduled", board.supervisors(),
          draft.supervisors(), "count", "NEUTRAL"));
    }
    rows.add(row("plannedHours", "Planned hours", board.hours(), draft.hours(), "hours",
        "NEUTRAL"));
    rows.add(row("warnings", "Warnings added by the plan", boardWarnings, draftWarnings, "count",
        "LOWER_IS_BETTER"));
    rows.add(row("preferencesMet", "Preferences met", board.preferencesMet(),
        draft.preferencesMet(), "count", "HIGHER_IS_BETTER"));
    rows.add(row("weekendsMin", "Weekends worked (min)", board.weekendsMin(),
        draft.weekendsMin(), "days", "NEUTRAL"));
    rows.add(row("weekendsAvg", "Weekends worked (avg)", board.weekendsAvg(),
        draft.weekendsAvg(), "days", "NEUTRAL"));
    rows.add(row("weekendsMax", "Weekends worked (max)", board.weekendsMax(),
        draft.weekendsMax(), "days", "NEUTRAL"));
    for (Map<String, Object> unit : units) {
      UUID unitId = (UUID) unit.get("id");
      String code = (String) unit.get("code");
      rows.add(
          new PlannerViews.CompareRow(
              "unit:" + code + ":coverageGaps",
              code + " coverage gaps",
              boardGapsByUnit.getOrDefault(unitId, new int[] {0})[0],
              draftGapsByUnit.getOrDefault(unitId, 0),
              "count",
              "LOWER_IS_BETTER"));
    }
    String draftStatus = (String) draftRow.get("status");
    String basis =
        "COMMITTED".equals(draftStatus)
            ? "The committed plan is compared with the current board, including supervisor edits"
                + " since the commit."
            : "The draft is compared with the current board (the last committed plan, or the"
                + " seeded roster before a commit).";
    return new PlannerViews.CompareView(
        draft.shifts(), draftGaps, board.shifts(), draftStatus, basis, rows);
  }

  private static PlannerViews.CompareRow row(
      String key, String label, double board, double draft, String unit, String direction) {
    return new PlannerViews.CompareRow(key, label, board, draft, unit, direction);
  }

  private record Stats(
      int shifts,
      int officers,
      double hours,
      int weekendsMin,
      double weekendsAvg,
      int weekendsMax,
      int preferencesMet,
      int supervisors,
      int supervisorShifts) {}

  private static Stats stats(
      List<Map<String, Object>> rows,
      List<UUID> employeeIds,
      Map<UUID, PlanGenerator.Pref> prefs,
      Set<UUID> supervisorIds) {
    Map<UUID, List<Map<String, Object>>> byEmployee = new HashMap<>();
    for (Map<String, Object> row : rows) {
      byEmployee
          .computeIfAbsent((UUID) row.get("employee_id"), key -> new ArrayList<>())
          .add(row);
    }
    double hours =
        rows.stream()
            .mapToDouble(
                row -> ((Number) row.get("duration_minutes")).doubleValue() / 60.0)
            .sum();
    List<Integer> weekends = new ArrayList<>();
    int preferencesMet = 0;
    for (UUID employeeId : employeeIds) {
      List<Map<String, Object>> shifts = byEmployee.getOrDefault(employeeId, List.of());
      Set<LocalDate> weekendDays = new HashSet<>();
      for (Map<String, Object> shift : shifts) {
        LocalDate date = ((java.sql.Date) shift.get("work_date")).toLocalDate();
        if (date.getDayOfWeek() == java.time.DayOfWeek.SATURDAY
            || date.getDayOfWeek() == java.time.DayOfWeek.SUNDAY) {
          weekendDays.add(date);
        }
      }
      weekends.add(weekendDays.size());
      PlanGenerator.Pref pref = prefs.get(employeeId);
      if (pref != null && !shifts.isEmpty()) {
        // Same definition as the scorecard's preferencesCard: each asked criterion counts once,
        // not "all of this officer's wishes in one bucket". This is what keeps scorecard.met and
        // the compare row equal.
        if (pref.shiftLength() != null
            && !shifts.isEmpty()
            && shifts.stream()
                .allMatch(
                    shift ->
                        ((Number) shift.get("duration_minutes")).intValue()
                            == pref.shiftLength() * 60)) {
          preferencesMet++;
        }
        if (PreferenceTimes.asked(pref.timesOfDay())
            && !shifts.isEmpty()
            && shifts.stream()
                .allMatch(
                    shift ->
                        PreferenceTimes.matches(
                            pref.timesOfDay(),
                            ShiftKinds.timeOfDay(
                                (java.sql.Time) shift.get("start_time"))))) {
          preferencesMet++;
        }
        if (pref.daysOff() != null
            && !pref.daysOff().isEmpty()
            && shifts.stream()
                .noneMatch(
                    shift ->
                        pref.daysOff()
                            .contains(
                                ((java.sql.Date) shift.get("work_date"))
                                    .toLocalDate()
                                    .getDayOfWeek()
                                    .name()
                                    .substring(0, 3)))) {
          preferencesMet++;
        }
      }
    }
    int supervisors = 0;
    int supervisorShifts = 0;
    for (Map.Entry<UUID, List<Map<String, Object>>> entry : byEmployee.entrySet()) {
      if (supervisorIds.contains(entry.getKey())) {
        supervisors++;
        supervisorShifts += entry.getValue().size();
      }
    }
    return new Stats(
        rows.size(),
        byEmployee.size() - supervisors,
        round1(hours),
        weekends.stream().mapToInt(Integer::intValue).min().orElse(0),
        round1(weekends.stream().mapToInt(Integer::intValue).average().orElse(0)),
        weekends.stream().mapToInt(Integer::intValue).max().orElse(0),
        preferencesMet,
        supervisors,
        supervisorShifts);
  }

  private static double round1(double value) {
    return Math.round(value * 10.0) / 10.0;
  }

  private Map<UUID, PlanGenerator.Pref> preferencesById() {
    Map<UUID, PlanGenerator.Pref> prefs = new HashMap<>();
    jdbc.query(
        "SELECT employee_id, shift_length, times_of_day, days_off FROM officer_preference",
        (RowCallbackHandler)
            rs ->
                prefs.put(
                    (UUID) rs.getObject("employee_id"),
                    new PlanGenerator.Pref(
                        rs.getObject("shift_length") == null
                            ? null
                            : rs.getInt("shift_length"),
                        timesOfDay(rs.getArray("times_of_day")),
                        daysOff(rs.getArray("days_off")))));
    return prefs;
  }

  /**
   * A committed quarter needs its 14-day pay periods and each unit's schedule period, or the plan
   * can never be locked or paid (review-r2 honest gap). Facility-wide, idempotent, OPEN/DRAFT;
   * a period someone already locked is left alone and commit refuses it above.
   */
  private void ensurePlanPeriods() {
    List<UUID> units = jdbc.queryForList("SELECT id FROM unit ORDER BY code", UUID.class);
    for (LocalDate start = FROM; !start.isAfter(TO); start = start.plusDays(14)) {
      LocalDate end = start.plusDays(13);
      // An identical period is idempotent. Any other overlap is refused with a plain 409: silently
      // absorbing it would leave the quarter with a period that is not the planner's 14-day grid.
      List<Map<String, Object>> existing =
          jdbc.queryForList(
              "SELECT start_date, end_date FROM pay_period"
                  + " WHERE start_date <= ? AND end_date >= ? ORDER BY start_date",
              end,
              start);
      LocalDate periodStart = start;
      LocalDate periodEnd = end;
      Map<String, Object> overlap =
          existing.stream()
              .filter(
                  row ->
                      !(periodStart.equals(
                              ((java.sql.Date) row.get("start_date")).toLocalDate())
                          && periodEnd.equals(
                              ((java.sql.Date) row.get("end_date")).toLocalDate())))
              .findFirst()
              .orElse(null);
      if (overlap != null) {
        throw new PlannerConflictException(
            "PAY_PERIOD_OVERLAP",
            "The pay periods for this plan overlap periods that already exist ("
                + overlap.get("start_date")
                + " to "
                + overlap.get("end_date")
                + "). Reset the demo data or choose a different quarter.");
      }
      boolean identical = !existing.isEmpty();
      UUID payPeriod = UUID.nameUUIDFromBytes(("plan-pay:" + start).getBytes(java.nio.charset.StandardCharsets.UTF_8));
      if (!identical) {
        jdbc.update(
            "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, 'OPEN')",
            payPeriod,
            start,
            end);
      }
      for (UUID unit : units) {
        UUID schedulePeriod =
            UUID.nameUUIDFromBytes(
                ("plan-schedule:" + unit + ":" + start)
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        jdbc.update(
            "INSERT INTO schedule_period (id, unit_id, start_date, end_date, status)"
                + " SELECT ?, ?, ?, ?, 'DRAFT' WHERE NOT EXISTS"
                + " (SELECT 1 FROM schedule_period WHERE unit_id = ? AND start_date = ?)",
            schedulePeriod,
            unit,
            start,
            end,
            unit,
            start);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------------------------

  public List<PlannerViews.PreferenceView> preferences(String unitCode) {
    UUID draftId =
        jdbc.queryForList("SELECT id FROM plan_draft WHERE status = 'DRAFT' LIMIT 1", UUID.class)
            .stream()
            .findFirst()
            .orElse(null);
    if (draftId == null) {
      // After a commit there is no open draft; the preference list still evaluates the committed
      // plan (it is the current plan), instead of saying NO_DRAFT for every officer.
      draftId =
          jdbc.queryForList(
                  "SELECT id FROM plan_draft WHERE status = 'COMMITTED'"
                      + " ORDER BY committed_at DESC LIMIT 1",
                  UUID.class)
              .stream()
              .findFirst()
              .orElse(null);
    }
    UUID planId = draftId;
    Map<UUID, List<Map<String, Object>>> inDraft = new HashMap<>();
    if (planId != null) {
      jdbc.queryForList(
              "SELECT a.employee_id, t.code, t.start_time, t.duration_minutes, a.work_date"
                  + " FROM plan_draft_assignment a JOIN shift_template t ON t.id = a.shift_template_id"
                  + " WHERE a.draft_id = ?",
              planId)
          .forEach(row ->
              inDraft
                  .computeIfAbsent((UUID) row.get("employee_id"), key -> new ArrayList<>())
                  .add(row));
    }
    String sql =
        "SELECT e.id, e.employee_no, e.first_name || ' ' || e.last_name AS name,"
            + " u.name AS unit_name, u.allows_12h, e.seniority_date, e.shift_pattern,"
            + " p.shift_length, p.times_of_day, p.days_off,"
            + " p.max_days_off, p.updated_at, rp.code AS crew"
            + " FROM employee e JOIN unit u ON u.id = e.home_unit_id"
            + " LEFT JOIN officer_preference p ON p.employee_id = e.id"
            + " LEFT JOIN rotation_pattern rp ON rp.id = e.rotation_pattern_id"
            + (unitCode == null ? "" : " WHERE u.code = ?")
            + " ORDER BY u.code, e.employee_no";
    Object[] args = unitCode == null ? new Object[] {} : new Object[] {unitCode};
    return jdbc.query(
        sql,
        (rs, row) -> {
          UUID employeeId = rs.getObject("id", UUID.class);
          List<String> days = daysOff(rs.getArray("days_off"));
          Integer length = rs.getObject("shift_length", Integer.class);
          List<String> times = timesOfDay(rs.getArray("times_of_day"));
          int effective =
              effectiveLength(rs.getString("crew"), length, rs.getBoolean("allows_12h"));
          String pattern =
              effective == 12
                  ? "4_ON_4_OFF"
                  : rs.getString("shift_pattern") == null
                      ? "ROTATING_5_2"
                      : rs.getString("shift_pattern");
          List<Map<String, Object>> shifts = inDraft.getOrDefault(employeeId, List.of());
          List<String> unmet = new ArrayList<>();
          if (length != null
              && shifts.stream()
                  .anyMatch(
                      shift ->
                          ShiftKinds.lengthHours(
                                  ((Number) shift.get("duration_minutes")).intValue())
                              != length)) {
            unmet.add(
                length == 16
                    ? "Shift length 16 h: the planner does not roster 16-hour shifts"
                    : "Shift length " + length + " h");
          }
          if (PreferenceTimes.asked(times)) {
            boolean impossibleNight = times.contains("NIGHT") && (length == null || length == 8);
            boolean mismatch =
                shifts.stream()
                    .anyMatch(
                        shift ->
                            !PreferenceTimes.matches(
                                times,
                                ShiftKinds.timeOfDay((java.sql.Time) shift.get("start_time"))));
            if (impossibleNight) {
              unmet.add("Time of day NIGHT: only 12-hour officers work nights");
            } else if (mismatch) {
              unmet.add("Time of day " + String.join(", ", times));
            }
          }
          if (!days.isEmpty()
              && shifts.stream()
                  .anyMatch(
                      shift ->
                          days.contains(
                              ((java.sql.Date) shift.get("work_date"))
                                  .toLocalDate()
                                  .getDayOfWeek()
                                  .name()
                                  .substring(0, 3)))) {
            unmet.add("Preferred days off");
          }
          boolean askedSomething =
              length != null || !times.isEmpty() || !days.isEmpty();
          String status =
              planId == null
                  ? "NO_DRAFT"
                  : shifts.isEmpty() && askedSomething
                      ? "NOT_ROSTERED"
                      : !askedSomething
                          ? "NONE"
                          : unmet.isEmpty() ? "MET" : unmet.size() >= 2 ? "NOT_MET" : "PARTLY";
          Timestamp updated = rs.getTimestamp("updated_at");
          return new PlannerViews.PreferenceView(
              employeeId,
              rs.getString("name"),
              rs.getString("employee_no"),
              rs.getString("unit_name"),
              rs.getDate("seniority_date").toLocalDate(),
              length,
              times,
              days,
              rs.getInt("max_days_off"),
              pattern,
              PlanGenerator.patternWords(pattern),
              effective == 8,
              status,
              unmet,
              updated == null ? null : updated.toInstant().toString());
        },
        args);
  }

  /**
   * The planner sets an 8 h officer's pattern. A 12 h officer's pattern is the crew cycle and is
   * read-only; the next generate uses the new value, exactly as a preference change does.
   */
  @Transactional
  public PlannerViews.PreferenceView setOfficerPattern(
      UUID employeeId, String pattern, AuthPrincipal principal) {
    Map<String, Object> row =
        jdbc.queryForList(
                "SELECT e.id, e.shift_pattern, e.fte, p.shift_length, u.allows_12h, rp.code AS crew"
                    + " FROM employee e JOIN unit u ON u.id = e.home_unit_id"
                    + " LEFT JOIN officer_preference p ON p.employee_id = e.id"
                    + " LEFT JOIN rotation_pattern rp ON rp.id = e.rotation_pattern_id"
                    + " WHERE e.id = ?",
                employeeId)
            .stream()
            .findFirst()
            .orElse(null);
    if (row == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown officer");
    }
    int effective =
        effectiveLength(
            (String) row.get("crew"),
            row.get("shift_length") == null ? null : ((Number) row.get("shift_length")).intValue(),
            Boolean.TRUE.equals(row.get("allows_12h")));
    if (effective != 8) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "A 12-hour officer keeps the crew's 4 on, 4 off pattern");
    }
    if ("4_ON_4_OFF".equals(pattern)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "A 12-hour pattern cannot be given to an 8-hour officer");
    }
    if (pattern == null || !PATTERNS.contains(pattern)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "pattern must be ROTATING_5_2, 5_ON_2_OFF or 7_ON_3_OFF");
    }
    String from = row.get("shift_pattern") == null ? "ROTATING_5_2" : (String) row.get("shift_pattern");
    jdbc.update(
        "UPDATE employee SET shift_pattern = ?, version = version + 1 WHERE id = ?",
        pattern,
        employeeId);
    audit(
        principal,
        "set_officer_pattern",
        "employee",
        employeeId,
        Map.of("from", from, "to", pattern));
    return preferences(null).stream()
        .filter(view -> view.employeeId().equals(employeeId))
        .findFirst()
        .orElseThrow();
  }

  public PlannerViews.MyPreferences myPreferences(AuthPrincipal principal) {
    UUID employeeId = requireEmployee(principal);
    Map<String, Object> row =
        jdbc.queryForList(
                "SELECT p.* FROM officer_preference p WHERE p.employee_id = ?", employeeId)
            .stream()
            .findFirst()
            .orElse(Map.of());
    return new PlannerViews.MyPreferences(
        row.get("shift_length") == null ? null : ((Number) row.get("shift_length")).intValue(),
        row.get("times_of_day") == null ? List.of() : timesOfDay((Array) row.get("times_of_day")),
        row.get("days_off") == null
            ? List.of()
            : daysOff((Array) row.get("days_off")),
        2,
        // L16 is retired (ADR-029): 16 h is no longer offered. A stored 16 h wish still reads
        // back and saves unchanged; the card shows it as unavailable.
        List.of(8, 12),
        row.get("updated_at") == null ? null : ((Timestamp) row.get("updated_at")).toInstant().toString());
  }

  @Transactional
  public PlannerViews.MyPreferences saveMyPreferences(
      PlannerViews.PreferenceInput input, AuthPrincipal principal) {
    UUID employeeId = requireEmployee(principal);
    if (input.shiftLength() != null && !List.of(8, 12, 16).contains(input.shiftLength())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "shiftLength must be 8, 12, 16 or null");
    }
    List<String> times;
    try {
      times =
          input.timesOfDay() != null
              ? PreferenceTimes.normalize(input.timesOfDay())
              : PreferenceTimes.fromLegacy(input.timeOfDay());
    } catch (IllegalArgumentException invalid) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, invalid.getMessage());
    }
    List<String> days =
        input.daysOff() == null
            ? List.of()
            : input.daysOff().stream()
                .map(day -> day == null ? "" : day.toUpperCase(Locale.ROOT))
                .toList();
    if (days.size() > 2) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "At most 2 days off");
    }
    for (String day : days) {
      if (!WEEKDAYS.contains(day)) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "daysOff uses MON..SUN");
      }
    }
    jdbc.update(
        connection -> {
          var statement =
              connection.prepareStatement(
                  "INSERT INTO officer_preference (employee_id, shift_length, times_of_day, days_off,"
                      + " max_days_off, updated_at, updated_by) VALUES (?, ?, ?, ?, 2, now(),"
                      + " (SELECT id FROM app_user WHERE username = ?))"
                      + " ON CONFLICT (employee_id) DO UPDATE SET shift_length = EXCLUDED.shift_length,"
                      + " times_of_day = EXCLUDED.times_of_day, days_off = EXCLUDED.days_off,"
                      + " updated_at = now(), updated_by = EXCLUDED.updated_by");
          statement.setObject(1, employeeId);
          if (input.shiftLength() == null) {
            statement.setNull(2, java.sql.Types.INTEGER);
          } else {
            statement.setInt(2, input.shiftLength());
          }
          statement.setArray(3, connection.createArrayOf("text", times.toArray()));
          statement.setArray(4, connection.createArrayOf("text", days.toArray()));
          statement.setString(5, principal.username());
          return statement;
        });
    return myPreferences(principal);
  }

  @Transactional
  public void clearMyPreferences(AuthPrincipal principal) {
    UUID employeeId = requireEmployee(principal);
    jdbc.update("DELETE FROM officer_preference WHERE employee_id = ?", employeeId);
  }

  // ---------------------------------------------------------------------------------------------
  // Loading and helpers
  // ---------------------------------------------------------------------------------------------

  /** The units the generator plans, with the kind a supervisor post carries. */
  List<PlanGenerator.Unit> loadUnits() {
    Map<UUID, Map<String, Integer>> requirements = new HashMap<>();
    jdbc.query(
        "SELECT unit_id, block, min_staff FROM unit_requirement WHERE effective_to IS NULL",
        rs -> {
          requirements
              .computeIfAbsent(rs.getObject("unit_id", UUID.class), key -> new LinkedHashMap<>())
              .put(rs.getString("block"), rs.getInt("min_staff"));
        });
    return jdbc.query(
        "SELECT id, code, name, kind, allows_12h, allows_16h FROM unit ORDER BY code",
        (rs, row) ->
            new PlanGenerator.Unit(
                rs.getObject("id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getBoolean("allows_12h"),
                rs.getBoolean("allows_16h"),
                requirements.getOrDefault(rs.getObject("id", UUID.class), Map.of()),
                rs.getString("kind")));
  }

  /**
   * The shift length the planner rosters: a 12 h crew is 12 h whatever the wish says; otherwise a
   * 12/16 h wish becomes 12 h only in a unit that allows 12 h, and 16 h is never rostered.
   */
  private static int effectiveLength(String crew, Integer preferred, boolean allows12h) {
    if (crew != null
        && (crew.startsWith("N12")
            || crew.startsWith("D12")
            || crew.startsWith("CASUAL_12"))) {
      return 12;
    }
    if (crew != null
        && (crew.startsWith("D8")
            || crew.startsWith("E8")
            || crew.startsWith("CASUAL_8"))) {
      return 8;
    }
    if (preferred != null && preferred >= 12 && allows12h) {
      return 12;
    }
    return 8;
  }

  /** The officers the generator plans, with their position and their seniority inside the rank. */
  List<PlanGenerator.Employee> loadEmployees(List<PlanGenerator.Unit> units) {
    Map<UUID, PlanGenerator.Unit> byId = new HashMap<>();
    units.forEach(unit -> byId.put(unit.id(), unit));
    Map<UUID, Integer> phases = new HashMap<>();
    return jdbc.query(
        "SELECT e.id, e.employee_no, e.first_name || ' ' || e.last_name AS name,"
            + " e.home_unit_id, e.seniority_date, e.position_since, e.classification, e.fte,"
            + " e.shift_pattern,"
            + " p.shift_length, p.times_of_day, p.days_off,"
            + " rp.code AS crew"
            + " FROM employee e LEFT JOIN officer_preference p ON p.employee_id = e.id"
            + " LEFT JOIN rotation_pattern rp ON rp.id = e.rotation_pattern_id"
            + " ORDER BY e.home_unit_id, e.employee_no",
        (rs, row) -> {
          UUID unitId = rs.getObject("home_unit_id", UUID.class);
          PlanGenerator.Unit unit = byId.get(unitId);
          int index = phases.merge(unitId, 1, Integer::sum) - 1;
          Integer preferred = rs.getObject("shift_length", Integer.class);
          String crew = rs.getString("crew");
          int effective = effectiveLength(crew, preferred, unit.allows12h());
          LocalDate service = rs.getDate("seniority_date").toLocalDate();
          // Seniority inside the rank: null until an officer is promoted, so it is the service date
          // for every officer there is today.
          Date promoted = rs.getDate("position_since");
          return new PlanGenerator.Employee(
              rs.getObject("id", UUID.class),
              rs.getString("employee_no"),
              rs.getString("name"),
              unitId,
              unit.code(),
              service,
              rs.getDouble("fte"),
              new PlanGenerator.Pref(preferred, timesOfDay(rs.getArray("times_of_day")), daysOff(rs.getArray("days_off"))),
              effective,
              index % 7,
              crew,
              rs.getString("shift_pattern"),
              // A rank this build does not know is treated as the lowest, non-supervisory one, so
              // it can never make the planner treat someone as a supervisor by accident.
              Position.fromCodeOrDefault(rs.getString("classification")),
              promoted == null ? service : promoted.toLocalDate());
        });
  }

  private Map<String, PlanGenerator.Template> loadTemplates() {
    Map<String, PlanGenerator.Template> templates = new LinkedHashMap<>();
    jdbc.query(
        "SELECT id, code, start_time, duration_minutes FROM shift_template",
        rs -> {
          templates.put(
              rs.getString("code"),
              new PlanGenerator.Template(
                  rs.getObject("id", UUID.class),
                  rs.getString("code"),
                  rs.getTime("start_time").toLocalTime(),
                  rs.getInt("duration_minutes")));
        });
    return templates;
  }

  /** Planned absences in the quarter: employee -> dates they are unavailable. Read-only input. */
  private Map<UUID, java.util.Set<LocalDate>> loadLeave() {
    return leaveSets(loadLeaveDays());
  }

  private static Map<UUID, java.util.Set<LocalDate>> leaveSets(List<PlanInputs.LeaveDay> days) {
    Map<UUID, java.util.Set<LocalDate>> leave = new HashMap<>();
    for (PlanInputs.LeaveDay day : days) {
      leave.computeIfAbsent(day.employeeId(), key -> new HashSet<>()).add(day.date());
    }
    return leave;
  }

  /**
   * The one planned-leave query: every (officer, date) in the quarter, once, with the type of the
   * first absence on it. The generator uses the dates; the inputs panel counts the types.
   */
  private List<PlanInputs.LeaveDay> loadLeaveDays() {
    Map<UUID, Map<LocalDate, String>> leave = new LinkedHashMap<>();
    jdbc.query(
        "SELECT employee_id, type, start_at, end_at FROM absence WHERE start_at < ? AND end_at > ?"
            + " ORDER BY start_at, id",
        (RowCallbackHandler)
            rs -> {
              UUID employeeId = rs.getObject("employee_id", UUID.class);
              String type = rs.getString("type");
              Instant start = rs.getTimestamp("start_at").toInstant();
              Instant end = rs.getTimestamp("end_at").toInstant();
              LocalDate startDate = start.atZone(REGINA).toLocalDate();
              LocalDate endDate = end.atZone(REGINA).toLocalDate();
              if (end.equals(endDate.atStartOfDay(REGINA).toInstant())) {
                endDate = endDate.minusDays(1);
              }
              for (LocalDate date = startDate;
                  !date.isAfter(endDate);
                  date = date.plusDays(1)) {
                if (!date.isBefore(FROM) && !date.isAfter(TO)) {
                  leave.computeIfAbsent(employeeId, key -> new LinkedHashMap<>())
                      .putIfAbsent(date, type);
                }
              }
            },
        Timestamp.from(TO.plusDays(1).atStartOfDay(REGINA).toInstant()),
        Timestamp.from(FROM.atStartOfDay(REGINA).toInstant()));
    List<PlanInputs.LeaveDay> days = new ArrayList<>();
    leave.forEach(
        (employeeId, byDate) ->
            byDate.forEach((date, type) -> days.add(new PlanInputs.LeaveDay(employeeId, date, type))));
    return days;
  }

  /**
   * PR-M: what Generate would use right now (GET /planner/inputs). The same loaders generate()
   * calls, nothing else; the options are the ones the Generate form would send (PR-N), validated
   * the same way, the defaults when omitted.
   */
  public Map<String, Object> inputs(PlannerViews.DraftCreation form) {
    PlannerViews.PlanOptions options = planOptions(form);
    List<PlanGenerator.Unit> units = loadUnits();
    return inputs(
        units, loadEmployees(units), loadLeaveDays(), DEFAULT_SEED, null, options);
  }

  private Map<String, Object> inputs(
      List<PlanGenerator.Unit> units,
      List<PlanGenerator.Employee> employees,
      List<PlanInputs.LeaveDay> leaveDays,
      long seed,
      String pattern8h,
      PlannerViews.PlanOptions planOptions) {
    Map<String, Object> options = new LinkedHashMap<>();
    options.put("seed", seed);
    // null: every 8 h officer works their own pattern (the one-release override is not sent).
    options.put("pattern8h", pattern8h);
    // PR-N tailoring options, folded in here as PR-M asked (not new top-level keys).
    options.put("staffTypes", planOptions.staffTypes());
    options.put("partTimeFill", planOptions.partTimeFill());
    options.put("crossUnitFill", planOptions.crossUnitFill());
    // The staffing floor over the whole quarter (PlanInputs.needed: the neediest stretch).
    PlanInputs.Needed needed = PlanInputs.needed(unitsService.staffingPeriods());
    return PlanInputs.build(
        FROM,
        TO,
        PlanGenerator.PERIODS,
        units,
        employees,
        leaveDays,
        activeUnits::active,
        publishedRuleSet.version(),
        needed,
        options);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> storedScorecard(Map<String, Object> draft) {
    Object raw = draft.get("scorecard");
    return raw == null ? Map.of() : mapper.readValue(raw.toString(), Map.class);
  }

  /**
   * A planner adds a future absence; it is read by the next generate, never approved or managed.
   * Repeating the same officer/date/type is idempotent (200 with the existing row); a different
   * type on the same date is a 409, not two contradictory absences.
   */
  @Transactional
  public PlannerViews.PlannedAbsenceResult planAbsence(
      UUID employeeId, LocalDate date, String type, AuthPrincipal principal) {
    if (employeeId == null || date == null || type == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "employeeId, date and type are required");
    }
    if (date.isBefore(FROM) || date.isAfter(TO)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "The absence date must be inside the plan quarter");
    }
    if (!Set.of("SICK", "VACATION", "OTHER").contains(type)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "type must be SICK, VACATION or OTHER");
    }
    Integer active =
        jdbc.queryForObject(
            "SELECT count(*) FROM employee WHERE id = ? AND active", Integer.class, employeeId);
    if (active == null || active == 0) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
    }
    Instant start = date.atStartOfDay(REGINA).toInstant();
    Instant end = date.plusDays(1).atStartOfDay(REGINA).toInstant();
    List<Map<String, Object>> existing =
        jdbc.queryForList(
            "SELECT id, type FROM absence WHERE employee_id = ? AND start_at = ? AND end_at = ?"
                + " AND shift_assignment_id IS NULL",
            employeeId,
            Timestamp.from(start),
            Timestamp.from(end));
    if (!existing.isEmpty()) {
      Map<String, Object> row = existing.get(0);
      if (type.equals(row.get("type"))) {
        return new PlannerViews.PlannedAbsenceResult(
            absenceBody((UUID) row.get("id"), employeeId, date, type), false);
      }
      throw new ResponseStatusException(
          HttpStatus.CONFLICT,
          "An absence of type "
              + row.get("type")
              + " is already recorded for that date; reset or correct it first");
    }
    UUID id = UUID.randomUUID();
    int inserted =
        jdbc.update(
            "INSERT INTO absence (id, employee_id, type, start_at, end_at, recorded_by)"
                + " VALUES (?, ?, ?, ?, ?, (SELECT id FROM app_user WHERE username = ?))"
                + " ON CONFLICT (employee_id, start_at, end_at)"
                + " WHERE shift_assignment_id IS NULL DO NOTHING",
            id,
            employeeId,
            type,
            Timestamp.from(start),
            Timestamp.from(end),
            principal.username());
    if (inserted == 0) {
      // A concurrent call won the insert. Same type is idempotent; a different type is a conflict.
      Map<String, Object> row =
          jdbc.queryForMap(
              "SELECT id, type FROM absence WHERE employee_id = ? AND start_at = ? AND end_at = ?"
                  + " AND shift_assignment_id IS NULL",
              employeeId,
              Timestamp.from(start),
              Timestamp.from(end));
      if (type.equals(row.get("type"))) {
        return new PlannerViews.PlannedAbsenceResult(
            absenceBody((UUID) row.get("id"), employeeId, date, type), false);
      }
      throw new ResponseStatusException(
          HttpStatus.CONFLICT,
          "An absence of type "
              + row.get("type")
              + " is already recorded for that date; reset or correct it first");
    }
    audit(
        principal,
        "record_absence",
        "absence",
        id,
        Map.of("employeeId", employeeId.toString(), "date", date.toString(), "type", type));
    return new PlannerViews.PlannedAbsenceResult(
        absenceBody(id, employeeId, date, type), true);
  }

  private static Map<String, Object> absenceBody(
      UUID id, UUID employeeId, LocalDate date, String type) {
    return Map.of(
        "id", id.toString(),
        "employeeId", employeeId.toString(),
        "date", date.toString(),
        "type", type);
  }

  /** The committed history for one officer; used by a draft edit's rule preview. */
  public List<ShiftFact> historyFor(UUID employeeId, Instant from, Instant to) {
    return loadHistory(from, to).getOrDefault(employeeId, List.of());
  }

  private Map<UUID, List<ShiftFact>> loadHistory(Instant from, Instant to) {
    // One resolver with the board path (RuleCheckService): the envelope of roster and actual.
    return ruleCheck.history(from, to);
  }

  private Map<String, Object> requireDraft(UUID id) {
    List<Map<String, Object>> rows =
        jdbc.queryForList("SELECT * FROM plan_draft WHERE id = ?", id);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Plan draft not found");
    }
    return rows.get(0);
  }

  private int shiftCount(UUID id) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, id);
  }

  private List<Map<String, Object>> storedWarnings(UUID id) {
    String json =
        jdbc.queryForObject(
            "SELECT warnings::text FROM plan_draft WHERE id = ?", String.class, id);
    if (json == null) {
      return List.of();
    }
    return mapper.readValue(json, List.class);
  }

  private List<Map<String, Object>> warningMaps(List<PlanGenerator.Warning> warnings) {
    List<Map<String, Object>> maps = new ArrayList<>();
    for (PlanGenerator.Warning warning : warnings) {
      Map<String, Object> map = new LinkedHashMap<>();
      map.put("ruleCode", warning.ruleCode());
      map.put("ruleName", warning.ruleName());
      map.put("message", warning.message());
      map.put("unitCode", warning.unitCode());
      map.put("employeeName", warning.employeeName());
      map.put("date", warning.date().toString());
      map.put("shift", warning.shift());
      maps.add(map);
    }
    return maps;
  }

  private PlannerViews.DraftSummary draftSummary(Map<String, Object> row) {
    Object rawScorecard = row.get("scorecard");
    String scorecardJson = rawScorecard == null ? null : rawScorecard.toString();
    Map<String, Object> scorecard =
        scorecardJson == null ? Map.of() : mapper.readValue(scorecardJson, Map.class);
    return new PlannerViews.DraftSummary(
        (UUID) row.get("id"),
        ((Number) row.get("version")).intValue(),
        ((Number) row.get("seed")).longValue(),
        (String) row.get("pattern8h"),
        (String) row.get("status"),
        ((Timestamp) row.get("created_at")).toInstant().toString(),
        (String) row.get("created_by_name"),
        ((Number) row.get("generated_ms")).intValue(),
        scorecard,
        handEdits((UUID) row.get("id")),
        editedAssignmentIds((UUID) row.get("id")),
        storedOptions(row));
  }

  /**
   * The options a stored draft was made with. V14/V15 backfill older rows with the defaults (NOT
   * NULL with defaults), so the null branches are defensive only. {@code daysOff} is the generic
   * text[] reader despite its name.
   */
  private PlannerViews.PlanOptions storedOptions(Map<String, Object> row) {
    PlannerViews.PlanOptions defaults = PlannerViews.PlanOptions.DEFAULT;
    Object types = row.get("staff_types");
    List<String> staffTypes =
        types instanceof Array array ? daysOff(array) : defaults.staffTypes();
    Object fill = row.get("part_time_fill");
    Object crossUnit = row.get("cross_unit_fill");
    return new PlannerViews.PlanOptions(
        staffTypes.isEmpty() ? defaults.staffTypes() : staffTypes,
        fill == null ? defaults.partTimeFill() : fill.toString(),
        crossUnit == null ? defaults.crossUnitFill() : crossUnit.toString());
  }

  private int handEdits(UUID draftId) {
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM audit_event WHERE action = 'edit_plan_draft'"
                + " AND after ->> 'draftId' = ?",
            Integer.class,
            draftId.toString());
    return count == null ? 0 : count;
  }

  private List<UUID> editedAssignmentIds(UUID draftId) {
    return jdbc.queryForList(
        "SELECT DISTINCT (a.after ->> 'assignmentId')::uuid FROM audit_event a"
            + " JOIN plan_draft_assignment d ON d.id = (a.after ->> 'assignmentId')::uuid"
            + " WHERE a.action = 'edit_plan_draft' AND a.after ->> 'draftId' = ?"
            + " AND d.draft_id = ?",
        UUID.class,
        draftId.toString(),
        draftId);
  }

  private PlannerViews.LastCommitted lastCommitted(Map<String, Object> row) {
    UUID draftId = (UUID) row.get("id");
    int shifts = jdbc.queryForObject(
        "SELECT count(*) FROM shift_assignment WHERE plan_draft_id = ?", Integer.class, draftId);
    return new PlannerViews.LastCommitted(
        draftId,
        ((Timestamp) row.get("committed_at")).toInstant().toString(),
        (String) row.get("committed_by_name"),
        shifts);
  }

  private static Set<String> warningKeys(RuleCheckService.OutcomeView outcome) {
    Set<String> keys = new java.util.HashSet<>();
    outcome.ruleResults().stream()
        .filter(result -> "WARN".equals(result.outcome()))
        .forEach(result -> keys.add(warningKey(result)));
    return keys;
  }

  private static String warningKey(RuleCheckService.ResultView result) {
    return result.ruleCode()
        + "|"
        + result.evidence().stream()
            .map(RuleCheckService.EvidenceView::label)
            .toList();
  }

  private UUID requireEmployee(AuthPrincipal principal) {
    if (principal.employeeId() == null) {
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, "This account is not linked to an officer");
    }
    return principal.employeeId();
  }

  private List<String> daysOff(Array array) {
    if (array == null) {
      return List.of();
    }
    try {
      Object raw = array.getArray();
      if (raw instanceof String[] values) {
        return List.of(values);
      }
      if (raw instanceof Object[] values) {
        return java.util.Arrays.stream(values).map(String::valueOf).toList();
      }
      return List.of();
    } catch (Exception unreadable) {
      return List.of();
    }
  }

  private List<String> timesOfDay(Array array) {
    try {
      return PreferenceTimes.normalize(daysOff(array));
    } catch (IllegalArgumentException invalid) {
      // The V9 CHECK makes this unreachable; a hand-edited row is read as no preference.
      return List.of();
    }
  }

  private void audit(
      AuthPrincipal principal, String action, String entityType, UUID entityId, Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, ?, ?, ?::jsonb)",
        principal.username(),
        action,
        entityType,
        entityId,
        mapper.writeValueAsString(after));
  }
}
