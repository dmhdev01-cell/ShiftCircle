package ca.shiftcircle.api.proposals;

import ca.shiftcircle.api.assignments.AssignmentWriter;
import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.overtime.OvertimeService;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.SelfActionGuard;
import ca.shiftcircle.api.time.BusinessClock;
import ca.shiftcircle.api.units.ActiveUnits;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.pay.PayClassifier;
import ca.shiftcircle.rules.pay.PayPolicy;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * The decider's side of shift proposals (v1.3 P2, plan .factory/plans/v1.2-proposals.md §2, §4;
 * docs/07 §4.4): the inbox, the detail with the rule result as sent and as of now, and the
 * decision.
 *
 * <p><b>Who decides.</b> A SUPERVISOR decides the items on units in their scope; the PLANNER sees
 * and decides every item, so a unit no supervisor scopes and a supervisor's own proposal always
 * have a decider (owner Q4). Nobody decides their own proposal ({@link SelfActionGuard}, the same
 * predicate the supervisors' self-edit guard uses). A proposal with no item in the caller's scope
 * is "not found" (404), so nobody learns it exists; naming an item outside your scope in a
 * decision you can otherwise see is 403.
 *
 * <p><b>Approving.</b> Every accepted item is checked again now, in start order, with the items
 * accepted earlier in the same send as extra facts and <em>before any of them is saved</em>
 * (the {@link RuleCheckService#evaluateWithExtras} contract: an extra must not already be in
 * {@code shift_assignment}). A Block refuses the whole send with 422 and nothing saved; there is
 * no override from a proposal (owner Q3). A Warn needs the current codes acknowledged. Only then
 * is each shift written through {@link AssignmentWriter}, the board's own write path, as an
 * {@code EXTRA} / {@code PROPOSAL} assignment. An item that matches an open shift fills it and
 * withdraws its live offers; approving someone who is not first in the overtime order needs its
 * own acknowledgement, which is stored and audited (owner Q1).
 */
@Service
public class ProposalDecisionService {

  static final int MAX_COMMENT = 500;
  static final int MIN_DECLINE_COMMENT = 3;
  private static final int INBOX_LIMIT = 200;
  private static final String SELF_MESSAGE =
      "You can't approve your own proposal; another supervisor or the planner will.";

  // --------------------------------------------------------------------------------------------
  // Views and requests
  // --------------------------------------------------------------------------------------------

  public record InboxCard(
      UUID id,
      UUID employeeId,
      String officerName,
      String homeUnit,
      List<String> units,
      int itemCount,
      int itemsInScope,
      int waitingInScope,
      Instant submittedAt,
      String status,
      String displayState,
      int version,
      boolean own) {}

  public record CountView(String status, int count) {}

  /**
   * The officer's hours in the pay period of the item, before and after it (the board's U-15
   * figure), and the overtime the item would add under P-01/P-04 (owner Q5).
   */
  public record PayPeriodView(
      LocalDate start,
      LocalDate end,
      double hoursBefore,
      double hoursAfter,
      double thresholdHours,
      double wouldBeOvertimeHours,
      String overtimeStatus) {}

  public record OpenShiftMatch(
      UUID id,
      String status,
      Integer otOrderPosition,
      int otOrderSize,
      String eligibility,
      boolean outOfOrder,
      int liveOffers) {}

  public record ItemView(
      UUID id,
      UUID unitId,
      String unit,
      String unitName,
      String shiftTemplate,
      Instant startAt,
      Instant endAt,
      LocalDate workDate,
      double hours,
      String decision,
      boolean inScope,
      boolean canDecide,
      String outcomeAtSubmit,
      Object ruleAtSubmit,
      String outcomeNow,
      RuleCheckService.OutcomeView ruleNow,
      boolean ruleChanged,
      Double wouldBeOvertimeHours,
      PayPeriodView payPeriod,
      OpenShiftMatch openShift,
      String decidedBy,
      Instant decidedAt,
      String comment,
      List<String> acknowledgedCodes,
      boolean outOfOvertimeOrder,
      UUID assignmentId) {}

  public record DetailView(
      UUID id,
      String status,
      String displayState,
      int version,
      String note,
      Instant submittedAt,
      Instant withdrawnAt,
      UUID employeeId,
      String officerName,
      String homeUnit,
      boolean own,
      boolean canDecide,
      List<ItemView> items) {}

  public record DecisionItem(
      UUID id,
      Boolean accept,
      String comment,
      List<String> acknowledgeWarnings,
      Boolean acknowledgeOutOfOrder) {}

  public record DecisionRequest(List<DecisionItem> items) {}

  /** A stored item, as read for the detail and the decision. */
  private record Row(
      UUID id,
      UUID unitId,
      String unitCode,
      String unitName,
      UUID templateId,
      String templateCode,
      Instant startAt,
      Instant endAt,
      LocalDate workDate,
      String decision,
      String ruleSnapshot,
      String decisionSnapshot,
      String decidedBy,
      Instant decidedAt,
      String comment,
      List<String> acknowledgedCodes,
      boolean outOfOtOrder,
      UUID assignmentId,
      UUID openShiftId) {}

  private record Proposal(
      UUID id,
      UUID employeeId,
      String officerName,
      String homeUnit,
      String status,
      String note,
      Instant submittedAt,
      Instant withdrawnAt,
      int version,
      List<Row> items) {}

  /** One accepted item after its fresh check, before anything is written. */
  private record Planned(
      Row row,
      DecisionItem input,
      RuleCheckService.OutcomeView outcome,
      UUID openShiftId,
      OvertimeService.OrderPosition order) {}

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final PublishedRuleSet published;
  private final BusinessClock clock;
  private final ActiveUnits activeUnits;
  private final ProposalExpiry expiry;
  private final AssignmentWriter writer;
  private final OvertimeService overtime;
  private final PayClassifier classifier = new PayClassifier();
  private final ObjectMapper mapper = new ObjectMapper();

  public ProposalDecisionService(
      JdbcTemplate jdbc,
      RuleCheckService ruleChecks,
      PublishedRuleSet published,
      BusinessClock clock,
      ActiveUnits activeUnits,
      ProposalExpiry expiry,
      AssignmentWriter writer,
      OvertimeService overtime) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
    this.published = published;
    this.clock = clock;
    this.activeUnits = activeUnits;
    this.expiry = expiry;
    this.writer = writer;
    this.overtime = overtime;
  }

  // --------------------------------------------------------------------------------------------
  // Inbox
  // --------------------------------------------------------------------------------------------

  /**
   * Proposals with at least one item in the caller's scope, newest first (at most 200). WAITING
   * keeps those with a waiting item in scope; ALL keeps every one. Expiry is applied first for the
   * officers whose waiting items have started, so a started shift never shows as waiting.
   */
  @Transactional
  public List<InboxCard> inbox(
      String status, UUID unitId, LocalDate from, LocalDate to, AuthPrincipal principal) {
    boolean waitingOnly = waitingOnly(status);
    String unitFilter = null;
    if (unitId != null) {
      List<String> codes = jdbc.queryForList("SELECT code FROM unit WHERE id = ?", String.class, unitId);
      if (codes.isEmpty() || !inScope(principal, codes.get(0))) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unit not found");
      }
      unitFilter = codes.get(0);
    }
    if (!principal.hasRole("PLANNER") && principal.units().isEmpty()) {
      return List.of();
    }
    expireStarted(principal);

    StringBuilder sql =
        new StringBuilder(
            "SELECT p.id FROM proposal p WHERE EXISTS (SELECT 1 FROM proposal_item i"
                + " JOIN unit u ON u.id = i.unit_id WHERE i.proposal_id = p.id");
    List<Object> args = new ArrayList<>();
    appendScope(sql, args, principal);
    if (waitingOnly) {
      sql.append(" AND i.decision = 'PENDING'");
    }
    if (unitFilter != null) {
      sql.append(" AND u.code = ?");
      args.add(unitFilter);
    }
    if (from != null) {
      sql.append(" AND i.work_date >= ?");
      args.add(from);
    }
    if (to != null) {
      sql.append(" AND i.work_date <= ?");
      args.add(to);
    }
    sql.append(") ORDER BY p.submitted_at DESC, p.seq DESC LIMIT ").append(INBOX_LIMIT);
    List<UUID> ids = jdbc.queryForList(sql.toString(), UUID.class, args.toArray());
    if (ids.isEmpty()) {
      return List.of();
    }

    String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
    Map<UUID, List<Map<String, Object>>> items = new LinkedHashMap<>();
    for (Map<String, Object> row :
        jdbc.queryForList(
            "SELECT i.proposal_id, i.decision, u.code FROM proposal_item i"
                + " JOIN unit u ON u.id = i.unit_id WHERE i.proposal_id IN (" + marks + ")"
                + " ORDER BY i.start_at, i.sort_order",
            ids.toArray())) {
      items.computeIfAbsent((UUID) row.get("proposal_id"), key -> new ArrayList<>()).add(row);
    }
    Map<UUID, Map<String, Object>> heads = new LinkedHashMap<>();
    for (Map<String, Object> row :
        jdbc.queryForList(
            "SELECT p.id, p.employee_id, p.status, p.submitted_at, p.version,"
                + " e.first_name || ' ' || e.last_name AS officer, hu.code AS home_unit"
                + " FROM proposal p JOIN employee e ON e.id = p.employee_id"
                + " LEFT JOIN unit hu ON hu.id = e.home_unit_id WHERE p.id IN (" + marks + ")",
            ids.toArray())) {
      heads.put((UUID) row.get("id"), row);
    }

    List<InboxCard> cards = new ArrayList<>();
    for (UUID id : ids) {
      Map<String, Object> head = heads.get(id);
      List<Map<String, Object>> rows = items.getOrDefault(id, List.of());
      Set<String> units = new TreeSet<>();
      int inScope = 0;
      int waiting = 0;
      for (Map<String, Object> row : rows) {
        String code = (String) row.get("code");
        if (inScope(principal, code)) {
          inScope++;
          units.add(code);
          if ("PENDING".equals(row.get("decision"))) {
            waiting++;
          }
        }
      }
      String rowStatus = (String) head.get("status");
      UUID employeeId = (UUID) head.get("employee_id");
      cards.add(
          new InboxCard(
              id,
              employeeId,
              (String) head.get("officer"),
              (String) head.get("home_unit"),
              List.copyOf(units),
              rows.size(),
              inScope,
              waiting,
              ((Timestamp) head.get("submitted_at")).toInstant(),
              rowStatus,
              ProposalService.displayStateOf(
                  rowStatus, rows.stream().map(r -> (String) r.get("decision")).toList()),
              ((Number) head.get("version")).intValue(),
              SelfActionGuard.isSelf(principal, employeeId)));
    }
    return cards;
  }

  /**
   * The nav count: proposals with a waiting item in the caller's scope that the caller may decide
   * (their own proposals are left out: someone else decides them).
   */
  @Transactional
  public CountView count(String status, AuthPrincipal principal) {
    if (status != null && !status.isBlank() && !"WAITING".equalsIgnoreCase(status.trim())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "status must be WAITING");
    }
    if (!principal.hasRole("PLANNER") && principal.units().isEmpty()) {
      return new CountView("WAITING", 0);
    }
    expireStarted(principal);
    StringBuilder sql =
        new StringBuilder(
            "SELECT count(*) FROM proposal p WHERE EXISTS (SELECT 1 FROM proposal_item i"
                + " JOIN unit u ON u.id = i.unit_id WHERE i.proposal_id = p.id"
                + " AND i.decision = 'PENDING'");
    List<Object> args = new ArrayList<>();
    appendScope(sql, args, principal);
    sql.append(")");
    if (principal.employeeId() != null) {
      sql.append(" AND p.employee_id <> ?");
      args.add(principal.employeeId());
    }
    Integer count = jdbc.queryForObject(sql.toString(), Integer.class, args.toArray());
    return new CountView("WAITING", count == null ? 0 : count);
  }

  // --------------------------------------------------------------------------------------------
  // Detail
  // --------------------------------------------------------------------------------------------

  @Transactional
  public DetailView detail(UUID proposalId, AuthPrincipal principal) {
    UUID employeeId = visibleProposer(proposalId, principal);
    expiry.apply(employeeId);
    return view(load(proposalId), principal);
  }

  private DetailView view(Proposal proposal, AuthPrincipal principal) {
    boolean own = SelfActionGuard.isSelf(principal, proposal.employeeId());
    PublishedRuleSet.Snapshot live = published.snapshot();
    PayPolicy policy = classifier.policyFrom(live.ruleSet());

    // "Rules now" is read the way the officer's send was: each waiting item with the waiting items
    // that start before it as extra facts, so "was / now" compares like with like. None of them is
    // in shift_assignment, so nothing is counted twice. Items outside the caller's scope are facts
    // only (no evaluation is spent on them). Note for the inbox screen: the decision's own gate
    // uses only the items accepted earlier in the same send, so an item can show a Warn here that
    // the decision does not ask about when the earlier item is declined (docs/07 §4.4).
    Map<UUID, RuleCheckService.OutcomeView> now = new LinkedHashMap<>();
    List<ShiftFact> earlier = new ArrayList<>();
    for (Row row : proposal.items()) {
      if (!"PENDING".equals(row.decision())) {
        continue;
      }
      RuleCheckService.Change change = change(proposal.employeeId(), row);
      if (inScope(principal, row.unitCode())) {
        now.put(row.id(), ruleChecks.evaluateWithExtras(change, earlier, live));
      }
      earlier.add(ruleChecks.factOf(change, "waiting-" + row.id()));
    }

    List<ItemView> items = new ArrayList<>();
    boolean anyDecidable = false;
    for (Row row : proposal.items()) {
      boolean inScope = inScope(principal, row.unitCode());
      boolean pending = "PENDING".equals(row.decision());
      boolean canDecide = inScope && pending && !own;
      anyDecidable |= canDecide;
      if (!inScope) {
        // Another decider's item: what and its outcome, nothing to act on.
        items.add(
            new ItemView(
                row.id(), row.unitId(), row.unitCode(), row.unitName(), row.templateCode(),
                row.startAt(), row.endAt(), row.workDate(), hours(row), row.decision(), false,
                false, null, null, null, null, false, null, null, null, row.decidedBy(),
                row.decidedAt(), null, List.of(), false, null));
        continue;
      }
      Object atSubmit = parse(row.ruleSnapshot());
      String outcomeAtSubmit = outcomeOf(atSubmit);
      RuleCheckService.OutcomeView ruleNow = now.get(row.id());
      boolean changed =
          ruleNow != null
              && (!Objects.equals(outcomeAtSubmit, ruleNow.outcome())
                  || !flagged(atSubmit).equals(flagged(ruleNow)));
      PayPeriodView pay =
          pending ? payPeriod(proposal.employeeId(), row.workDate(), hours(row), policy) : null;
      OpenShiftMatch match = null;
      if (pending) {
        UUID openShiftId = matchOpenShift(row);
        if (openShiftId != null) {
          match = matchView(openShiftId, proposal.employeeId(), principal, live);
        }
      }
      items.add(
          new ItemView(
              row.id(),
              row.unitId(),
              row.unitCode(),
              row.unitName(),
              row.templateCode(),
              row.startAt(),
              row.endAt(),
              row.workDate(),
              hours(row),
              row.decision(),
              true,
              canDecide,
              outcomeAtSubmit,
              atSubmit,
              ruleNow == null ? null : ruleNow.outcome(),
              ruleNow,
              changed,
              pay == null ? null : pay.wouldBeOvertimeHours(),
              pay,
              match,
              row.decidedBy(),
              row.decidedAt(),
              row.comment(),
              row.acknowledgedCodes(),
              row.outOfOtOrder(),
              row.assignmentId()));
    }
    return new DetailView(
        proposal.id(),
        proposal.status(),
        ProposalService.displayStateOf(
            proposal.status(), proposal.items().stream().map(Row::decision).toList()),
        proposal.version(),
        proposal.note(),
        proposal.submittedAt(),
        proposal.withdrawnAt(),
        proposal.employeeId(),
        proposal.officerName(),
        proposal.homeUnit(),
        own,
        anyDecidable,
        items);
  }

  // --------------------------------------------------------------------------------------------
  // Decision
  // --------------------------------------------------------------------------------------------

  /**
   * Accept or decline items, in item start order, in one transaction. Order of checks: visibility
   * (404) → self-approval (403) → body (400) → item scope (403) → If-Match (428/400) → locks and
   * expiry → state (409) → version (412) → locked period / closed unit (409) → rules and overtime
   * order (422) → write.
   */
  @Transactional
  public DetailView decide(
      UUID proposalId, String ifMatch, DecisionRequest request, AuthPrincipal principal) {
    UUID employeeId = visibleProposer(proposalId, principal);
    SelfActionGuard.requireNotSelf(principal, employeeId, SELF_MESSAGE);
    Map<UUID, DecisionItem> wanted = validate(request);

    Proposal observed = load(proposalId);
    Map<UUID, Row> byId = new LinkedHashMap<>();
    observed.items().forEach(row -> byId.put(row.id(), row));
    for (UUID itemId : wanted.keySet()) {
      Row row = byId.get(itemId);
      if (row == null) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "Item " + itemId + " is not part of this proposal");
      }
      if (!inScope(principal, row.unitCode())) {
        throw new ResponseStatusException(
            HttpStatus.FORBIDDEN,
            "The shift on " + row.unitCode() + " is outside your units; its supervisor or the"
                + " planner decides it.");
      }
    }
    int expected = ProposalService.parseIfMatch(ifMatch);

    // Lock order, as the overtime confirm: the open shift rows first, then the officer. A confirm
    // of an offer for the same shift and this approval then serialise instead of deadlocking.
    List<UUID> shifts = new ArrayList<>();
    for (Map.Entry<UUID, DecisionItem> entry : wanted.entrySet()) {
      if (Boolean.TRUE.equals(entry.getValue().accept())) {
        UUID match = matchOpenShift(byId.get(entry.getKey()));
        if (match != null) {
          shifts.add(match);
        }
      }
    }
    shifts.stream().distinct().sorted().forEach(this::lockOpenShift);
    lockOfficer(employeeId);
    expiry.apply(employeeId);
    // The item rows are locked for the rest of the decision. The hourly sweep takes no officer
    // lock, but it skips locked rows (SKIP LOCKED), so nothing can expire or change an item between
    // the state check below and the write; the rowcount checks at the write are the backstop.
    jdbc.queryForList(
        "SELECT id FROM proposal_item WHERE proposal_id = ? ORDER BY id FOR UPDATE",
        UUID.class,
        proposalId);

    Proposal proposal = load(proposalId);
    if ("WITHDRAWN".equals(proposal.status())) {
      throw ProposalProblemException.of(
          409,
          "proposal-withdrawn",
          "This proposal was withdrawn",
          "The officer withdrew it, so there is nothing to decide.");
    }
    Map<UUID, Row> current = new LinkedHashMap<>();
    proposal.items().forEach(row -> current.put(row.id(), row));
    List<Row> chosen =
        wanted.keySet().stream()
            .map(current::get)
            .sorted(Comparator.comparing(Row::startAt).thenComparing(Row::id))
            .toList();
    for (Row row : chosen) {
      if ("EXPIRED".equals(row.decision())) {
        throw ProposalProblemException.of(
            409,
            "shift-started",
            "This shift has already started",
            "The shift on " + row.workDate() + " started before anyone answered, so it expired.");
      }
      if (!"PENDING".equals(row.decision())) {
        throw ProposalProblemException.of(
            409,
            "already-decided",
            "This shift was already answered",
            "The shift on " + row.workDate() + " is " + row.decision().toLowerCase()
                + ". Reload the proposal.");
      }
    }

    // The version is checked after the state: an expiry applied just above bumps the version, and
    // "this shift has started" is the answer the decider can act on, not "reload".
    if (proposal.version() != expected) {
      throw ProposalProblemException.of(
          412,
          "stale-version",
          "This proposal changed since you read it",
          "Reload the proposal and decide again.");
    }

    // The fresh check, before anything is written.
    PublishedRuleSet.Snapshot live = published.snapshot();
    List<Planned> planned = new ArrayList<>();
    List<ShiftFact> acceptedEarlier = new ArrayList<>();
    for (Row row : chosen) {
      DecisionItem input = wanted.get(row.id());
      if (!Boolean.TRUE.equals(input.accept())) {
        planned.add(new Planned(row, input, null, null, null));
        continue;
      }
      requireOpenState(row);
      RuleCheckService.Change change = change(employeeId, row);
      RuleCheckService.OutcomeView outcome =
          ruleChecks.evaluateWithExtras(change, acceptedEarlier, live);
      acceptedEarlier.add(ruleChecks.factOf(change, "accepted-" + row.id()));
      UUID openShiftId = matchOpenShift(row);
      OvertimeService.OrderPosition order =
          openShiftId == null
              ? null
              : overtime.orderPosition(openShiftId, employeeId, principal, live);
      planned.add(new Planned(row, input, outcome, openShiftId, order));
    }
    refuseIfRulesSayNo(planned);

    // Write, in start order. The writer is handed the result checked above, so the rule result
    // that is enforced is the one stored and audited (one evaluation per item, one rule snapshot).
    Timestamp decidedAt = Timestamp.from(clock.now());
    for (Planned plan : planned) {
      Row row = plan.row();
      DecisionItem input = plan.input();
      String comment = cleanComment(input.comment());
      Map<String, Object> after = new LinkedHashMap<>();
      after.put("itemId", row.id().toString());
      after.put("employeeId", employeeId.toString());
      after.put("unit", row.unitCode());
      after.put("template", row.templateCode());
      after.put("startAt", row.startAt().toString());
      if (plan.outcome() == null) {
        int declined =
            jdbc.update(
            "UPDATE proposal_item SET decision = 'DECLINED', decided_by ="
                + " (SELECT id FROM app_user WHERE username = ?), decided_at = ?, comment = ?"
                + " WHERE id = ? AND decision = 'PENDING'",
            principal.username(),
            decidedAt,
            comment,
            row.id());
        requireOneRow(declined, row);
        after.put("decision", "DECLINED");
        after.put("comment", comment);
        audit(principal, "decide_proposal_item", "proposal", proposalId, after);
        continue;
      }

      // The clock is read again at the write: a shift that started while the rules ran (the item
      // rows are locked, so the sweep could not expire it) is refused like an expired one.
      if (!row.startAt().isAfter(clock.now())) {
        throw ProposalProblemException.of(
            409,
            "shift-started",
            "This shift has already started",
            "The shift on " + row.workDate() + " started while you decided.");
      }
      List<String> acknowledged = codes(plan.outcome(), "WARN");
      Map<String, Object> extras = new LinkedHashMap<>();
      extras.put("source", "PROPOSAL");
      extras.put("proposalId", proposalId.toString());
      extras.put("proposalItemId", row.id().toString());
      AssignmentWriter.Written written =
          writer.create(
              new AssignmentWriter.NewShift(
                  change(employeeId, row),
                  input.acknowledgeWarnings(),
                  null,
                  false,
                  "PROPOSAL",
                  extras,
                  plan.outcome()),
              principal);

      int offersWithdrawn = 0;
      boolean outOfOrder = plan.order() != null && plan.order().outOfOrder();
      if (plan.openShiftId() != null) {
        int filled =
            jdbc.update(
                "UPDATE open_shift SET status = 'FILLED', filled_assignment_id = ?"
                    + " WHERE id = ? AND status IN ('OPEN', 'OFFERED')",
                written.assignmentId(),
                plan.openShiftId());
        if (filled != 1) {
          throw ProposalProblemException.of(
              409,
              "open-shift-filled",
              "The matching open shift was filled meanwhile",
              "Reload the proposal and decide again.");
        }
        // The shift is taken: the offers still waiting for an answer are withdrawn (plan §4), so
        // nobody accepts a shift that no longer exists. An offer the officer already ACCEPTED is
        // left as it is: the overtime confirm refuses it with its own 409 "already filled".
        offersWithdrawn =
            jdbc.update(
                "UPDATE overtime_offer SET status = 'WITHDRAWN', version = version + 1"
                    + " WHERE open_shift_id = ? AND status = 'OFFERED'",
                plan.openShiftId());
      }

      int accepted =
          jdbc.update(
          "UPDATE proposal_item SET decision = 'ACCEPTED', decided_by ="
              + " (SELECT id FROM app_user WHERE username = ?), decided_at = ?, comment = ?,"
              + " assignment_id = ?, decision_snapshot = ?::jsonb, acknowledged_codes = ?,"
              + " out_of_ot_order = ?, open_shift_id = ?"
              + " WHERE id = ? AND decision = 'PENDING'",
          principal.username(),
          decidedAt,
          comment,
          written.assignmentId(),
          mapper.writeValueAsString(plan.outcome()),
          acknowledged.toArray(new String[0]),
          outOfOrder,
          plan.openShiftId(),
          row.id());
      requireOneRow(accepted, row);
      after.put("decision", "ACCEPTED");
      after.put("comment", comment);
      after.put("outcomeNow", plan.outcome().outcome());
      after.put("acknowledgedCodes", acknowledged);
      after.put("assignmentId", written.assignmentId().toString());
      after.put("openShiftId", plan.openShiftId() == null ? null : plan.openShiftId().toString());
      after.put("offersWithdrawn", offersWithdrawn);
      after.put("outOfOvertimeOrder", outOfOrder);
      if (plan.order() != null) {
        after.put("otOrderPosition", plan.order().position());
        after.put("otOrderSize", plan.order().size());
      }
      audit(principal, "decide_proposal_item", "proposal", proposalId, after);
    }

    int bumped =
        jdbc.update(
            "UPDATE proposal SET version = version + 1, decided_by ="
                + " (SELECT id FROM app_user WHERE username = ?), decided_at = ?, status ="
                + " CASE WHEN EXISTS (SELECT 1 FROM proposal_item WHERE proposal_id = proposal.id"
                + "                   AND decision = 'PENDING') THEN 'WAITING' ELSE 'DECIDED' END"
                + " WHERE id = ? AND version = ? AND status = 'WAITING'",
            principal.username(),
            decidedAt,
            proposalId,
            proposal.version());
    if (bumped != 1) {
      // Something changed the proposal underneath: throwing rolls back every shift, fill and
      // audit row this decision wrote.
      throw ProposalProblemException.of(
          412,
          "stale-version",
          "This proposal changed since you read it",
          "Reload the proposal and decide again.");
    }
    return view(load(proposalId), principal);
  }

  /**
   * One item row must change. Zero means it was expired, withdrawn or answered underneath this
   * decision; the exception rolls back everything the decision wrote (no orphan shift, no audit).
   */
  private void requireOneRow(int updated, Row row) {
    if (updated == 1) {
      return;
    }
    String now =
        jdbc.queryForObject(
            "SELECT decision FROM proposal_item WHERE id = ?", String.class, row.id());
    if ("EXPIRED".equals(now)) {
      throw ProposalProblemException.of(
          409,
          "shift-started",
          "This shift has already started",
          "The shift on " + row.workDate() + " started before anyone answered, so it expired.");
    }
    throw ProposalProblemException.of(
        409,
        "already-decided",
        "This shift was already answered",
        "The shift on " + row.workDate() + " changed while you decided. Reload the proposal.");
  }

  /** Block first, then unacknowledged warnings, then the overtime order: one 422 per send. */
  private void refuseIfRulesSayNo(List<Planned> planned) {
    List<Planned> accepted = planned.stream().filter(p -> p.outcome() != null).toList();
    if (accepted.stream().anyMatch(p -> "BLOCK".equals(p.outcome().outcome()))) {
      throw refusal(
          "blocked-by-rules",
          "A shift you approved breaks a rule now",
          "A shift that breaks a Block rule can't be approved from a proposal. Decline it, or"
              + " decline and use the planning board, which has its own emergency override.",
          accepted);
    }
    boolean unacknowledged =
        accepted.stream()
            .anyMatch(
                p ->
                    !(p.input().acknowledgeWarnings() == null
                            ? List.<String>of()
                            : p.input().acknowledgeWarnings())
                        .containsAll(codes(p.outcome(), "WARN")));
    if (unacknowledged) {
      throw refusal(
          "warnings-need-acknowledgement",
          "Warnings need acknowledgement",
          "Acknowledge the current warnings of each shift you approve (acknowledgeWarnings).",
          accepted);
    }
    boolean outOfOrder =
        accepted.stream()
            .anyMatch(
                p ->
                    p.order() != null
                        && p.order().outOfOrder()
                        && !Boolean.TRUE.equals(p.input().acknowledgeOutOfOrder()));
    if (outOfOrder) {
      throw refusal(
          "out-of-overtime-order",
          "This approval is outside the overtime order",
          "The shift matches an open shift and someone ranks ahead of this officer in the overtime"
              + " order. Confirm that you are approving outside the overtime order"
              + " (acknowledgeOutOfOrder).",
          accepted);
    }
  }

  private ProposalProblemException refusal(
      String slug, String title, String detail, List<Planned> accepted) {
    List<Map<String, Object>> items = new ArrayList<>();
    for (Planned p : accepted) {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("id", p.row().id().toString());
      entry.put("unit", p.row().unitCode());
      entry.put("shiftTemplate", p.row().templateCode());
      entry.put("startAt", p.row().startAt().toString());
      entry.put("outcome", p.outcome().outcome());
      entry.put("warnCodes", codes(p.outcome(), "WARN"));
      entry.put("ruleResults", p.outcome().ruleResults());
      if (p.order() != null) {
        entry.put("otOrderPosition", p.order().position());
        entry.put("otOrderSize", p.order().size());
        entry.put("outOfOrder", p.order().outOfOrder());
      }
      items.add(entry);
    }
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put("items", items);
    return new ProposalProblemException(422, slug, title, detail, extra);
  }

  private Map<UUID, DecisionItem> validate(DecisionRequest request) {
    if (request == null || request.items() == null || request.items().isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "items is required: decide at least one shift");
    }
    Map<UUID, DecisionItem> wanted = new LinkedHashMap<>();
    for (DecisionItem item : request.items()) {
      if (item == null || item.id() == null || item.accept() == null) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "Each item needs id and accept (true or false)");
      }
      if (item.acknowledgeWarnings() != null && item.acknowledgeWarnings().size() > 50) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "acknowledgeWarnings lists at most 50 codes");
      }
      if (wanted.put(item.id(), item) != null) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "Item " + item.id() + " is listed twice");
      }
      String comment = cleanComment(item.comment());
      if (comment != null && comment.length() > MAX_COMMENT) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "comment must be at most " + MAX_COMMENT + " characters");
      }
      if (!item.accept() && (comment == null || comment.length() < MIN_DECLINE_COMMENT)) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST,
            "A declined shift needs a comment of at least " + MIN_DECLINE_COMMENT
                + " characters, so the officer knows why");
      }
    }
    return wanted;
  }

  private static String cleanComment(String comment) {
    return comment == null || comment.isBlank() ? null : comment.trim();
  }

  /** A locked pay period or a closed unit refuses the approval, as the board and the send do. */
  private void requireOpenState(Row row) {
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT status FROM pay_period WHERE ? BETWEEN start_date AND end_date", row.workDate());
    if (!periods.isEmpty() && "LOCKED".equals(periods.get(0).get("status"))) {
      throw ProposalProblemException.of(
          409,
          "pay-period-locked",
          "This pay period is locked",
          "The pay period for " + row.workDate() + " is locked, so no shift can be added to it.");
    }
    Boolean unitOpen =
        jdbc.queryForObject("SELECT active FROM unit WHERE id = ?", Boolean.class, row.unitId());
    if (!Boolean.TRUE.equals(unitOpen) || !activeUnits.active(row.unitId(), row.workDate())) {
      throw ProposalProblemException.of(
          409,
          "unit-closed",
          "That unit is closed on that date",
          row.unitCode() + " is closed on " + row.workDate() + ", so it needs no extra staff then.");
    }
    Boolean templateActive =
        jdbc.queryForObject(
            "SELECT active FROM shift_template WHERE id = ?", Boolean.class, row.templateId());
    if (!Boolean.TRUE.equals(templateActive)) {
      throw ProposalProblemException.of(
          409,
          "shift-type-retired",
          "That shift type was retired",
          "The " + row.templateCode() + " shift on " + row.workDate() + " uses a shift type that"
              + " was retired after it was sent. Decline it; the officer can propose another.");
    }
  }

  // --------------------------------------------------------------------------------------------
  // Overtime: pay-period hours and the open-shift match
  // --------------------------------------------------------------------------------------------

  /**
   * The officer's hours in the item's pay period, read as the planning board reads them for the
   * U-15 pill: recorded actuals for past days, scheduled hours from the business "today" on. The
   * overtime the item adds is what P-01/P-04 classify above the threshold once it is added.
   */
  private PayPeriodView payPeriod(
      UUID employeeId, LocalDate workDate, double itemHours, PayPolicy policy) {
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT id, start_date, end_date FROM pay_period"
                + " WHERE ? BETWEEN start_date AND end_date",
            workDate);
    if (periods.isEmpty()) {
      return null;
    }
    Map<String, Object> period = periods.get(0);
    LocalDate start = ((java.sql.Date) period.get("start_date")).toLocalDate();
    LocalDate end = ((java.sql.Date) period.get("end_date")).toLocalDate();
    Double sum =
        jdbc.queryForObject(
            "WITH recorded AS ("
                + "  SELECT employee_id, work_date, sum(hours) AS actual FROM time_entry"
                + "  WHERE pay_period_id = ? AND employee_id = ? AND absence_type IS NULL"
                + "  GROUP BY employee_id, work_date)"
                + " SELECT coalesce(sum(coalesce(r.actual,"
                + "   CASE WHEN a.work_date >= ?"
                + "     THEN extract(epoch from (a.end_at - a.start_at)) / 3600.0 ELSE 0 END)), 0)"
                + " FROM shift_assignment a"
                + " LEFT JOIN recorded r ON r.employee_id = a.employee_id AND r.work_date = a.work_date"
                + " WHERE a.employee_id = ? AND a.status <> 'CANCELLED'"
                + " AND a.work_date BETWEEN ? AND ?",
            Double.class,
            period.get("id"),
            employeeId,
            clock.today(),
            employeeId,
            start,
            end);
    double before = round2(sum == null ? 0 : sum);
    double after = round2(before + itemHours);
    double overtime = overtimeAdded(classifier, before, itemHours, policy);
    double threshold = policy.thresholdHours();
    String status =
        after >= threshold ? "IN_OVERTIME" : after >= threshold - 8 ? "APPROACHING" : "UNDER";
    return new PayPeriodView(start, end, before, after, threshold, overtime, status);
  }

  /**
   * The overtime hours an extra shift adds to a pay period that already holds {@code before} hours:
   * the P-01 threshold and the P-04 minimum decide it, exactly as payroll will.
   */
  static double overtimeAdded(
      PayClassifier classifier, double before, double itemHours, PayPolicy policy) {
    double after = round2(before + itemHours);
    return Math.max(
        0,
        round2(
            classifier.classify(after, policy).overtimeHours()
                - classifier.classify(before, policy).overtimeHours()));
  }

  /**
   * The open shift this item would fill: same unit, shift type and start, still OPEN or OFFERED.
   * The oldest one wins when there are two.
   */
  private UUID matchOpenShift(Row row) {
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT id FROM open_shift WHERE unit_id = ? AND shift_template_id = ? AND start_at = ?"
                + " AND status IN ('OPEN', 'OFFERED') ORDER BY created_at, id LIMIT 1",
            UUID.class,
            row.unitId(),
            row.templateId(),
            Timestamp.from(row.startAt()));
    return ids.isEmpty() ? null : ids.get(0);
  }

  private OpenShiftMatch matchView(
      UUID openShiftId, UUID employeeId, AuthPrincipal principal, PublishedRuleSet.Snapshot live) {
    String status =
        jdbc.queryForObject("SELECT status FROM open_shift WHERE id = ?", String.class, openShiftId);
    Integer offers =
        jdbc.queryForObject(
            "SELECT count(*) FROM overtime_offer WHERE open_shift_id = ?"
                + " AND status IN ('OFFERED', 'ACCEPTED')",
            Integer.class,
            openShiftId);
    OvertimeService.OrderPosition order =
        overtime.orderPosition(openShiftId, employeeId, principal, live);
    return new OpenShiftMatch(
        openShiftId,
        "OFFERED".equals(status) ? "OFFERS_SENT" : status,
        order.position(),
        order.size(),
        order.eligibility(),
        order.outOfOrder(),
        offers == null ? 0 : offers);
  }

  private void lockOpenShift(UUID openShiftId) {
    jdbc.queryForList("SELECT id FROM open_shift WHERE id = ? FOR UPDATE", UUID.class, openShiftId);
  }

  // --------------------------------------------------------------------------------------------
  // Reading and scope
  // --------------------------------------------------------------------------------------------

  /**
   * The proposer of a proposal the caller may see: the planner sees all, a supervisor those with
   * at least one item on a unit in scope. Anything else is 404, the same as a missing id.
   */
  private UUID visibleProposer(UUID proposalId, AuthPrincipal principal) {
    List<UUID> owner =
        jdbc.queryForList("SELECT employee_id FROM proposal WHERE id = ?", UUID.class, proposalId);
    if (owner.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Proposal not found");
    }
    if (!principal.hasRole("PLANNER")) {
      List<String> units =
          jdbc.queryForList(
              "SELECT DISTINCT u.code FROM proposal_item i JOIN unit u ON u.id = i.unit_id"
                  + " WHERE i.proposal_id = ?",
              String.class,
              proposalId);
      if (units.stream().noneMatch(code -> inScope(principal, code))) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Proposal not found");
      }
    }
    return owner.get(0);
  }

  private static boolean inScope(AuthPrincipal principal, String unitCode) {
    return principal.hasRole("PLANNER") || (unitCode != null && principal.scopesUnit(unitCode));
  }

  private static boolean waitingOnly(String status) {
    String wanted = status == null || status.isBlank() ? "WAITING" : status.trim().toUpperCase();
    if (!"WAITING".equals(wanted) && !"ALL".equals(wanted)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "status must be WAITING or ALL");
    }
    return "WAITING".equals(wanted);
  }

  /** Adds "the item's unit is in the caller's scope" to an item sub-query (nothing for PLANNER). */
  private static void appendScope(StringBuilder sql, List<Object> args, AuthPrincipal principal) {
    if (principal.hasRole("PLANNER")) {
      return;
    }
    sql.append(" AND u.code IN (")
        .append(String.join(",", Collections.nCopies(principal.units().size(), "?")))
        .append(")");
    args.addAll(principal.units());
  }

  /** Expire, officer by officer, the started waiting items the caller is about to see. */
  private void expireStarted(AuthPrincipal principal) {
    StringBuilder sql =
        new StringBuilder(
            "SELECT DISTINCT i.employee_id FROM proposal_item i JOIN unit u ON u.id = i.unit_id"
                + " WHERE i.decision = 'PENDING' AND i.start_at <= ?");
    List<Object> args = new ArrayList<>();
    args.add(Timestamp.from(clock.now()));
    appendScope(sql, args, principal);
    for (UUID employeeId : new TreeSet<>(jdbc.queryForList(sql.toString(), UUID.class, args.toArray()))) {
      expiry.apply(employeeId);
    }
  }

  private Proposal load(UUID proposalId) {
    Map<String, Object> head =
        jdbc.queryForMap(
            "SELECT p.id, p.employee_id, p.status, p.note, p.submitted_at, p.withdrawn_at,"
                + " p.version, e.first_name || ' ' || e.last_name AS officer,"
                + " hu.code AS home_unit FROM proposal p JOIN employee e ON e.id = p.employee_id"
                + " LEFT JOIN unit hu ON hu.id = e.home_unit_id WHERE p.id = ?",
            proposalId);
    List<Row> rows = new ArrayList<>();
    jdbc.query(
        "SELECT i.id, i.unit_id, u.code AS unit_code, u.name AS unit_name, i.shift_template_id,"
            + " t.code AS template_code, i.start_at, i.end_at, i.work_date, i.decision,"
            + " i.rule_snapshot::text AS rule_snapshot,"
            + " i.decision_snapshot::text AS decision_snapshot, d.display_name AS decided_by,"
            + " i.decided_at, i.comment, i.acknowledged_codes, i.out_of_ot_order,"
            + " i.assignment_id, i.open_shift_id"
            + " FROM proposal_item i JOIN unit u ON u.id = i.unit_id"
            + " JOIN shift_template t ON t.id = i.shift_template_id"
            + " LEFT JOIN app_user d ON d.id = i.decided_by"
            + " WHERE i.proposal_id = ? ORDER BY i.start_at, i.sort_order",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> {
              Timestamp decidedAt = rs.getTimestamp("decided_at");
              java.sql.Array codes = rs.getArray("acknowledged_codes");
              rows.add(
                  new Row(
                      rs.getObject("id", UUID.class),
                      rs.getObject("unit_id", UUID.class),
                      rs.getString("unit_code"),
                      rs.getString("unit_name"),
                      rs.getObject("shift_template_id", UUID.class),
                      rs.getString("template_code"),
                      rs.getTimestamp("start_at").toInstant(),
                      rs.getTimestamp("end_at").toInstant(),
                      rs.getDate("work_date").toLocalDate(),
                      rs.getString("decision"),
                      rs.getString("rule_snapshot"),
                      rs.getString("decision_snapshot"),
                      rs.getString("decided_by"),
                      decidedAt == null ? null : decidedAt.toInstant(),
                      rs.getString("comment"),
                      codes == null ? List.of() : List.of((String[]) codes.getArray()),
                      rs.getBoolean("out_of_ot_order"),
                      rs.getObject("assignment_id", UUID.class),
                      rs.getObject("open_shift_id", UUID.class)));
            },
        proposalId);
    Timestamp withdrawn = (Timestamp) head.get("withdrawn_at");
    return new Proposal(
        proposalId,
        (UUID) head.get("employee_id"),
        (String) head.get("officer"),
        (String) head.get("home_unit"),
        (String) head.get("status"),
        (String) head.get("note"),
        ((Timestamp) head.get("submitted_at")).toInstant(),
        withdrawn == null ? null : withdrawn.toInstant(),
        ((Number) head.get("version")).intValue(),
        rows);
  }

  // --------------------------------------------------------------------------------------------
  // Plumbing
  // --------------------------------------------------------------------------------------------

  private static RuleCheckService.Change change(UUID employeeId, Row row) {
    return new RuleCheckService.Change(
        "EXTRA", employeeId, row.unitId(), row.templateCode(), row.startAt());
  }

  private static double hours(Row row) {
    return round2(Duration.between(row.startAt(), row.endAt()).toMinutes() / 60.0);
  }

  private static double round2(double value) {
    return Math.round(value * 100.0) / 100.0;
  }

  private static List<String> codes(RuleCheckService.OutcomeView outcome, String level) {
    return outcome.ruleResults().stream()
        .filter(result -> level.equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  /** The Warn and Block codes of a stored snapshot (a parsed map) or a fresh outcome. */
  @SuppressWarnings("unchecked")
  private static Set<String> flagged(Object outcome) {
    Set<String> flagged = new HashSet<>();
    if (outcome instanceof RuleCheckService.OutcomeView view) {
      view.ruleResults().stream()
          .filter(r -> "WARN".equals(r.outcome()) || "BLOCK".equals(r.outcome()))
          .forEach(r -> flagged.add(r.outcome() + ":" + r.ruleCode()));
    } else if (outcome instanceof Map<?, ?> map && map.get("ruleResults") instanceof List<?> list) {
      for (Object entry : list) {
        if (entry instanceof Map<?, ?> result
            && ("WARN".equals(result.get("outcome")) || "BLOCK".equals(result.get("outcome")))) {
          flagged.add(result.get("outcome") + ":" + result.get("ruleCode"));
        }
      }
    }
    return flagged;
  }

  private static String outcomeOf(Object snapshot) {
    return snapshot instanceof Map<?, ?> map && map.get("outcome") != null
        ? map.get("outcome").toString()
        : null;
  }

  private Object parse(String json) {
    return json == null ? null : mapper.readValue(json, Object.class);
  }

  /** The same per-officer advisory lock the board, the overtime confirm and the send take. */
  private void lockOfficer(UUID employeeId) {
    long key = employeeId.getMostSignificantBits() ^ employeeId.getLeastSignificantBits();
    jdbc.queryForList("SELECT pg_advisory_xact_lock(?)", Object.class, key);
  }

  private void audit(
      AuthPrincipal principal,
      String action,
      String entityType,
      UUID entityId,
      Map<String, Object> after) {
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
