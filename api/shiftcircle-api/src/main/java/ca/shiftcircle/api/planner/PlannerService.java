package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.sql.Array;
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
  private final ObjectMapper mapper = new ObjectMapper();

  public PlannerService(JdbcTemplate jdbc, RuleCheckService ruleCheck) {
    this.jdbc = jdbc;
    this.ruleCheck = ruleCheck;
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
                "SELECT d.*, u.display_name AS committed_by_name FROM plan_draft d"
                    + " LEFT JOIN app_user u ON u.id = d.committed_by"
                    + " WHERE d.status = 'COMMITTED' ORDER BY d.committed_at DESC LIMIT 1")
            .stream()
            .findFirst()
            .orElse(null);
    return new PlannerViews.PlanState(
        new PlannerViews.Window(FROM, TO, PlanGenerator.PERIODS),
        DEFAULT_SEED,
        PATTERNS,
        open == null ? "NONE" : "DRAFT",
        open == null ? null : draftSummary(open),
        committed == null ? null : lastCommitted(committed));
  }

  @Transactional
  public PlannerViews.DraftSummary generate(
      PlannerViews.DraftCreation creation, AuthPrincipal principal) {
    long seed = creation.seed() == 0 ? DEFAULT_SEED : creation.seed();
    String pattern = creation.pattern8h() == null ? "ROTATING_5_2" : creation.pattern8h();
    if (!PATTERNS.contains(pattern)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "pattern8h must be ROTATING_5_2, 5_ON_2_OFF or 7_ON_3_OFF");
    }
    jdbc.update("DELETE FROM plan_draft WHERE status = 'DRAFT'");

    List<PlanGenerator.Unit> units = loadUnits();
    List<PlanGenerator.Employee> employees = loadEmployees(units);
    Map<String, PlanGenerator.Template> templates = loadTemplates();
    Map<UUID, List<ShiftFact>> history =
        loadHistory(
            FROM.minusDays(35).atStartOfDay(REGINA).toInstant(),
            FROM.atStartOfDay(REGINA).toInstant());
    // Warnings the seeded history already has are not this plan's warnings: subtract them so the
    // scorecard counts what the draft adds, not the same history window repeated per proposal.
    Map<UUID, Set<String>> baselineWarnings = new HashMap<>();
    history.forEach(
        (employeeId, shifts) ->
            baselineWarnings.put(employeeId, warningKeys(ruleCheck.evaluateFacts(shifts))));

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
          RuleCheckService.OutcomeView outcome = ruleCheck.evaluate(proposed, current);
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
    PlanGenerator.Result result =
        new PlanGenerator()
            .generate(employees, units, templates, history, pattern, seed, verifier);
    int generatedMs = (int) ((System.nanoTime() - before) / 1_000_000);

    UUID id = UUID.randomUUID();
    String scorecardJson = mapper.writeValueAsString(result.scorecard());
    String warningsJson = mapper.writeValueAsString(warningMaps(result.warnings()));
    jdbc.update(
        "INSERT INTO plan_draft (id, from_date, to_date, seed, pattern8h, status, version,"
            + " created_by, generated_ms, scorecard, warnings, warning_count)"
            + " VALUES (?, ?, ?, ?, ?, 'DRAFT', 0, (SELECT id FROM app_user WHERE username = ?),"
            + " ?, ?::jsonb, ?::jsonb, ?)",
        id,
        FROM,
        TO,
        seed,
        pattern,
        principal.username(),
        generatedMs,
        scorecardJson,
        warningsJson,
        result.warnings().size());
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

    audit(principal, "generate_plan", "plan_draft", id, Map.of("assignments", result.assignments().size(), "gaps", result.gaps().size(), "warnings", result.warnings().size(), "seed", seed, "pattern8h", pattern, "generatedMs", generatedMs));

    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT d.*, u.display_name AS created_by_name FROM plan_draft d"
                + " LEFT JOIN app_user u ON u.id = d.created_by WHERE d.id = ?",
            id);
    return draftSummary(row);
  }

  public PlannerViews.DraftSummary draft(UUID id) {
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT d.*, u.display_name AS created_by_name FROM plan_draft d"
                + " LEFT JOIN app_user u ON u.id = d.created_by WHERE d.id = ?",
            id);
    return draftSummary(row);
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
    Map<String, Object> counts =
        jdbc.queryForMap(
            "SELECT count(*) AS shifts, count(DISTINCT employee_id) AS officers"
                + " FROM plan_draft_assignment WHERE draft_id = ?",
            id);
    int gaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ?", Integer.class, id);
    return new PlannerViews.CommitPreview(
        ((Number) draft.get("version")).intValue(),
        ((Number) counts.get("shifts")).intValue(),
        ((Number) counts.get("officers")).intValue(),
        gaps,
        ((Number) draft.get("warning_count")).intValue(),
        ((java.sql.Date) draft.get("from_date")).toLocalDate(),
        ((java.sql.Date) draft.get("to_date")).toLocalDate());
  }

  @Transactional
  public PlannerViews.DiscardResult discard(UUID id, AuthPrincipal principal) {
    Map<String, Object> draft = requireDraft(id);
    if (!"DRAFT".equals(draft.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a draft can be discarded");
    }
    jdbc.update(
        "UPDATE plan_draft SET status = 'DISCARDED', version = version + 1 WHERE id = ?", id);
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
        jdbc.queryForMap("SELECT id, name FROM unit WHERE id = ?", unitId);
    Map<String, Integer> required = required(unitId);
    List<Map<String, Object>> planned = plannedForUnit(id, unitId, from, to);
    List<LocalDate> days = days(from, to);
    List<ca.shiftcircle.api.schedule.ScheduleQuery.BlockCoverage> coverage =
        coverageFor(required, planned, days, true);

    Map<UUID, List<Map<String, Object>>> byOfficer = new LinkedHashMap<>();
    Map<UUID, Map<String, Object>> officerRows = new LinkedHashMap<>();
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      officerRows.putIfAbsent(employeeId, row);
      byOfficer.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(row);
    }
    Map<UUID, List<String>> qualifications = qualifications(officerRows.keySet());
    String pattern = (String) draft.get("pattern8h");
    LocalDate periodStart =
        ((java.sql.Date) draft.get("from_date")).toLocalDate()
            .plusDays((java.time.temporal.ChronoUnit.DAYS.between(
                        ((java.sql.Date) draft.get("from_date")).toLocalDate(), from) / 14) * 14);
    LocalDate periodEnd = periodStart.plusDays(13);
    List<ca.shiftcircle.api.schedule.ScheduleQuery.OfficerRow> officers = new ArrayList<>();
    officerRows.forEach(
        (employeeId, row) -> {
          Map<LocalDate, List<ca.shiftcircle.api.schedule.ScheduleQuery.ShiftItem>> cells =
              new LinkedHashMap<>();
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
                        0));
          }
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
                  dayCells));
        });
    return new ca.shiftcircle.api.schedule.ScheduleQuery.SchedulePayload(
        new ca.shiftcircle.api.schedule.ScheduleQuery.UnitView(unitId, (String) unit.get("name")),
        from,
        to,
        days,
        LocalDate.now(REGINA).toString(),
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
    for (Map<String, Object> unit : jdbc.queryForList("SELECT id, name FROM unit ORDER BY code")) {
      UUID unitId = (UUID) unit.get("id");
      List<Map<String, Object>> planned = plannedForUnit(id, unitId, from, to);
      result.add(
          new PlannerViews.UnitCoverage(
              unitId,
              (String) unit.get("name"),
              coverageFor(required(unitId), planned, days, false)));
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

  private List<Map<String, Object>> plannedForUnit(
      UUID draftId, UUID unitId, LocalDate from, LocalDate to) {
    return jdbc.queryForList(
        "SELECT a.id, a.employee_id, a.work_date, a.start_at, a.end_at,"
            + " e.first_name || ' ' || e.last_name AS employee_name,"
            + " t.code AS template_code, t.duration_minutes"
            + " FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
            + " JOIN shift_template t ON t.id = a.shift_template_id"
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
    return switch (pattern8h) {
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
            FROM.minusDays(35).atStartOfDay(REGINA).toInstant(),
            TO.plusDays(1).atStartOfDay(REGINA).toInstant());
    Map<UUID, Set<String>> baselineWarnings = new HashMap<>();
    facts.forEach(
        (employeeId, shifts) ->
            baselineWarnings.put(employeeId, warningKeys(ruleCheck.evaluateFacts(shifts))));
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
          ruleCheck.evaluate(proposed, facts.getOrDefault(employeeId, List.of()));
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
    jdbc.update(
        "UPDATE plan_draft SET status = 'COMMITTED', version = version + 1,"
            + " committed_at = now(), committed_by = (SELECT id FROM app_user WHERE username = ?)"
            + " WHERE id = ?",
        principal.username(),
        id);
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
                    "officers", jdbc.queryForObject(
                        "SELECT count(DISTINCT employee_id) FROM plan_draft_assignment WHERE draft_id = ?",
                        Integer.class, id),
                    "warnings", warnings,
                    "units", units)));
    return new CommitAttempt(
        HttpStatus.OK.value(),
        new PlannerViews.CommitResult(
            rows.size(),
            LocalDate.now(REGINA).toString(),
            auditId,
            units,
            ((java.sql.Date) draft.get("from_date")).toLocalDate()));
  }

  public PlannerViews.CompareView compare(UUID id) {
    requireDraft(id);
    int draftShifts =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, id);
    int draftGaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ?", Integer.class, id);
    int committed =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment WHERE status <> 'CANCELLED'"
                + " AND work_date BETWEEN ? AND ?",
            Integer.class,
            FROM,
            TO);
    List<PlannerViews.CompareRow> rows =
        List.of(
            new PlannerViews.CompareRow("shifts", "Shifts", committed, draftShifts, "count", "NEUTRAL"),
            new PlannerViews.CompareRow("gaps", "Coverage gaps", 0, draftGaps, "count", "LOWER_IS_BETTER"));
    return new PlannerViews.CompareView(draftShifts, draftGaps, committed, rows);
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
      UUID payPeriod = UUID.nameUUIDFromBytes(("plan-pay:" + start).getBytes(java.nio.charset.StandardCharsets.UTF_8));
      jdbc.update(
          "INSERT INTO pay_period (id, start_date, end_date, status)"
              + " SELECT ?, ?, ?, 'OPEN' WHERE NOT EXISTS"
              + " (SELECT 1 FROM pay_period WHERE start_date = ? AND end_date = ?)",
          payPeriod,
          start,
          end,
          start,
          end);
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
    Map<UUID, List<Map<String, Object>>> inDraft = new HashMap<>();
    if (draftId != null) {
      jdbc.queryForList(
              "SELECT a.employee_id, t.code, a.work_date FROM plan_draft_assignment a"
                  + " JOIN shift_template t ON t.id = a.shift_template_id WHERE a.draft_id = ?",
              draftId)
          .forEach(row ->
              inDraft
                  .computeIfAbsent((UUID) row.get("employee_id"), key -> new ArrayList<>())
                  .add(row));
    }
    String sql =
        "SELECT e.id, e.employee_no, e.first_name || ' ' || e.last_name AS name,"
            + " u.name AS unit_name, e.seniority_date, p.shift_length, p.time_of_day, p.days_off,"
            + " p.max_days_off, p.updated_at"
            + " FROM employee e JOIN unit u ON u.id = e.home_unit_id"
            + " LEFT JOIN officer_preference p ON p.employee_id = e.id"
            + (unitCode == null ? "" : " WHERE u.code = ?")
            + " ORDER BY u.code, e.employee_no";
    Object[] args = unitCode == null ? new Object[] {} : new Object[] {unitCode};
    return jdbc.query(
        sql,
        (rs, row) -> {
          UUID employeeId = rs.getObject("id", UUID.class);
          List<String> days = daysOff(rs.getArray("days_off"));
          Integer length = rs.getObject("shift_length", Integer.class);
          String time = rs.getString("time_of_day");
          List<Map<String, Object>> shifts = inDraft.getOrDefault(employeeId, List.of());
          List<String> unmet = new ArrayList<>();
          if (length != null
              && shifts.stream()
                  .anyMatch(shift -> nominalMinutes((String) shift.get("code")) != length * 60)) {
            unmet.add(
                length == 16
                    ? "Shift length 16 h: the planner does not roster 16-hour shifts"
                    : "Shift length " + length + " h");
          }
          if (time != null
              && !"NONE".equals(time)
              && shifts.stream()
                  .anyMatch(shift -> !time.equals(preferenceOf((String) shift.get("code"))))) {
            unmet.add("Time of day " + time);
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
          String status =
              draftId == null
                  ? "NO_DRAFT"
                  : length == null && time == null && days.isEmpty()
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
              time,
              days,
              rs.getInt("max_days_off"),
              status,
              unmet,
              updated == null ? null : updated.toInstant().toString());
        },
        args);
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
        (String) row.get("time_of_day"),
        row.get("days_off") == null
            ? List.of()
            : daysOff((Array) row.get("days_off")),
        2,
        List.of(8, 12, 16),
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
    String time = input.timeOfDay() == null ? null : input.timeOfDay().toUpperCase(Locale.ROOT);
    if (time != null && !TIMES.contains(time)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "timeOfDay must be DAY, EVENING, NIGHT, NONE or null");
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
                  "INSERT INTO officer_preference (employee_id, shift_length, time_of_day, days_off,"
                      + " max_days_off, updated_at, updated_by) VALUES (?, ?, ?, ?, 2, now(),"
                      + " (SELECT id FROM app_user WHERE username = ?))"
                      + " ON CONFLICT (employee_id) DO UPDATE SET shift_length = EXCLUDED.shift_length,"
                      + " time_of_day = EXCLUDED.time_of_day, days_off = EXCLUDED.days_off,"
                      + " updated_at = now(), updated_by = EXCLUDED.updated_by");
          statement.setObject(1, employeeId);
          if (input.shiftLength() == null) {
            statement.setNull(2, java.sql.Types.INTEGER);
          } else {
            statement.setInt(2, input.shiftLength());
          }
          statement.setString(3, time);
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

  private List<PlanGenerator.Unit> loadUnits() {
    Map<UUID, Map<String, Integer>> requirements = new HashMap<>();
    jdbc.query(
        "SELECT unit_id, block, min_staff FROM unit_requirement WHERE effective_to IS NULL",
        rs -> {
          requirements
              .computeIfAbsent(rs.getObject("unit_id", UUID.class), key -> new LinkedHashMap<>())
              .put(rs.getString("block"), rs.getInt("min_staff"));
        });
    return jdbc.query(
        "SELECT id, code, name, allows_12h, allows_16h FROM unit ORDER BY code",
        (rs, row) ->
            new PlanGenerator.Unit(
                rs.getObject("id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getBoolean("allows_12h"),
                rs.getBoolean("allows_16h"),
                requirements.getOrDefault(rs.getObject("id", UUID.class), Map.of())));
  }

  private List<PlanGenerator.Employee> loadEmployees(List<PlanGenerator.Unit> units) {
    Map<UUID, PlanGenerator.Unit> byId = new HashMap<>();
    units.forEach(unit -> byId.put(unit.id(), unit));
    Map<UUID, Integer> phases = new HashMap<>();
    return jdbc.query(
        "SELECT e.id, e.employee_no, e.first_name || ' ' || e.last_name AS name,"
            + " e.home_unit_id, e.seniority_date, p.shift_length, p.time_of_day, p.days_off"
            + " FROM employee e LEFT JOIN officer_preference p ON p.employee_id = e.id"
            + " ORDER BY e.home_unit_id, e.employee_no",
        (rs, row) -> {
          UUID unitId = rs.getObject("home_unit_id", UUID.class);
          PlanGenerator.Unit unit = byId.get(unitId);
          int index = phases.merge(unitId, 1, Integer::sum) - 1;
          Integer preferred = rs.getObject("shift_length", Integer.class);
          int effective = 8;
          // The planner does not roster 16-hour patterns: a 16 h preference is stored, shown
          // unmet with that reason, and planned as 12 h (or 8 h) so no L16 is generated.
          if (preferred != null && preferred >= 12 && unit.allows12h()) {
            effective = 12;
          }
          return new PlanGenerator.Employee(
              rs.getObject("id", UUID.class),
              rs.getString("employee_no"),
              rs.getString("name"),
              unitId,
              unit.code(),
              rs.getDate("seniority_date").toLocalDate(),
              new PlanGenerator.Pref(preferred, rs.getString("time_of_day"), daysOff(rs.getArray("days_off"))),
              effective,
              index % 7);
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

  /** Committed assignments around the window; the planner verifies against these, not the draft. */
  private Map<UUID, List<ShiftFact>> loadHistory(Instant from, Instant to) {
    Map<UUID, List<ShiftFact>> history = new HashMap<>();
    // Committed history with a recorded actual is the shift that happened: the
    // planner's rest and hours checks read it the way the board's do.
    jdbc.query(
        "SELECT s.employee_id, e.employee_no, u.code AS unit_code, u.allows_12h, u.allows_16h,"
            + " t.code AS template_code, t.duration_minutes,"
            + " coalesce(te.start_at, s.start_at) AS start_at,"
            + " coalesce(te.end_at, s.end_at) AS end_at, s.kind"
            + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
            + " JOIN unit u ON u.id = s.unit_id JOIN shift_template t ON t.id = s.shift_template_id"
            + " LEFT JOIN LATERAL (SELECT start_at, end_at FROM time_entry"
            + "   WHERE shift_assignment_id = s.id AND entry_type = 'ACTUAL'"
            + "   AND absence_type IS NULL ORDER BY created_at DESC LIMIT 1) te ON true"
            + " WHERE s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?",
        (RowCallbackHandler)
            rs ->
                history
                    .computeIfAbsent(rs.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                .add(
                    new ShiftFact(
                        rs.getObject("employee_id", UUID.class).toString(),
                        rs.getString("employee_no"),
                        rs.getString("unit_code"),
                        rs.getString("template_code"),
                        rs.getTimestamp("start_at").toInstant(),
                        rs.getTimestamp("end_at").toInstant(),
                        "EXTRA".equals(rs.getString("kind")) ? ShiftKind.EXTRA : ShiftKind.ROSTERED,
                        extensionMinutes(
                            rs.getTimestamp("start_at").toInstant(),
                            rs.getTimestamp("end_at").toInstant(),
                            rs.getInt("duration_minutes")),
                        rs.getBoolean("allows_12h"),
                        rs.getBoolean("allows_16h"))),
        Timestamp.from(to),
        Timestamp.from(from));
    return history;
  }

  /** Minutes a shift runs beyond its template, when an actual end makes it longer. */
  private static int extensionMinutes(Instant start, Instant end, int templateMinutes) {
    return (int) Math.max(0, Duration.between(start, end).toMinutes() - templateMinutes);
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
        scorecard);
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

  private static String preferenceOf(String templateCode) {
    return switch (templateCode) {
      case "D8" -> "DAY";
      case "E8", "P12" -> "EVENING";
      case "N8", "A12", "L16" -> "NIGHT";
      default -> "DAY";
    };
  }

  private static int nominalMinutes(String templateCode) {
    return switch (templateCode) {
      case "D8", "E8", "N8" -> 480;
      case "A12", "P12" -> 720;
      case "L16" -> 960;
      default -> 480;
    };
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
