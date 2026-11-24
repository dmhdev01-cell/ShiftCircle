package ca.shiftcircle.api.proposals;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.planner.PlanGenerator;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.time.BusinessClock;
import ca.shiftcircle.api.units.ActiveUnits;
import ca.shiftcircle.rules.build.ShiftFact;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * An officer's shift proposals: preview, send, list their own and withdraw (v1.3 P1, plan
 * .factory/plans/v1.2-proposals.md; docs/07 §4.4). Deciding is the next release step.
 *
 * <p>A proposal is a set of "add this extra shift" items. Each item is rule-checked as an EXTRA
 * shift together with the officer's real shifts and with the other items of the same proposal, so
 * two drafts that break rest between them show it. A Block can't be sent (the owner's answer to
 * Q3); a Warn can, and the codes are stored with the item. Nothing here creates a shift.
 *
 * <p>The proposer is always the signed-in officer: the body can't name another employee, so
 * nobody proposes for someone else.
 */
@Service
public class ProposalService {

  static final int MAX_ITEMS = 10;
  static final int MAX_WAITING = 20;
  static final int MAX_NOTE = 500;
  private static final ZoneId REGINA = BusinessClock.REGINA;
  private static final Set<String> STATES =
      Set.of("WAITING", "APPROVED", "PARTLY_APPROVED", "DECLINED", "WITHDRAWN", "EXPIRED");

  /** The last day a proposal may name: the end of the planned quarter (plan §5). */
  static final LocalDate HORIZON = PlanGenerator.TO;

  public record ItemInput(UUID unitId, String shiftTemplate, Instant startAt) {}

  public record PreviewRequest(List<ItemInput> items) {}

  public record SubmitRequest(String note, List<ItemInput> items) {}

  public record PreviewItem(
      int index,
      UUID unitId,
      String unit,
      String shiftTemplate,
      Instant startAt,
      Instant endAt,
      String outcome,
      int ruleSetVersion,
      List<RuleCheckService.ResultView> ruleResults,
      String problem,
      String problemCode) {}

  public record PreviewView(String outcome, boolean canSend, List<PreviewItem> items) {}

  public record ItemView(
      UUID id,
      UUID unitId,
      String unit,
      String unitName,
      String shiftTemplate,
      Instant startAt,
      Instant endAt,
      LocalDate workDate,
      String decision,
      String outcomeAtSubmit,
      Object ruleAtSubmit,
      String decidedBy,
      Instant decidedAt,
      String comment) {}

  public record ProposalView(
      UUID id,
      String status,
      String displayState,
      String note,
      Instant submittedAt,
      Instant withdrawnAt,
      int version,
      boolean canWithdraw,
      List<ItemView> items) {}

  /** An item that passed the checks that need no rule engine. */
  private record Valid(
      int index, ItemInput input, String unitCode, UUID templateId, Instant endAt, LocalDate day) {}

  private record Checked(
      Valid item, RuleCheckService.OutcomeView outcome, Problem problem) {}

  private record Problem(int status, String slug, String title, String detail) {}

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final PublishedRuleSet published;
  private final BusinessClock clock;
  private final ActiveUnits activeUnits;
  private final ProposalExpiry expiry;
  private final ObjectMapper mapper = new ObjectMapper();

  public ProposalService(
      JdbcTemplate jdbc,
      RuleCheckService ruleChecks,
      PublishedRuleSet published,
      BusinessClock clock,
      ActiveUnits activeUnits,
      ProposalExpiry expiry) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
    this.published = published;
    this.clock = clock;
    this.activeUnits = activeUnits;
    this.expiry = expiry;
  }

  // ---------------------------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------------------------

  /** Rule results for every item, each with the earlier items as extra facts. Saves nothing. */
  public PreviewView preview(PreviewRequest request, AuthPrincipal principal) {
    UUID employeeId = requireOfficer(principal);
    List<Valid> items = validate(request == null ? null : request.items());
    List<Checked> checked = check(employeeId, items, true);
    boolean blocked = checked.stream().anyMatch(c -> isBlock(c.outcome()));
    boolean problem = checked.stream().anyMatch(c -> c.problem() != null);
    List<PreviewItem> views =
        checked.stream()
            .map(
                c ->
                    new PreviewItem(
                        c.item().index(),
                        c.item().input().unitId(),
                        c.item().unitCode(),
                        c.item().input().shiftTemplate(),
                        c.item().input().startAt(),
                        c.item().endAt(),
                        c.outcome().outcome(),
                        c.outcome().ruleSetVersion(),
                        c.outcome().ruleResults(),
                        c.problem() == null ? null : c.problem().detail(),
                        c.problem() == null ? null : c.problem().slug()))
            .toList();
    return new PreviewView(worst(checked), !blocked && !problem, views);
  }

  // ---------------------------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public ProposalView submit(SubmitRequest request, AuthPrincipal principal) {
    UUID employeeId = requireOfficer(principal);
    String note = cleanNote(request == null ? null : request.note());
    List<Valid> items = validate(request == null ? null : request.items());

    // Two sends close together must not both pass the waiting-item limit, and the rules read the
    // officer's shifts: serialise on the officer, the same lock the board takes.
    lockOfficer(employeeId);
    expiry.apply();

    Integer waiting =
        jdbc.queryForObject(
            "SELECT count(*) FROM proposal_item WHERE employee_id = ? AND decision = 'PENDING'",
            Integer.class,
            employeeId);
    if (waiting != null && waiting + items.size() > MAX_WAITING) {
      throw ProposalProblemException.of(
          409,
          "too-many-waiting",
          "Too many shifts are waiting",
          "At most " + MAX_WAITING + " shifts can wait for an answer at once. Wait for an answer or"
              + " withdraw a proposal first.");
    }

    List<Checked> checked = check(employeeId, items, false);
    for (Checked c : checked) {
      if (c.problem() != null) {
        throw ProposalProblemException.of(
            c.problem().status(), c.problem().slug(), c.problem().title(), c.problem().detail());
      }
    }
    if (checked.stream().anyMatch(c -> isBlock(c.outcome()))) {
      throw blocked(checked);
    }

    UUID proposalId = UUID.randomUUID();
    Timestamp now = Timestamp.from(clock.now());
    jdbc.update(
        "INSERT INTO proposal (id, employee_id, note, status, submitted_at, submitted_by)"
            + " VALUES (?, ?, ?, 'WAITING', ?, (SELECT id FROM app_user WHERE username = ?))",
        proposalId,
        employeeId,
        note,
        now,
        principal.username());
    List<Map<String, Object>> auditItems = new ArrayList<>();
    for (Checked c : checked) {
      Valid v = c.item();
      jdbc.update(
          "INSERT INTO proposal_item (id, proposal_id, employee_id, action, shift_template_id,"
              + " unit_id, start_at, end_at, work_date, decision, rule_snapshot, sort_order)"
              + " VALUES (?, ?, ?, 'ADD', ?, ?, ?, ?, ?, 'PENDING', ?::jsonb, ?)",
          UUID.randomUUID(),
          proposalId,
          employeeId,
          v.templateId(),
          v.input().unitId(),
          Timestamp.from(v.input().startAt()),
          Timestamp.from(v.endAt()),
          v.day(),
          mapper.writeValueAsString(c.outcome()),
          v.index());
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("unit", v.unitCode());
      entry.put("template", v.input().shiftTemplate());
      entry.put("startAt", v.input().startAt().toString());
      entry.put("outcome", c.outcome().outcome());
      entry.put("warnCodes", warnCodes(c.outcome()));
      auditItems.add(entry);
    }
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("employeeId", employeeId.toString());
    after.put("itemCount", items.size());
    after.put("noteLength", note == null ? 0 : note.length());
    after.put("items", auditItems);
    audit(principal, "submit_proposal", "proposal", proposalId, null, after);
    return load(proposalId);
  }

  // ---------------------------------------------------------------------------------------------
  // My proposals
  // ---------------------------------------------------------------------------------------------

  /** The officer's own proposals, newest first, with expiry applied first. */
  @Transactional
  public List<ProposalView> mine(String status, AuthPrincipal principal) {
    UUID employeeId = requireOfficer(principal);
    String wanted = status == null || status.isBlank() ? "ALL" : status.trim().toUpperCase();
    if (!"ALL".equals(wanted) && !STATES.contains(wanted)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "status must be one of ALL, " + String.join(", ", STATES.stream().sorted().toList()));
    }
    expiry.apply();
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT id FROM proposal WHERE employee_id = ? ORDER BY submitted_at DESC, id LIMIT 200",
            UUID.class,
            employeeId);
    List<ProposalView> views = loadAll(ids);
    if ("ALL".equals(wanted)) {
      return views;
    }
    return views.stream().filter(view -> wanted.equals(view.displayState())).toList();
  }

  // ---------------------------------------------------------------------------------------------
  // Withdraw
  // ---------------------------------------------------------------------------------------------

  /** Withdraw while every item still waits. After the first decision the officer asks instead. */
  @Transactional
  public ProposalView withdraw(UUID proposalId, String ifMatch, AuthPrincipal principal) {
    UUID employeeId = requireOfficer(principal);
    // Somebody else's proposal is "not found", never "forbidden": nobody learns it exists.
    List<Map<String, Object>> owned =
        jdbc.queryForList(
            "SELECT id FROM proposal WHERE id = ? AND employee_id = ?", proposalId, employeeId);
    if (owned.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Proposal not found");
    }
    int expected = parseIfMatch(ifMatch);
    lockOfficer(employeeId);
    expiry.apply();

    Map<String, Object> current =
        jdbc.queryForMap("SELECT status, version FROM proposal WHERE id = ?", proposalId);
    int version = ((Number) current.get("version")).intValue();
    if (version != expected) {
      throw ProposalProblemException.of(
          412,
          "stale-version",
          "This proposal changed since you read it",
          "Reload your proposals and try again.");
    }
    Integer notWaiting =
        jdbc.queryForObject(
            "SELECT count(*) FROM proposal_item WHERE proposal_id = ? AND decision <> 'PENDING'",
            Integer.class,
            proposalId);
    if (!"WAITING".equals(current.get("status")) || (notWaiting != null && notWaiting > 0)) {
      throw ProposalProblemException.of(
          409,
          "not-withdrawable",
          "This proposal can't be withdrawn",
          "A shift in it has already been answered or has started. Ask your supervisor instead.");
    }

    int items =
        jdbc.update(
            "UPDATE proposal_item SET decision = 'WITHDRAWN', decided_at = ?"
                + " WHERE proposal_id = ? AND decision = 'PENDING'",
            Timestamp.from(clock.now()),
            proposalId);
    int updated =
        jdbc.update(
            "UPDATE proposal SET status = 'WITHDRAWN', withdrawn_at = ?, version = ?"
                + " WHERE id = ? AND version = ?",
            Timestamp.from(clock.now()),
            version + 1,
            proposalId,
            version);
    if (updated != 1) {
      throw ProposalProblemException.of(
          412,
          "stale-version",
          "This proposal changed since you read it",
          "Reload your proposals and try again.");
    }
    audit(
        principal,
        "withdraw_proposal",
        "proposal",
        proposalId,
        Map.of("status", "WAITING", "version", version),
        Map.of("status", "WITHDRAWN", "itemCount", items, "version", version + 1));
    return load(proposalId);
  }

  // ---------------------------------------------------------------------------------------------
  // Validation and rule checks
  // ---------------------------------------------------------------------------------------------

  /** The officer behind the account, or 404 when the account isn't linked to one. */
  private UUID requireOfficer(AuthPrincipal principal) {
    if (principal.employeeId() == null) {
      throw new ResponseStatusException(
          HttpStatus.NOT_FOUND, "No officer is linked to this account");
    }
    return principal.employeeId();
  }

  private String cleanNote(String note) {
    if (note == null || note.isBlank()) {
      return null;
    }
    String trimmed = note.trim();
    if (trimmed.length() > MAX_NOTE) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "note must be at most " + MAX_NOTE + " characters");
    }
    return trimmed;
  }

  /** The 400 checks: shape, known unit and shift type, date window, no overlap between items. */
  private List<Valid> validate(List<ItemInput> inputs) {
    if (inputs == null || inputs.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "items is required: add at least one shift");
    }
    if (inputs.size() > MAX_ITEMS) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "A proposal holds at most " + MAX_ITEMS + " shifts");
    }
    Instant now = clock.now();
    List<Valid> items = new ArrayList<>();
    for (int i = 0; i < inputs.size(); i++) {
      ItemInput input = inputs.get(i);
      if (input == null
          || input.unitId() == null
          || input.shiftTemplate() == null
          || input.shiftTemplate().isBlank()
          || input.startAt() == null) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "Each item needs unitId, shiftTemplate and startAt (item " + (i + 1) + ")");
      }
      List<Map<String, Object>> unit =
          jdbc.queryForList("SELECT code FROM unit WHERE id = ?", input.unitId());
      if (unit.isEmpty()) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "Unknown unit (item " + (i + 1) + ")");
      }
      List<Map<String, Object>> template =
          jdbc.queryForList(
              "SELECT id, duration_minutes, active FROM shift_template WHERE code = ?",
              input.shiftTemplate());
      if (template.isEmpty() || !Boolean.TRUE.equals(template.get(0).get("active"))) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "That shift type is retired or unknown; choose another shift type (item " + (i + 1) + ")");
      }
      if (!input.startAt().isAfter(now)) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "A proposed shift must start in the future (item " + (i + 1) + ")");
      }
      LocalDate day = input.startAt().atZone(REGINA).toLocalDate();
      if (day.isAfter(HORIZON)) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "A proposed shift can be at most as late as " + HORIZON + " (item " + (i + 1) + ")");
      }
      long minutes = ((Number) template.get(0).get("duration_minutes")).longValue();
      items.add(
          new Valid(
              i,
              input,
              (String) unit.get(0).get("code"),
              (UUID) template.get(0).get("id"),
              input.startAt().plusSeconds(minutes * 60),
              day));
    }
    for (int a = 0; a < items.size(); a++) {
      for (int b = a + 1; b < items.size(); b++) {
        Valid first = items.get(a);
        Valid second = items.get(b);
        if (first.input().startAt().isBefore(second.endAt())
            && second.input().startAt().isBefore(first.endAt())) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST,
              "Items " + (a + 1) + " and " + (b + 1) + " overlap; a proposal can't hold two shifts"
                  + " at the same time");
        }
      }
    }
    return items;
  }

  /**
   * Rule-check each item as an EXTRA shift with the items that start before it as extra facts,
   * and collect the problems no rule explains (locked period, closed unit, already waiting).
   * Results come back in the order the officer listed them.
   */
  private List<Checked> check(UUID employeeId, List<Valid> items, boolean forPreview) {
    PublishedRuleSet.Snapshot live = published.snapshot();
    List<Valid> byStart = new ArrayList<>(items);
    byStart.sort(Comparator.comparing((Valid v) -> v.input().startAt()).thenComparing(Valid::index));
    List<ShiftFact> earlier = new ArrayList<>();
    Map<Integer, Checked> results = new LinkedHashMap<>();
    for (Valid v : byStart) {
      RuleCheckService.Change change =
          new RuleCheckService.Change(
              "EXTRA",
              employeeId,
              v.input().unitId(),
              v.input().shiftTemplate(),
              v.input().startAt());
      RuleCheckService.OutcomeView outcome = ruleChecks.evaluateWithExtras(change, earlier, live);
      results.put(v.index(), new Checked(v, outcome, stateProblem(employeeId, v)));
      earlier.add(ruleChecks.factOf(change, "draft-" + v.index()));
    }
    List<Checked> ordered = new ArrayList<>();
    for (Valid v : items) {
      ordered.add(results.get(v.index()));
    }
    return ordered;
  }

  private Problem stateProblem(UUID employeeId, Valid v) {
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT status FROM pay_period WHERE ? BETWEEN start_date AND end_date", v.day());
    if (!periods.isEmpty() && "LOCKED".equals(periods.get(0).get("status"))) {
      return new Problem(
          409,
          "pay-period-locked",
          "This pay period is locked",
          "The pay period for " + v.day() + " is locked, so no shift can be proposed in it.");
    }
    Boolean unitOpen =
        jdbc.queryForObject("SELECT active FROM unit WHERE id = ?", Boolean.class, v.input().unitId());
    if (!Boolean.TRUE.equals(unitOpen) || !activeUnits.active(v.input().unitId(), v.day())) {
      return new Problem(
          409,
          "unit-closed",
          "That unit is closed on that date",
          v.unitCode() + " is closed on " + v.day() + ", so it needs no extra staff then.");
    }
    Integer overlapping =
        jdbc.queryForObject(
            "SELECT count(*) FROM proposal_item WHERE employee_id = ? AND decision = 'PENDING'"
                + " AND tstzrange(start_at, end_at, '[)') && tstzrange(?, ?, '[)')",
            Integer.class,
            employeeId,
            Timestamp.from(v.input().startAt()),
            Timestamp.from(v.endAt()));
    if (overlapping != null && overlapping > 0) {
      return new Problem(
          409,
          "duplicate-waiting-item",
          "You already have a shift waiting then",
          "A shift you proposed for " + v.day() + " is still waiting for an answer.");
    }
    return null;
  }

  private ProposalProblemException blocked(List<Checked> checked) {
    List<Map<String, Object>> items = new ArrayList<>();
    for (Checked c : checked) {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("index", c.item().index());
      entry.put("unit", c.item().unitCode());
      entry.put("shiftTemplate", c.item().input().shiftTemplate());
      entry.put("startAt", c.item().input().startAt().toString());
      entry.put("outcome", c.outcome().outcome());
      entry.put("ruleResults", c.outcome().ruleResults());
      items.add(entry);
    }
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put("outcome", "BLOCK");
    extra.put("items", items);
    return new ProposalProblemException(
        422,
        "blocked-by-rules",
        "A shift in this proposal breaks a rule",
        "A shift that breaks a Block rule can't be sent. Remove it or change it.",
        extra);
  }

  private static boolean isBlock(RuleCheckService.OutcomeView outcome) {
    return "BLOCK".equals(outcome.outcome());
  }

  private static String worst(List<Checked> checked) {
    if (checked.stream().anyMatch(c -> isBlock(c.outcome()))) {
      return "BLOCK";
    }
    return checked.stream().anyMatch(c -> "WARN".equals(c.outcome().outcome())) ? "WARN" : "PASS";
  }

  private static List<String> warnCodes(RuleCheckService.OutcomeView outcome) {
    return outcome.ruleResults().stream()
        .filter(result -> "WARN".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  private ProposalView load(UUID proposalId) {
    return loadAll(List.of(proposalId)).get(0);
  }

  private List<ProposalView> loadAll(List<UUID> ids) {
    if (ids.isEmpty()) {
      return List.of();
    }
    String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
    List<Map<String, Object>> proposals =
        jdbc.queryForList(
            "SELECT id, status, note, submitted_at, withdrawn_at, version FROM proposal"
                + " WHERE id IN (" + marks + ")",
            ids.toArray());
    Map<UUID, List<ItemView>> itemsByProposal = new LinkedHashMap<>();
    jdbc.query(
        "SELECT i.id, i.proposal_id, i.unit_id, u.code AS unit_code, u.name AS unit_name,"
            + " t.code AS template_code, i.start_at, i.end_at, i.work_date, i.decision,"
            + " i.rule_snapshot::text AS rule_snapshot, i.comment, i.decided_at,"
            + " d.display_name AS decided_by"
            + " FROM proposal_item i JOIN unit u ON u.id = i.unit_id"
            + " JOIN shift_template t ON t.id = i.shift_template_id"
            + " LEFT JOIN app_user d ON d.id = i.decided_by"
            + " WHERE i.proposal_id IN (" + marks + ") ORDER BY i.start_at, i.sort_order",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> {
              Object snapshot = parse(rs.getString("rule_snapshot"));
              String outcome =
                  snapshot instanceof Map<?, ?> map && map.get("outcome") != null
                      ? map.get("outcome").toString()
                      : null;
              Timestamp decidedAt = rs.getTimestamp("decided_at");
              itemsByProposal
                  .computeIfAbsent(rs.getObject("proposal_id", UUID.class), key -> new ArrayList<>())
                  .add(
                      new ItemView(
                          rs.getObject("id", UUID.class),
                          rs.getObject("unit_id", UUID.class),
                          rs.getString("unit_code"),
                          rs.getString("unit_name"),
                          rs.getString("template_code"),
                          rs.getTimestamp("start_at").toInstant(),
                          rs.getTimestamp("end_at").toInstant(),
                          rs.getDate("work_date") == null
                              ? null
                              : rs.getDate("work_date").toLocalDate(),
                          rs.getString("decision"),
                          outcome,
                          snapshot,
                          rs.getString("decided_by"),
                          decidedAt == null ? null : decidedAt.toInstant(),
                          rs.getString("comment")));
            },
        ids.toArray());
    Map<UUID, Map<String, Object>> byId = new LinkedHashMap<>();
    for (Map<String, Object> row : proposals) {
      byId.put((UUID) row.get("id"), row);
    }
    List<ProposalView> views = new ArrayList<>();
    for (UUID id : ids) {
      Map<String, Object> row = byId.get(id);
      if (row == null) {
        continue;
      }
      List<ItemView> items = itemsByProposal.getOrDefault(id, List.of());
      String status = (String) row.get("status");
      Timestamp withdrawn = (Timestamp) row.get("withdrawn_at");
      views.add(
          new ProposalView(
              id,
              status,
              displayState(status, items),
              (String) row.get("note"),
              ((Timestamp) row.get("submitted_at")).toInstant(),
              withdrawn == null ? null : withdrawn.toInstant(),
              ((Number) row.get("version")).intValue(),
              "WAITING".equals(status)
                  && !items.isEmpty()
                  && items.stream().allMatch(item -> "PENDING".equals(item.decision())),
              items));
    }
    return views;
  }

  /** Waiting, Approved, Partly approved, Declined, Withdrawn or Expired (plan §1.1). */
  static String displayState(String status, List<ItemView> items) {
    if ("WITHDRAWN".equals(status)) {
      return "WITHDRAWN";
    }
    long pending = items.stream().filter(i -> "PENDING".equals(i.decision())).count();
    long accepted = items.stream().filter(i -> "ACCEPTED".equals(i.decision())).count();
    long declined = items.stream().filter(i -> "DECLINED".equals(i.decision())).count();
    if (pending > 0) {
      return "WAITING";
    }
    if (accepted > 0) {
      return accepted == items.size() ? "APPROVED" : "PARTLY_APPROVED";
    }
    if (declined > 0 && declined == items.size()) {
      return "DECLINED";
    }
    return "EXPIRED";
  }

  private Object parse(String json) {
    if (json == null) {
      return null;
    }
    return mapper.readValue(json, Object.class);
  }

  // ---------------------------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------------------------

  /** The same per-officer advisory lock the board and the overtime confirm take. */
  private void lockOfficer(UUID employeeId) {
    long key = employeeId.getMostSignificantBits() ^ employeeId.getLeastSignificantBits();
    jdbc.queryForList("SELECT pg_advisory_xact_lock(?)", Object.class, key);
  }

  /** The version from an If-Match header (428 when absent, 400 when it isn't a number). */
  static int parseIfMatch(String ifMatch) {
    if (ifMatch == null || ifMatch.isBlank()) {
      throw ProposalProblemException.of(
          428,
          "if-match-required",
          "If-Match is required",
          "Send the version you read, as If-Match: \"3\".");
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
          HttpStatus.BAD_REQUEST, "If-Match must be the proposal's version, for example \"3\"");
    }
  }

  private void audit(
      AuthPrincipal principal,
      String action,
      String entityType,
      UUID entityId,
      Map<String, Object> before,
      Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, before, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, ?, ?, ?::jsonb, ?::jsonb)",
        principal.username(),
        action,
        entityType,
        entityId,
        before == null ? null : mapper.writeValueAsString(before),
        mapper.writeValueAsString(after));
  }
}
