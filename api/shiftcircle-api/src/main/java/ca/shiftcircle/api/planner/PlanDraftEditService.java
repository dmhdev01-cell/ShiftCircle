package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.rules.RuleViolationException;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.units.ActiveUnits;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Release 7 #27: the planner edits one shift in an uncommitted draft.
 *
 * <p>The supervisor path ({@code AssignmentService}) writes the live roster, so it is not reused.
 * The edit runs the same rule engine seam the planner generator and commit use, then writes only
 * {@code plan_draft_assignment}. The draft is re-scored by {@link PlannerService#recomputeDraft};
 * no generator or placement path runs here.
 */
@Service
public class PlanDraftEditService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  public record Input(
      UUID assignmentId,
      UUID employeeId,
      UUID unitId,
      String shiftTemplate,
      Instant startAt,
      String kind,
      Boolean acknowledgeWarnings) {}

  public record Result(
      UUID draftId,
      UUID assignmentId,
      int version,
      int handEdits,
      List<UUID> editedAssignmentIds,
      Map<String, Object> scorecard,
      List<PlannerViews.WarningGroup> warnings,
      int warningCount,
      List<PlannerViews.GapView> gaps) {}

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleCheck;
  private final ActiveUnits activeUnits;
  private final PlannerService planner;
  private final ObjectMapper mapper = new ObjectMapper();

  public PlanDraftEditService(
      JdbcTemplate jdbc,
      RuleCheckService ruleCheck,
      ActiveUnits activeUnits,
      PlannerService planner) {
    this.jdbc = jdbc;
    this.ruleCheck = ruleCheck;
    this.activeUnits = activeUnits;
    this.planner = planner;
  }

  /** Preview: same rule results as a save, but nothing is written. */
  public RuleCheckService.OutcomeView check(UUID draftId, Input input) {
    DraftRow draft = draft(draftId, false);
    requireDraft(draft);
    Edit edit = validate(draft, input.assignmentId(), input);
    // validate() already ran the check, with the post (R-01/R-02); a second run would be the same.
    return edit.outcome();
  }

  @Transactional
  public Result add(UUID draftId, Input input, Integer ifMatch, AuthPrincipal principal) {
    DraftRow draft = draft(draftId, true);
    requireDraft(draft);
    requireVersion(draft, ifMatch);
    Edit edit = validate(draft, null, input);
    decide(edit.outcome(), input);
    UUID assignmentId = UUID.randomUUID();
    try {
      jdbc.update(
          "INSERT INTO plan_draft_assignment (id, draft_id, employee_id, unit_id,"
              + " shift_template_id, work_date, start_at, end_at, kind, sort_order)"
              + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
          assignmentId,
          draftId,
          edit.employeeId(),
          edit.unitId(),
          edit.templateId(),
          java.sql.Date.valueOf(edit.workDate()),
          Timestamp.from(edit.start()),
          Timestamp.from(edit.end()),
          edit.kind());
    } catch (DataIntegrityViolationException duplicate) {
      throw conflict("That officer already has a draft shift at that start time.");
    }
    bumpVersion(draftId);
    audit(principal, draftId, assignmentId, "ADD", null, edit.snapshot());
    return result(draftId, assignmentId);
  }

  @Transactional
  public Result move(
      UUID draftId, UUID assignmentId, Input input, Integer ifMatch, AuthPrincipal principal) {
    DraftRow draft = draft(draftId, true);
    requireDraft(draft);
    requireVersion(draft, ifMatch);
    Map<String, Object> before = assignment(draftId, assignmentId);
    if (before == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That draft shift was not found.");
    }
    Edit edit = validate(draft, assignmentId, input);
    decide(edit.outcome(), input);
    try {
      jdbc.update(
          "UPDATE plan_draft_assignment SET employee_id = ?, unit_id = ?, shift_template_id = ?,"
              + " work_date = ?, start_at = ?, end_at = ?, kind = ? WHERE id = ? AND draft_id = ?",
          edit.employeeId(),
          edit.unitId(),
          edit.templateId(),
          java.sql.Date.valueOf(edit.workDate()),
          Timestamp.from(edit.start()),
          Timestamp.from(edit.end()),
          edit.kind(),
          assignmentId,
          draftId);
    } catch (DataIntegrityViolationException duplicate) {
      throw conflict("That officer already has a draft shift at that start time.");
    }
    bumpVersion(draftId);
    String kind =
        before.get("employee_id").equals(edit.employeeId()) ? "MOVE" : "REASSIGN";
    audit(principal, draftId, assignmentId, kind, before, edit.snapshot());
    return result(draftId, assignmentId);
  }

  @Transactional
  public Result remove(
      UUID draftId, UUID assignmentId, Integer ifMatch, AuthPrincipal principal) {
    DraftRow draft = draft(draftId, true);
    requireDraft(draft);
    requireVersion(draft, ifMatch);
    Map<String, Object> before = assignment(draftId, assignmentId);
    if (before == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That draft shift was not found.");
    }
    jdbc.update(
        "DELETE FROM plan_draft_assignment WHERE id = ? AND draft_id = ?", assignmentId, draftId);
    bumpVersion(draftId);
    audit(principal, draftId, assignmentId, "REMOVE", before, null);
    return result(draftId, assignmentId);
  }

  // ---------------------------------------------------------------------------------------------

  private record DraftRow(UUID id, int version, String status, String pattern8h) {}

  private record Edit(
      UUID employeeId,
      UUID unitId,
      UUID templateId,
      Instant start,
      Instant end,
      LocalDate workDate,
      String kind,
      ShiftFact proposed,
      List<ShiftFact> existing,
      RuleCheckService.OutcomeView outcome,
      Map<String, Object> snapshot) {}

  private DraftRow draft(UUID id, boolean lock) {
    List<DraftRow> rows =
        jdbc.query(
            "SELECT id, version, status, pattern8h FROM plan_draft WHERE id = ?"
                + (lock ? " FOR UPDATE" : ""),
            (rs, row) ->
                new DraftRow(
                    rs.getObject("id", UUID.class),
                    rs.getInt("version"),
                    rs.getString("status"),
                    rs.getString("pattern8h")),
            id);
    if (rows.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That draft was not found.");
    }
    return rows.get(0);
  }

  private static void requireDraft(DraftRow draft) {
    if (!"DRAFT".equals(draft.status())) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT,
          "This draft was committed or discarded, so it can't be changed. Reload the quarter"
              + " plan.");
    }
  }

  private static void requireVersion(DraftRow draft, Integer ifMatch) {
    if (ifMatch == null) {
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_REQUIRED,
          "Send If-Match with the draft version before changing it.");
    }
    if (ifMatch != draft.version()) {
      throw new ResponseStatusException(
          HttpStatus.PRECONDITION_FAILED,
          "The draft changed since it was read; reload the roster and try again.");
    }
  }

  private Edit validate(DraftRow draft, UUID assignmentId, Input input) {
    if (input == null
        || input.employeeId() == null
        || input.unitId() == null
        || input.shiftTemplate() == null
        || input.shiftTemplate().isBlank()
        || input.startAt() == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "employeeId, unitId, shiftTemplate and startAt are required.");
    }
    if (assignmentId != null) {
      Map<String, Object> row = assignment(draft.id(), assignmentId);
      if (row == null) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That draft shift was not found.");
      }
    }
    Map<String, Object> employee =
        jdbc.queryForList(
                "SELECT id, employee_no, first_name || ' ' || last_name AS name FROM employee"
                    + " WHERE id = ? AND active",
                input.employeeId())
            .stream()
            .findFirst()
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "That officer was not found or is inactive."));
    Map<String, Object> template =
        jdbc.queryForList(
                "SELECT id, code, duration_minutes FROM shift_template WHERE code = ? AND active",
                input.shiftTemplate())
            .stream()
            .findFirst()
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "That shift type is retired or unknown; choose another shift type."));
    Map<String, Object> unit =
        jdbc.queryForList(
                "SELECT id, code, name, allows_12h, allows_16h FROM unit WHERE id = ?",
                input.unitId())
            .stream()
            .findFirst()
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "That unit was not found."));
    LocalDate date = input.startAt().atZone(REGINA).toLocalDate();
    if (date.isBefore(PlanGenerator.FROM) || date.isAfter(PlanGenerator.TO)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "The shift is outside the quarter-plan window.");
    }
    if (!activeUnits.active(input.unitId(), date)) {
      throw conflict("That unit is closed on that date, so the shift can't go in the draft.");
    }
    String kind =
        input.kind() == null || input.kind().isBlank() ? "ROSTERED" : input.kind().toUpperCase();
    if (!Set.of("ROSTERED", "EXTRA").contains(kind)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "kind must be ROSTERED or EXTRA.");
    }
    Integer duplicate =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND employee_id = ?"
                + " AND start_at = ?"
                + (assignmentId == null ? "" : " AND id <> ?"),
            Integer.class,
            assignmentId == null
                ? new Object[] {draft.id(), input.employeeId(), Timestamp.from(input.startAt())}
                : new Object[] {
                  draft.id(), input.employeeId(), Timestamp.from(input.startAt()), assignmentId
                });
    if (duplicate != null && duplicate > 0) {
      throw conflict("That officer already has a draft shift at that start time.");
    }
    int minutes = ((Number) template.get("duration_minutes")).intValue();
    Instant end = input.startAt().plus(Duration.ofMinutes(minutes));
    ShiftFact proposed =
        new ShiftFact(
            "draft-edit",
            (String) employee.get("employee_no"),
            (String) unit.get("code"),
            (String) template.get("code"),
            input.startAt(),
            end,
            "EXTRA".equals(kind) ? ShiftKind.EXTRA : ShiftKind.ROSTERED,
            0,
            (Boolean) unit.get("allows_12h"),
            (Boolean) unit.get("allows_16h"));

    List<ShiftFact> existing = new ArrayList<>();
    existing.addAll(
        planner.historyFor(
            input.employeeId(),
            PlanGenerator.FROM.minusDays(PlanGenerator.HISTORY_DAYS).atStartOfDay(REGINA).toInstant(),
            PlanGenerator.TO.plusDays(1).atStartOfDay(REGINA).toInstant()));
    jdbc.query(
        "SELECT a.id, a.employee_id, e.employee_no, a.unit_id, u.code AS unit_code,"
            + " t.code AS template_code, a.start_at, a.end_at, a.kind, u.allows_12h, u.allows_16h"
            + " FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
            + " JOIN unit u ON u.id = a.unit_id JOIN shift_template t ON t.id = a.shift_template_id"
            + " WHERE a.draft_id = ? AND a.employee_id = ?"
            + (assignmentId == null ? "" : " AND a.id <> ?")
            + " ORDER BY a.start_at",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                existing.add(
                    new ShiftFact(
                        rs.getObject("id").toString(),
                        rs.getString("employee_no"),
                        rs.getString("unit_code"),
                        rs.getString("template_code"),
                        rs.getTimestamp("start_at").toInstant(),
                        rs.getTimestamp("end_at").toInstant(),
                        "EXTRA".equals(rs.getString("kind"))
                            ? ShiftKind.EXTRA
                            : ShiftKind.ROSTERED,
                        0,
                        rs.getBoolean("allows_12h"),
                        rs.getBoolean("allows_16h"))),
        assignmentId == null
            ? new Object[] {draft.id(), input.employeeId()}
            : new Object[] {draft.id(), input.employeeId(), assignmentId});
    RuleCheckService.OutcomeView outcome =
        ruleCheck.evaluate(
            proposed,
            existing,
            ruleCheck.post(input.employeeId(), input.unitId(), input.startAt()));
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("employeeId", input.employeeId().toString());
    snapshot.put("unitId", input.unitId().toString());
    snapshot.put("shiftTemplate", input.shiftTemplate());
    snapshot.put("startAt", input.startAt().toString());
    snapshot.put("endAt", end.toString());
    snapshot.put("kind", kind);
    return new Edit(
        input.employeeId(),
        input.unitId(),
        (UUID) template.get("id"),
        input.startAt(),
        end,
        date,
        kind,
        proposed,
        existing,
        outcome,
        snapshot);
  }

  private static void decide(RuleCheckService.OutcomeView outcome, Input input) {
    boolean blocked =
        outcome.ruleResults().stream().anyMatch(result -> "BLOCK".equals(result.outcome()));
    if (blocked) {
      throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
    }
    boolean warned =
        outcome.ruleResults().stream().anyMatch(result -> "WARN".equals(result.outcome()));
    if (warned && !Boolean.TRUE.equals(input.acknowledgeWarnings())) {
      throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
    }
  }

  private Map<String, Object> assignment(UUID draftId, UUID assignmentId) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT a.id, a.employee_id, a.unit_id, a.shift_template_id, a.work_date, a.start_at,"
                + " a.end_at, a.kind FROM plan_draft_assignment a"
                + " WHERE a.id = ? AND a.draft_id = ?",
            assignmentId,
            draftId);
    return rows.isEmpty() ? null : rows.get(0);
  }

  private void bumpVersion(UUID draftId) {
    int updated =
        jdbc.update(
            "UPDATE plan_draft SET version = version + 1 WHERE id = ? AND status = 'DRAFT'",
            draftId);
    if (updated != 1) {
      throw conflict("The draft was committed or discarded while this request ran.");
    }
  }

  private void audit(
      AuthPrincipal principal,
      UUID draftId,
      UUID assignmentId,
      String kind,
      Map<String, Object> before,
      Map<String, Object> after) {
    Map<String, Object> detail = new LinkedHashMap<>();
    detail.put("draftId", draftId.toString());
    detail.put("assignmentId", assignmentId.toString());
    detail.put("kind", kind);
    detail.put("before", before);
    detail.put("after", after);
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), 'edit_plan_draft',"
            + " 'plan_draft', ?, ?::jsonb)",
        principal.username(),
        draftId,
        mapper.writeValueAsString(detail));
  }

  private Result result(UUID draftId, UUID assignmentId) {
    planner.recomputeDraft(draftId);
    PlannerViews.DraftSummary draft = planner.draft(draftId);
    List<PlannerViews.WarningGroup> warnings = planner.warnings(draftId);
    int warningCount = warnings.stream().mapToInt(PlannerViews.WarningGroup::count).sum();
    return new Result(
        draftId,
        assignmentId,
        draft.version(),
        handEdits(draftId),
        editedAssignmentIds(draftId),
        draft.scorecard(),
        warnings,
        warningCount,
        planner.gaps(draftId));
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

  private static ResponseStatusException conflict(String detail) {
    return new ResponseStatusException(HttpStatus.CONFLICT, detail);
  }
}
