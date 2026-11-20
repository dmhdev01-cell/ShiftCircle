package ca.shiftcircle.api.rulesets;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.rules.RuleCompilationException;
import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.RuleSetCompiler;
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
import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import ca.shiftcircle.rules.scenario.RuleScenarioRunner;
import ca.shiftcircle.rules.validate.RuleRowValidator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.kie.api.KieBase;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * The safe change pipeline from docs/04 §6 and docs/07 §4.7: drafts, validation, compilation, the
 * scenario library, a counts-only dry run, maker/checker approval and a hot-swapped publish.
 *
 * <p>Nothing here decides a schedule; it decides which rules are allowed to run. A failed step
 * leaves the live rule base untouched, and a version whose rows changed after its build cannot be
 * submitted or published (the row fingerprint is checked again).
 */
@Service
public class RuleSetService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  public record Columns(String after, String hours, String result, String override) {}

  public record RowView(
      String ruleCode, boolean enabled, String after, double minHours, String result,
      String override, String source, Double min, String sentence, Map<String, Object> params) {}

  public record TableView(
      String code, String name, Columns columns, List<RowView> rows, int changed) {}

  public record VersionView(
      int version, String status, boolean live, String createdBy, String createdAt, String reason,
      String approvedBy, String approvedAt, String publishedAt) {}

  public record ImpactView(String ruleCode, String unit, String from, String to, long count) {}

  public record BuildStepView(
      String key, String title, String detail, boolean done, List<ImpactView> impact) {}

  public record ScenarioCounts(int total, int passed) {}

  public record BuildReportView(
      List<BuildStepView> steps, ScenarioCounts scenarios, List<String> errors) {}

  private final JdbcTemplate jdbc;
  private final RuleSetCompiler compiler;
  private final PublishedRuleSet live;
  private final RuleRowsRepository rowsRepository;
  private final RuleEvaluator evaluator = new RuleEvaluator();
  private final RuleRowValidator validator = new RuleRowValidator();
  private final RuleScenarioRunner scenarios = new RuleScenarioRunner();
  private final ObjectMapper mapper = new ObjectMapper();

  public RuleSetService(
      JdbcTemplate jdbc,
      RuleSetCompiler compiler,
      PublishedRuleSet live,
      RuleRowsRepository rowsRepository) {
    this.jdbc = jdbc;
    this.compiler = compiler;
    this.live = live;
    this.rowsRepository = rowsRepository;
  }

  // ---------------------------------------------------------------------------------------------
  // Versions and tables
  // ---------------------------------------------------------------------------------------------

  public List<VersionView> versions() {
    return jdbc.query(
        "SELECT v.version, v.status, v.created_by, v.submitted_at, v.change_reason,"
            + " v.approved_at, v.published_at, u.display_name AS created_by_name,"
            + " a.display_name AS approved_by_name"
            + " FROM rule_set_version v"
            + " LEFT JOIN app_user u ON u.id = v.created_by"
            + " LEFT JOIN app_user a ON a.id = v.approved_by"
            + " ORDER BY v.version DESC",
        (rs, rowNum) ->
            new VersionView(
                rs.getInt("version"),
                rs.getString("status"),
                "PUBLISHED".equals(rs.getString("status")),
                rs.getString("created_by_name"),
                instant(rs.getTimestamp("submitted_at")),
                rs.getString("change_reason"),
                rs.getString("approved_by_name"),
                instant(rs.getTimestamp("approved_at")),
                instant(rs.getTimestamp("published_at"))));
  }

  public TableView table(int version, String tableCode) {
    Map<String, Object> versionRow = versionRow(version);
    RuleTableCode table = RuleTableCode.fromCode(tableCode);
    Map<String, Object> tableRow =
        jdbc.queryForMap(
            "SELECT name, column_schema::text AS schema FROM rule_table WHERE code = ?",
            table.code());
    Map<String, Object> schema = readMap((String) tableRow.get("schema"));
    List<RuleRow> rows = rowsRepository.rows((UUID) versionRow.get("id"), table);
    int changed = changedCount((UUID) versionRow.get("id"), versionRow.get("based_on_version"));

    List<RowView> views = new ArrayList<>();
    for (RuleRow row : rows) {
      views.add(rowView(row, schema));
    }
    return new TableView(
        table.code(),
        (String) tableRow.get("name"),
        new Columns("After this kind of shift", "Hours", "If not", "Override"),
        views,
        changed);
  }

  // ---------------------------------------------------------------------------------------------
  // Draft editing
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public VersionView createDraft(Integer basedOn, String reason, AuthPrincipal principal) {
    if (basedOn == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "basedOn is required");
    }
    Map<String, Object> base = versionRow(basedOn);
    UUID id = UUID.randomUUID();
    Integer next =
        jdbc.queryForObject("SELECT coalesce(max(version), 0) + 1 FROM rule_set_version",
            Integer.class);
    jdbc.update(
        "INSERT INTO rule_set_version (id, version, status, based_on_version, effective_from,"
            + " change_reason, created_by) VALUES (?, ?, 'DRAFT', ?, ?, ?,"
            + " (SELECT id FROM app_user WHERE username = ?))",
        id,
        next,
        basedOn,
        base.get("effective_from"),
        reason,
        principal.username());
    jdbc.update(
        "INSERT INTO rule_row (rule_set_version_id, rule_table_id, code, enabled, params, severity,"
            + " override_policy, message, source, is_placeholder, sort_order)"
            + " SELECT ?, rule_table_id, code, enabled, params, severity, override_policy, message,"
            + " source, is_placeholder, sort_order FROM rule_row WHERE rule_set_version_id = ?",
        id,
        base.get("id"));
    audit(principal, "rule_set_draft", id, Map.of("basedOn", basedOn, "reason",
        reason == null ? "" : reason));
    return versions().stream()
        .filter(view -> view.version() == next)
        .findFirst()
        .orElseThrow();
  }

  @Transactional
  public TableView saveRows(
      int version, String tableCode, List<RowView> rows, AuthPrincipal principal) {
    Map<String, Object> versionRow = versionRow(version);
    requireStatus(versionRow, "DRAFT", "Only a draft can be edited");
    RuleTableCode table = RuleTableCode.fromCode(tableCode);
    if (rows == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "rows is required");
    }
    Map<String, Object> tableRow =
        jdbc.queryForMap("SELECT id FROM rule_table WHERE code = ?", table.code());
    UUID versionId = (UUID) versionRow.get("id");

    int order = 0;
    for (RowView row : rows) {
      order++;
      Map<String, Object> params = row.params() == null ? new LinkedHashMap<>() : row.params();
      RuleRow existing = findRow(versionId, table, row.ruleCode());
      String severity = row.result() == null
          ? (existing == null ? "WARN" : existing.severity().name()) : row.result();
      String override =
          row.override() == null
              ? (existing == null ? "ACKNOWLEDGE" : existing.overridePolicy().name())
              : "NOT_ALLOWED".equals(row.override()) ? "NONE" : row.override();
      String message = row.params() != null && row.params().get("_message") != null
          ? String.valueOf(row.params().get("_message"))
          : existing == null ? row.ruleCode() : existing.message();
      String source = row.source() == null
          ? (existing == null ? "MOCK" : existing.source()) : row.source();
      if (existing == null) {
        jdbc.update(
            "INSERT INTO rule_row (rule_set_version_id, rule_table_id, code, enabled, params,"
                + " severity, override_policy, message, source, is_placeholder, sort_order)"
                + " VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, false, ?)",
            versionId,
            tableRow.get("id"),
            row.ruleCode(),
            row.enabled(),
            mapper.writeValueAsString(params),
            severity,
            override,
            message,
            source,
            order);
      } else {
        jdbc.update(
            "UPDATE rule_row SET enabled = ?, params = ?::jsonb, severity = ?, override_policy = ?,"
                + " source = ?, sort_order = ? WHERE rule_set_version_id = ? AND code = ?",
            row.enabled(),
            mapper.writeValueAsString(params),
            severity,
            override,
            source,
            order,
            versionId,
            row.ruleCode());
      }
    }
    // A removed row is deleted from the draft; the table must still have at least one row.
    List<String> keep = rows.stream().map(RowView::ruleCode).toList();
    jdbc.update(
        "DELETE FROM rule_row WHERE rule_set_version_id = ? AND rule_table_id = ?"
            + " AND code <> ALL (?::text[])",
        versionId,
        tableRow.get("id"),
        keep.toArray(new String[0]));
    if (rows.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "A decision table needs at least one row");
    }

    // Rows changed since the last build: that build report is no longer evidence.
    jdbc.update(
        "UPDATE rule_set_version SET build_report = NULL, dry_run_report = NULL,"
            + " drl_sha256 = NULL WHERE id = ?",
        versionId);
    audit(principal, "rule_rows_saved", versionId, Map.of("table", table.code(),
        "rows", rows.size()));
    return table(version, tableCode);
  }

  // ---------------------------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public BuildReportView build(int version, AuthPrincipal principal) {
    Map<String, Object> versionRow = versionRow(version);
    requireStatus(versionRow, "DRAFT", "Only a draft can be built");
    UUID versionId = (UUID) versionRow.get("id");
    RuleSet ruleSet = new RuleSet("v" + version, rowsRepository.rows(versionId, null));
    List<BuildStepView> steps = new ArrayList<>();
    List<String> errors = new ArrayList<>();

    // 1. Validate values the fact builders can never produce (docs/04 §5a, T13).
    List<RuleRowValidator.Violation> violations = validator.validate(ruleSet);
    List<String> violationText =
        violations.stream().map(RuleRowValidator.Violation::toString).toList();
    errors.addAll(violationText);
    steps.add(
        new BuildStepView(
            "validation",
            "Values the engine can produce",
            violations.isEmpty()
                ? "Every value is one the fact builders produce."
                : violations.size() + " row value(s) can never fire.",
            violations.isEmpty(),
            List.of()));
    if (!violations.isEmpty()) {
      return store(versionId, version, principal, steps, 0, 0, errors);
    }

    // 2. Compile.
    KieBase candidate;
    try {
      candidate = compiler.compile(ruleSet);
      steps.add(
          new BuildStepView(
              "compile", "Compile the decision tables", "The staging rule base compiled.", true,
              List.of()));
    } catch (RuleCompilationException e) {
      errors.add(e.getMessage());
      steps.add(
          new BuildStepView(
              "compile", "Compile the decision tables", e.getMessage(), false, List.of()));
      return store(versionId, version, principal, steps, 0, 0, errors);
    }

    // 3. Named rule scenarios (T1-T5) and the ranking order (T6).
    List<RuleScenarioRunner.Result> scenarioResults = new ArrayList<>();
    scenarioResults.addAll(scenarios.run(candidate, "v" + version));
    scenarioResults.addAll(scenarios.checkRanking(ruleSet));
    long passed = scenarioResults.stream().filter(RuleScenarioRunner.Result::passed).count();
    List<String> scenarioFailures =
        scenarioResults.stream()
            .filter(result -> !result.passed())
            .map(result -> result.id() + " " + result.name() + ": " + result.failures())
            .toList();
    errors.addAll(scenarioFailures);
    steps.add(
        new BuildStepView(
            "scenarios",
            "Run the named scenarios",
            passed + " of " + scenarioResults.size() + " scenarios pass.",
            scenarioFailures.isEmpty(),
            List.of()));
    if (!scenarioFailures.isEmpty()) {
      return store(
          versionId, version, principal, steps, scenarioResults.size(), (int) passed, errors);
    }

    // 4. Dry run on the current roster, counts only (ADR-017).
    List<ImpactView> impact = dryRun(ruleSet);
    steps.add(
        new BuildStepView(
            "dryRun",
            "Dry run on the published roster",
            impact.isEmpty()
                ? "No rule result changes on the current roster."
                : impact.stream().mapToLong(ImpactView::count).sum()
                    + " result(s) change on the current roster.",
            true,
            impact));

    return store(
        versionId, version, principal, steps, scenarioResults.size(), (int) passed, errors);
  }

  // ---------------------------------------------------------------------------------------------
  // Submit, approve, publish
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public VersionView submit(int version, AuthPrincipal principal) {
    Map<String, Object> versionRow = versionRow(version);
    requireStatus(versionRow, "DRAFT", "Only a draft can be submitted");
    requireCurrentBuildPassed(versionRow, version);
    jdbc.update(
        "UPDATE rule_set_version SET status = 'SUBMITTED', submitted_at = now() WHERE id = ?",
        versionRow.get("id"));
    audit(principal, "rule_set_submit", (UUID) versionRow.get("id"), Map.of("version", version));
    return version(version);
  }

  @Transactional
  public VersionView approve(int version, AuthPrincipal principal) {
    Map<String, Object> versionRow = versionRow(version);
    requireStatus(versionRow, "SUBMITTED", "Only a submitted version can be approved");
    UUID createdBy = (UUID) versionRow.get("created_by");
    UUID userId =
        jdbc.queryForObject(
            "SELECT id FROM app_user WHERE username = ?", UUID.class, principal.username());
    if (createdBy != null && createdBy.equals(userId)) {
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, "The author of a rule version cannot approve it");
    }
    int approved =
        jdbc.update(
            "UPDATE rule_set_version SET status = 'APPROVED', approved_by = ?, approved_at = now()"
                + " WHERE id = ? AND status = 'SUBMITTED'",
            userId,
            versionRow.get("id"));
    if (approved == 0) {
      // Two approvers raced: the loser changed nothing and must not write a second audit row.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "The version is no longer submitted");
    }
    audit(principal, "rule_set_approve", (UUID) versionRow.get("id"), Map.of("version", version));
    return version(version);
  }

  @Transactional
  public VersionView reject(int version, String reason, AuthPrincipal principal) {
    Map<String, Object> versionRow = versionRow(version);
    requireStatus(versionRow, "SUBMITTED", "Only a submitted version can be rejected");
    if (reason == null || reason.trim().length() < 10) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "A rejection needs a reason of at least 10 characters");
    }
    jdbc.update(
        "UPDATE rule_set_version SET status = 'REJECTED', change_reason = ? WHERE id = ?",
        reason,
        versionRow.get("id"));
    audit(principal, "rule_set_reject", (UUID) versionRow.get("id"), Map.of("reason", reason));
    return version(version);
  }

  @Transactional
  public VersionView publish(int version, LocalDate effectiveDate, AuthPrincipal principal) {
    Map<String, Object> versionRow = versionRow(version);
    requireStatus(versionRow, "APPROVED", "Only an approved version can be published");
    RuleSet ruleSet =
        new RuleSet("v" + version, rowsRepository.rows((UUID) versionRow.get("id"), null));
    requireFingerprint(versionRow, ruleSet);
    // Compile before touching the database, so a failure changes nothing.
    compiler.compile(ruleSet);

    LocalDate effective =
        effectiveDate == null
            ? ((java.sql.Date) versionRow.get("effective_from")).toLocalDate()
            : effectiveDate;
    jdbc.update(
        "UPDATE rule_set_version SET status = 'SUPERSEDED' WHERE status = 'PUBLISHED'");
    int published =
        jdbc.update(
            "UPDATE rule_set_version SET status = 'PUBLISHED', published_at = now(),"
                + " effective_from = ? WHERE id = ? AND status = 'APPROVED'",
            effective,
            versionRow.get("id"));
    if (published == 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "The version is no longer approved");
    }
    // Swap only once the transaction commits: a rollback must not leave memory ahead of the DB.
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              live.publish(ruleSet);
            }
          });
    } else {
      live.publish(ruleSet);
    }
    audit(principal, "rule_set_publish", (UUID) versionRow.get("id"), Map.of(
        "version", version, "effectiveFrom", effective.toString()));
    return version(version);
  }

  // ---------------------------------------------------------------------------------------------
  // Dry run
  // ---------------------------------------------------------------------------------------------

  private List<ImpactView> dryRun(RuleSet candidateRows) {
    KieBase candidate = compiler.compile(candidateRows);
    KieBase current = live.snapshot().kieBase();

    Map<String, List<ShiftFact>> shiftsByOfficer = new LinkedHashMap<>();
    Map<String, String> unitByOfficer = new LinkedHashMap<>();
    jdbc.query(
        "SELECT s.id, e.employee_no, u.code AS unit_code, u.allows_12h, u.allows_16h,"
            + " t.code AS template_code, s.start_at, s.end_at, s.kind"
            + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
            + " JOIN unit u ON u.id = s.unit_id JOIN shift_template t ON t.id = s.shift_template_id"
            + " WHERE s.status <> 'CANCELLED' ORDER BY e.employee_no, s.start_at",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> {
              String employee = resultSet.getString("employee_no");
              unitByOfficer.putIfAbsent(employee, resultSet.getString("unit_code"));
              shiftsByOfficer
                  .computeIfAbsent(employee, key -> new ArrayList<>())
                  .add(
                      new ShiftFact(
                          resultSet.getObject("id").toString(),
                          employee,
                          resultSet.getString("unit_code"),
                          resultSet.getString("template_code"),
                          resultSet.getTimestamp("start_at").toInstant(),
                          resultSet.getTimestamp("end_at").toInstant(),
                          "EXTRA".equals(resultSet.getString("kind"))
                              ? ShiftKind.EXTRA
                              : ShiftKind.ROSTERED,
                          0,
                          resultSet.getBoolean("allows_12h"),
                          resultSet.getBoolean("allows_16h")));
            });

    Map<String, Long> counts = new LinkedHashMap<>();
    shiftsByOfficer.forEach(
        (employee, shifts) -> {
          List<Object> facts = factsFor(shifts);
          Map<String, RuleOutcome> before = worstByRule(evaluator.evaluate(current, "live",
              facts.toArray()));
          Map<String, RuleOutcome> after = worstByRule(evaluator.evaluate(candidate,
              candidateRows.version(), facts.toArray()));
          for (String rule : union(before.keySet(), after.keySet())) {
            RuleOutcome from = before.get(rule);
            RuleOutcome to = after.get(rule);
            if (from == to) {
              continue;
            }
            String key = rule + "|" + unitByOfficer.get(employee) + "|" + name(from) + "|" + name(to);
            counts.merge(key, 1L, Long::sum);
          }
        });

    List<ImpactView> impact = new ArrayList<>();
    counts.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .limit(200)
        .forEach(
            entry -> {
              String[] parts = entry.getKey().split("\\|", -1);
              impact.add(new ImpactView(parts[0], parts[1], parts[2], parts[3], entry.getValue()));
            });
    return impact;
  }

  private static String name(RuleOutcome outcome) {
    return outcome == null ? "PASS" : outcome.name();
  }

  private static List<String> union(java.util.Set<String> first, java.util.Set<String> second) {
    java.util.Set<String> all = new java.util.TreeSet<>(first);
    all.addAll(second);
    return new ArrayList<>(all);
  }

  private static Map<String, RuleOutcome> worstByRule(List<RuleResult> results) {
    Map<String, RuleOutcome> worst = new LinkedHashMap<>();
    for (RuleResult result : results) {
      RuleOutcome current = worst.get(result.ruleId());
      if (current == null || severity(result.outcome()) > severity(current)) {
        worst.put(result.ruleId(), result.outcome());
      }
    }
    return worst;
  }

  private static int severity(RuleOutcome outcome) {
    return switch (outcome) {
      case BLOCK -> 3;
      case WARN -> 2;
      case INFO -> 1;
    };
  }

  private static List<Object> factsFor(List<ShiftFact> shifts) {
    List<Object> facts = new ArrayList<>();
    facts.addAll(new RestFactBuilder().build(shifts));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 24));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    facts.addAll(new ConsecutiveRunFactBuilder().build(shifts));
    facts.addAll(new LongShiftCountFactBuilder().build(shifts));
    facts.addAll(new DaysOffFactBuilder().build(shifts));
    facts.addAll(new ShiftLengthFactBuilder().build(shifts));
    return facts;
  }

  // ---------------------------------------------------------------------------------------------
  // Rows, views, checks
  // ---------------------------------------------------------------------------------------------

  private Map<String, Object> versionRow(int version) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, version, status, based_on_version, effective_from, build_report::text AS"
                + " build_report, drl_sha256, created_by FROM rule_set_version WHERE version = ?",
            version);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Rule set version not found");
    }
    return rows.get(0);
  }

  private VersionView version(int version) {
    return versions().stream()
        .filter(view -> view.version() == version)
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Version not found"));
  }

  private RuleRow findRow(UUID versionId, RuleTableCode table, String code) {
    return rowsRepository.rows(versionId, table).stream()
        .filter(row -> row.code().equals(code))
        .findFirst()
        .orElse(null);
  }

  private int changedCount(UUID versionId, Object basedOn) {
    if (basedOn == null) {
      return 0;
    }
    UUID baseId =
        jdbc.queryForObject(
            "SELECT id FROM rule_set_version WHERE version = ?", UUID.class, basedOn);
    List<RuleRow> mine = rowsRepository.rows(versionId, null);
    List<RuleRow> base = rowsRepository.rows(baseId, null);
    Map<String, RuleRow> baseByCode = new LinkedHashMap<>();
    base.forEach(row -> baseByCode.put(row.code(), row));
    int changed = 0;
    for (RuleRow row : mine) {
      RuleRow reference = baseByCode.get(row.code());
      if (reference == null
          || !reference.params().equals(row.params())
          || reference.severity() != row.severity()
          || reference.overridePolicy() != row.overridePolicy()
          || reference.enabled() != row.enabled()
          || !reference.message().equals(row.message())) {
        changed++;
      }
    }
    return changed;
  }

  private void requireStatus(Map<String, Object> row, String status, String message) {
    if (!status.equals(row.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
  }

  private void requireCurrentBuildPassed(Map<String, Object> versionRow, int version) {
    if (versionRow.get("build_report") == null) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Build the draft before submitting it");
    }
    BuildReportView report =
        mapper.readValue((String) versionRow.get("build_report"), BuildReportView.class);
    boolean passed = report.steps().stream().allMatch(BuildStepView::done);
    if (!passed) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "The last build did not pass; fix the errors and build again");
    }
    requireFingerprint(versionRow, new RuleSet("v" + version,
        rowsRepository.rows((UUID) versionRow.get("id"), null)));
  }

  private void requireFingerprint(Map<String, Object> versionRow, RuleSet ruleSet) {
    String expected = (String) versionRow.get("drl_sha256");
    if (expected == null || !expected.equals(fingerprint(ruleSet))) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "The rows changed since the last successful build; build again");
    }
  }

  private BuildReportView store(
      UUID versionId,
      int version,
      AuthPrincipal principal,
      List<BuildStepView> steps,
      int total,
      int passed,
      List<String> errors) {
    BuildReportView report =
        new BuildReportView(steps, new ScenarioCounts(total, passed), errors);
    boolean allPassed = steps.stream().allMatch(BuildStepView::done);
    jdbc.update(
        "UPDATE rule_set_version SET build_report = ?::jsonb, dry_run_report = ?::jsonb,"
            + " drl_sha256 = ? WHERE id = ?",
        mapper.writeValueAsString(report),
        mapper.writeValueAsString(
            steps.stream()
                .filter(step -> "dryRun".equals(step.key()))
                .findFirst()
                .map(BuildStepView::impact)
                .orElse(List.of())),
        allPassed
            ? fingerprint(new RuleSet("v", rowsRepository.rows(versionId, null)))
            : null,
        versionId);
    audit(
        principal,
        "rule_set_build",
        versionId,
        Map.of(
            "version", version,
            "passed", allPassed,
            "scenariosPassed", passed,
            "scenariosTotal", total));
    return report;
  }

  private String fingerprint(RuleSet ruleSet) {
    StringBuilder canonical = new StringBuilder();
    ruleSet.rows().stream()
        .sorted(Comparator.comparing(RuleRow::code))
        .forEach(
            row -> {
              canonical
                  .append(row.code()).append('|')
                  .append(row.enabled()).append('|')
                  .append(row.severity()).append('|')
                  .append(row.overridePolicy()).append('|')
                  .append(row.message()).append('|')
                  .append(new java.util.TreeMap<>(row.params()));
              canonical.append('\n');
            });
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder();
      for (byte b : hash) {
        hex.append(String.format("%02x", b));
      }
      return hex.toString();
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is unavailable", e);
    }
  }

  private RowView rowView(RuleRow row, Map<String, Object> schema) {
    Map<String, Object> params = row.params();
    String after = value(params.get("afterShiftKind"), "");
    double minHours = params.containsKey("minRestHours")
        ? ((Number) params.get("minRestHours")).doubleValue()
        : params.containsKey("maxHours")
            ? ((Number) params.get("maxHours")).doubleValue()
            : params.containsKey("max")
                ? ((Number) params.get("max")).doubleValue()
                : 0;
    Double min = null;
    Object schemaMin = schema.containsKey("minRestHours")
        ? ((Map<?, ?>) schema.get("minRestHours")).get("minimum")
        : null;
    if (schemaMin instanceof Number number) {
      min = number.doubleValue();
    }
    return new RowView(
        row.code(),
        row.enabled(),
        after,
        minHours,
        row.severity().name(),
        row.overridePolicy() == OverridePolicy.NONE
            ? "NOT_ALLOWED"
            : row.overridePolicy().name(),
        row.source(),
        min,
        sentence(row),
        params);
  }

  private static String sentence(RuleRow row) {
    Map<String, Object> p = row.params();
    String override =
        switch (row.overridePolicy()) {
          case EMERGENCY -> " A supervisor may override only in an emergency, with a reason.";
          case ACKNOWLEDGE -> " A supervisor must acknowledge it.";
          case NONE -> " It cannot be overridden.";
        };
    return switch (row.table()) {
      case REST -> "After "
          + ("(D8|E8|N8|A12|P12)".equals(value(p.get("afterShiftKind"), ""))
              ? "a regular shift"
              : value(p.get("afterShiftKind"), "any shift"))
          + ", an officer needs at least "
          + number(p.get("minRestHours"))
          + " hours off within "
          + number(p.get("windowHours"))
          + " hours. If not, the change is "
          + row.severity().name().toLowerCase()
          + "."
          + override;
      case MAX_HOURS -> "No more than "
          + number(p.get("maxHours"))
          + " hours in "
          + number(p.get("windowHours"))
          + " hours. If not, the change is "
          + row.severity().name().toLowerCase()
          + "."
          + override;
      case CONSECUTIVE -> "No more than "
          + number(p.get("max"))
          + " consecutive "
          + value(p.get("counts"), "shifts")
          + ". Scheduled: "
          + row.severity().name().toLowerCase()
          + "; caused by overtime: "
          + value(p.get("overtimeSeverity"), "WARN").toLowerCase()
          + ".";
      case LONG_SHIFTS -> "No more than "
          + number(p.get("maxIn7Days"))
          + " sixteen-hour shifts in 7 days, and "
          + number(p.get("maxIn28Days"))
          + " in 28 days."
          + override;
      case DAYS_OFF -> "At least "
          + number(p.get("daysOff"))
          + " consecutive days off in every "
          + number(p.get("withinDays"))
          + " days; a break of 24 hours or less does not count."
          + override;
      case PAY -> row.message();
      case OT_RANKING -> row.message();
      case SHIFT_LENGTHS -> row.message();
    };
  }

  private static String value(Object value, String fallback) {
    return value == null ? fallback : String.valueOf(value);
  }

  private static String number(Object value) {
    if (value instanceof Number number) {
      return number.doubleValue() == Math.rint(number.doubleValue())
          ? String.valueOf(number.intValue())
          : String.valueOf(number.doubleValue());
    }
    return String.valueOf(value);
  }

  private Map<String, Object> readMap(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    return mapper.readValue(json, Map.class);
  }

  private static String instant(java.sql.Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toInstant().toString();
  }

  private void audit(
      AuthPrincipal principal, String action, UUID entityId, Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, 'rule_set_version', ?,"
            + " ?::jsonb)",
        principal.username(),
        action,
        entityId,
        mapper.writeValueAsString(after));
  }
}
