package ca.shiftcircle.api.overtime;

import ca.shiftcircle.api.assignments.AssignmentService;
import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.rules.RuleCheckRequest;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.rules.RuleViolationException;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.facts.OvertimeRankingFact;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.rank.OvertimeRanker;
import ca.shiftcircle.rules.rank.OvertimeRanker.Eligibility;
import ca.shiftcircle.rules.rank.RankingPolicy;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Overtime: open shifts, the ranked candidate list and the offer workflow (docs/07 §4.3).
 *
 * <p>The ranking is the rule table's (O-01 to O-03), the eligibility is the same rule check the
 * planning board uses, and every step a person takes writes an audit event (S-04, ADR-019): a
 * supervisor creates the shift and the offers, the employee accepts or declines, and the
 * supervisor's confirmation creates the assignment through the normal rules/override path.
 */
@Service
public class OvertimeService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final DateTimeFormatter SENIORITY = DateTimeFormatter.ofPattern("MMM yyyy",
      Locale.ENGLISH);
  private static final DateTimeFormatter OFFER_TIME = DateTimeFormatter.ofPattern("HH:mm");
  private static final Set<String> REASONS =
      Set.of("SICK_CALL", "VACATION", "EXTRA_COVERAGE", "OTHER");

  public record UnitRef(UUID id, String name) {}

  public record OpenShiftView(
      String id, String date, String startAt, String endAt, UnitRef unit, String shiftTemplate,
      int needs, String status, String reason) {}

  public record CandidateView(
      String employeeId, String name, List<String> qualifications,
      double overtimeHoursThisQuarter, String seniorityDate, String eligibility, String reason,
      List<RuleCheckService.ResultView> ruleResults) {}

  public record OfferRecordView(String at, String employeeId, String employeeName, String status) {}

  public record CandidatesPayload(
      OpenShiftView openShift, List<CandidateView> candidates, int ruleSetVersion,
      String rankingNote, List<OfferRecordView> history) {}

  public record MyOfferView(
      String id, OpenShiftView openShift, String offeredBy, String offeredAt, String eligibility,
      String reason, List<RuleCheckService.ResultView> ruleResults, String status) {}

  public record CreateOpenShiftRequest(
      UUID unitId, String shiftTemplate, Instant startAt, String reason) {}

  public record OfferRequest(List<UUID> employeeIds, boolean ordered) {}

  public record DirectAssignRequest(
      UUID employeeId, List<String> acknowledgeWarnings, RuleCheckRequest.Override override) {}

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final AssignmentService assignments;
  private final ScopeGuard scopeGuard;
  private final RuleEvaluator evaluator;
  private final PublishedRuleSet publishedRuleSet;
  private final OvertimeRanker ranker = new OvertimeRanker();
  private final ObjectMapper mapper = new ObjectMapper();
  private final LocalDate asOf;

  public OvertimeService(
      JdbcTemplate jdbc,
      RuleCheckService ruleChecks,
      AssignmentService assignments,
      ScopeGuard scopeGuard,
      RuleEvaluator evaluator,
      PublishedRuleSet publishedRuleSet,
      @org.springframework.beans.factory.annotation.Value("${sc.demo.today:2026-11-19}")
          String today) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
    this.assignments = assignments;
    this.scopeGuard = scopeGuard;
    this.evaluator = evaluator;
    this.publishedRuleSet = publishedRuleSet;
    this.asOf = LocalDate.parse(today);
  }

  // ---------------------------------------------------------------------------------------------
  // Open shifts
  // ---------------------------------------------------------------------------------------------

  public List<OpenShiftView> openShifts(
      AuthPrincipal principal, UUID unitId, LocalDate from, LocalDate to, String status) {
    if (unitId != null) {
      scopeGuard.requireUnit(principal, unitCode(unitId));
    }

    StringBuilder sql =
        new StringBuilder(
            "SELECT o.id, o.unit_id, u.code AS unit_code, u.name AS unit_name,"
                + " t.code AS template_code, o.start_at, o.end_at, o.reason, o.status"
                + " FROM open_shift o JOIN unit u ON u.id = o.unit_id"
                + " JOIN shift_template t ON t.id = o.shift_template_id"
                + " WHERE o.status <> 'CANCELLED'");
    List<Object> args = new ArrayList<>();
    if (unitId != null) {
      sql.append(" AND o.unit_id = ?");
      args.add(unitId);
    }
    if (from != null) {
      sql.append(" AND (o.start_at AT TIME ZONE 'America/Regina')::date >= ?");
      args.add(from);
    }
    if (to != null) {
      sql.append(" AND (o.start_at AT TIME ZONE 'America/Regina')::date <= ?");
      args.add(to);
    }
    if (status != null && !status.isBlank()) {
      sql.append(" AND o.status = ?");
      args.add(databaseStatus(status));
    }
    sql.append(" ORDER BY o.start_at");

    List<OpenShiftView> shifts = new ArrayList<>();
    for (Map<String, Object> row : jdbc.queryForList(sql.toString(), args.toArray())) {
      if (!inScope(principal, (String) row.get("unit_code"))) {
        continue;
      }
      shifts.add(openShiftView(row));
    }
    return shifts;
  }

  @Transactional
  public OpenShiftView createOpenShift(
      CreateOpenShiftRequest request, AuthPrincipal principal) {
    if (request == null || request.unitId() == null || request.shiftTemplate() == null
        || request.startAt() == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "unitId, shiftTemplate and startAt are required");
    }
    String unitCode = unitCode(request.unitId());
    scopeGuard.requireUnit(principal, unitCode);

    String reason = request.reason() == null ? "EXTRA_COVERAGE" : request.reason();
    if (!REASONS.contains(reason)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "reason must be one of " + REASONS.stream().sorted().toList());
    }
    Map<String, Object> template =
        jdbc.queryForMap(
            "SELECT id, duration_minutes FROM shift_template WHERE code = ?",
            request.shiftTemplate());
    Instant end =
        request.startAt().plusSeconds(((Number) template.get("duration_minutes")).longValue() * 60);

    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status,"
            + " created_by) VALUES (?, ?, ?, ?, ?, ?, 'OPEN',"
            + " (SELECT id FROM app_user WHERE username = ?))",
        id,
        request.unitId(),
        template.get("id"),
        java.sql.Timestamp.from(request.startAt()),
        java.sql.Timestamp.from(end),
        reason,
        principal.username());
    audit(principal, "create_open_shift", "open_shift", id, Map.of(
        "unit", unitCode, "template", request.shiftTemplate(),
        "startAt", request.startAt().toString(), "reason", reason));
    return openShift(id);
  }

  // ---------------------------------------------------------------------------------------------
  // Ranked candidates
  // ---------------------------------------------------------------------------------------------

  public CandidatesPayload candidates(UUID openShiftId, AuthPrincipal principal) {
    Map<String, Object> shift = shiftRow(openShiftId);
    scopeGuard.requireUnit(principal, (String) shift.get("unit_code"));

    UUID unitId = (UUID) shift.get("unit_id");
    String templateCode = (String) shift.get("template_code");
    Instant startAt = ((java.sql.Timestamp) shift.get("start_at")).toInstant();
    Instant endAt = ((java.sql.Timestamp) shift.get("end_at")).toInstant();
    String requiredQualification = requiredQualification((String) shift.get("unit_kind"));
    int ruleSetVersion = ruleChecks.publishedVersion();

    Set<UUID> overlapping =
        Set.copyOf(
            jdbc.queryForList(
                "SELECT DISTINCT employee_id FROM shift_assignment"
                    + " WHERE status <> 'CANCELLED' AND start_at < ? AND end_at > ?",
                UUID.class,
                java.sql.Timestamp.from(endAt),
                java.sql.Timestamp.from(startAt)));

    List<OvertimeRanker.Candidate> pool = new ArrayList<>();
    Map<UUID, RuleCheckService.OutcomeView> outcomes = new LinkedHashMap<>();
    for (Map<String, Object> officer : officers(principal)) {
      UUID employeeId = (UUID) officer.get("id");
      List<String> qualifications = strings(officer.get("qualifications"));

      String unavailable = null;
      RuleCheckService.OutcomeView outcome = null;
      if (requiredQualification != null && !qualifications.contains(requiredQualification)) {
        unavailable = "Does not hold the " + requiredQualification + " qualification";
      } else if (overlapping.contains(employeeId)) {
        unavailable = "Already scheduled for an overlapping shift";
      } else {
        outcome =
            ruleChecks.evaluate(
                new RuleCheckService.Change("EXTRA", employeeId, unitId, templateCode, startAt),
                ruleSetVersion);
        outcomes.put(employeeId, outcome);
      }

      pool.add(
          new OvertimeRanker.Candidate(
              employeeId.toString(),
              (String) officer.get("name"),
              qualifications,
              ((Number) officer.get("overtime_hours")).doubleValue(),
              ((java.sql.Date) officer.get("seniority_date")).toLocalDate(),
              unavailable,
              worstOutcome(outcome),
              reason(outcome),
              flaggedCodes(outcome)));
    }

    List<OvertimeRanker.Ranked> ranked =
        ranker.rank(pool, RankingPolicy.from(publishedRuleSet.ruleSet()));

    List<CandidateView> candidates = new ArrayList<>();
    long skipped = 0;
    for (OvertimeRanker.Ranked entry : ranked) {
      OvertimeRanker.Candidate candidate = entry.candidate();
      if (entry.eligibility() == Eligibility.SKIPPED) {
        skipped++;
      }
      RuleCheckService.OutcomeView outcome =
          outcomes.get(UUID.fromString(candidate.employeeId()));
      double overtimeHours = Math.round(candidate.overtimeHoursThisQuarter() * 100.0) / 100.0;
      candidates.add(
          new CandidateView(
              candidate.employeeId(),
              candidate.name(),
              candidate.qualifications(),
              overtimeHours,
              candidate.seniorityDate() == null ? "" : SENIORITY.format(candidate.seniorityDate()),
              entry.eligibility().name(),
              entry.reason(),
              outcome == null ? List.of() : outcome.ruleResults()));
    }

    List<RuleResult> policyResults =
        evaluator.evaluate(
            publishedRuleSet.kieBase(),
            String.valueOf(ruleSetVersion),
            new OvertimeRankingFact(
                ranked.size(),
                (int) skipped,
                ranked.size() + " ranked, " + skipped + " skipped for a block rule"));
    String rankingNote =
        policyResults.stream().map(RuleResult::message).distinct().collect(Collectors.joining(" "));

    return new CandidatesPayload(
        openShiftView(shift), candidates, ruleSetVersion, rankingNote, history(openShiftId));
  }

  // ---------------------------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------------------------

  @Transactional
  public List<OfferRecordView> offer(
      UUID openShiftId, OfferRequest request, AuthPrincipal principal) {
    Map<String, Object> shift = shiftRow(openShiftId);
    scopeGuard.requireUnit(principal, (String) shift.get("unit_code"));
    if (request == null || request.employeeIds() == null || request.employeeIds().isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "employeeIds must list at least one officer");
    }
    if ("FILLED".equals(shift.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This shift is already filled");
    }
    if ("CANCELLED".equals(shift.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This shift was cancelled");
    }

    UUID unitId = (UUID) shift.get("unit_id");
    String templateCode = (String) shift.get("template_code");
    Instant startAt = ((java.sql.Timestamp) shift.get("start_at")).toInstant();
    int ruleSetVersion = ruleChecks.publishedVersion();

    int rank = 0;
    for (UUID employeeId : request.employeeIds()) {
      rank++;
      requireAvailable(employeeId, shift);
      RuleCheckService.OutcomeView outcome =
          ruleChecks.evaluate(
              new RuleCheckService.Change("EXTRA", employeeId, unitId, templateCode, startAt),
              ruleSetVersion);
      if ("BLOCK".equals(outcome.outcome())) {
        throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
      }
      String snapshot =
          mapper.writeValueAsString(
              Map.of(
                  "eligibility",
                  "WARN".equals(outcome.outcome()) ? "WARN" : "ELIGIBLE",
                  "reason",
                  reason(outcome) == null ? "" : reason(outcome),
                  "outcome",
                  outcome));

      // A declined or expired offer can be made again; a live one is left alone (review-r1 F4).
      jdbc.update(
          "INSERT INTO overtime_offer (id, open_shift_id, employee_id, rank, ordered, status,"
              + " rule_snapshot, offered_by) VALUES (?, ?, ?, ?, ?, 'OFFERED', ?::jsonb,"
              + " (SELECT id FROM app_user WHERE username = ?))"
              + " ON CONFLICT (open_shift_id, employee_id) DO UPDATE SET"
              + " status = 'OFFERED', offered_at = now(), offered_by = EXCLUDED.offered_by,"
              + " rule_snapshot = EXCLUDED.rule_snapshot, rank = EXCLUDED.rank,"
              + " ordered = EXCLUDED.ordered, responded_at = NULL,"
              + " version = overtime_offer.version + 1"
              + " WHERE overtime_offer.status IN ('DECLINED', 'EXPIRED', 'WITHDRAWN')",
          UUID.randomUUID(),
          openShiftId,
          employeeId,
          rank,
          request.ordered(),
          snapshot,
          principal.username());
    }
    jdbc.update("UPDATE open_shift SET status = 'OFFERED' WHERE id = ? AND status = 'OPEN'",
        openShiftId);

    audit(principal, "offer_overtime", "open_shift", openShiftId, Map.of(
        "employeeIds", request.employeeIds().toString(), "ordered", request.ordered()));
    return history(openShiftId);
  }

  public List<MyOfferView> myOffers(AuthPrincipal principal, String status) {
    UUID employeeId = principal.employeeId();
    if (employeeId == null) {
      return List.of();
    }
    String filter = status == null || status.isBlank() ? "" : " AND oo.status = ?";
    List<Object> args = new ArrayList<>();
    args.add(employeeId);
    if (!filter.isEmpty()) {
      args.add(status);
    }

    List<MyOfferView> offers = new ArrayList<>();
    jdbc.query(
        "SELECT oo.id, oo.status, oo.offered_at, oo.rule_snapshot,"
            + " u.display_name AS offered_by, o.id AS shift_id, u2.code AS unit_code"
            + " FROM overtime_offer oo"
            + " JOIN open_shift o ON o.id = oo.open_shift_id"
            + " JOIN unit u2 ON u2.id = o.unit_id"
            + " LEFT JOIN app_user u ON u.id = oo.offered_by"
            + " WHERE oo.employee_id = ?"
            + filter
            + " ORDER BY oo.offered_at DESC",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> {
              UUID openShiftId = (UUID) resultSet.getObject("shift_id");
              Map<String, Object> snapshot = readSnapshot(resultSet.getString("rule_snapshot"));
              offers.add(
                  new MyOfferView(
                      resultSet.getObject("id").toString(),
                      openShift(openShiftId),
                      resultSet.getString("offered_by"),
                      formatInstant(resultSet.getTimestamp("offered_at").toInstant()),
                      (String) snapshot.getOrDefault("eligibility", "ELIGIBLE"),
                      (String) snapshot.getOrDefault("reason", ""),
                      snapshotOutcome(snapshot),
                      resultSet.getString("status")));
            },
        args.toArray());
    return offers;
  }

  @Transactional
  public MyOfferView respond(UUID offerId, boolean accept, AuthPrincipal principal) {
    Map<String, Object> offer = offerRowForUpdate(offerId);
    if (principal.employeeId() == null
        || !principal.employeeId().equals(offer.get("employee_id"))) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Offer not found");
    }
    if (!"OFFERED".equals(offer.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This offer was already answered");
    }

    String snapshot = null;
    if (accept) {
      Map<String, Object> shift = shiftRow((UUID) offer.get("open_shift_id"));
      RuleCheckService.OutcomeView outcome =
          ruleChecks.evaluate(
              new RuleCheckService.Change(
                  "EXTRA",
                  principal.employeeId(),
                  (UUID) shift.get("unit_id"),
                  (String) shift.get("template_code"),
                  ((java.sql.Timestamp) shift.get("start_at")).toInstant()));
      if ("BLOCK".equals(outcome.outcome())) {
        throw new RuleViolationException(RuleViolationException.Kind.BLOCKED, outcome);
      }
      snapshot =
          mapper.writeValueAsString(
              Map.of(
                  "eligibility",
                  "WARN".equals(outcome.outcome()) ? "WARN" : "ELIGIBLE",
                  "reason",
                  reason(outcome) == null ? "" : reason(outcome),
                  "outcome",
                  outcome));
    }

    String status = accept ? "ACCEPTED" : "DECLINED";
    int updated =
        jdbc.update(
            "UPDATE overtime_offer SET status = ?, responded_at = now(),"
                + " rule_snapshot = coalesce(?::jsonb, rule_snapshot)"
                + " WHERE id = ? AND status = 'OFFERED'",
            status,
            snapshot,
            offerId);
    if (updated == 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This offer was already answered");
    }
    audit(principal, accept ? "accept_overtime_offer" : "decline_overtime_offer",
        "overtime_offer", offerId, Map.of("status", status));

    return myOffer(offerId, principal);
  }

  @Transactional
  public OfferRecordView confirm(UUID offerId, AuthPrincipal principal) {
    // Row lock: two supervisors confirming the same offer serialise here, so only one creates an
    // assignment (review-r1 F3).
    Map<String, Object> offer = offerRowForUpdate(offerId);
    Map<String, Object> shift = shiftRow((UUID) offer.get("open_shift_id"));
    scopeGuard.requireUnit(principal, (String) shift.get("unit_code"));

    if (!"ACCEPTED".equals(offer.get("status"))) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Only an accepted offer can be confirmed");
    }
    if ("FILLED".equals(shift.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This shift is already filled");
    }
    if ("CANCELLED".equals(shift.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This shift was cancelled");
    }

    UUID employeeId = (UUID) offer.get("employee_id");
    UUID unitId = (UUID) shift.get("unit_id");
    String templateCode = (String) shift.get("template_code");
    Instant startAt = ((java.sql.Timestamp) shift.get("start_at")).toInstant();
    requireAvailable(employeeId, shift);

    int ruleSetVersion = ruleChecks.publishedVersion();
    RuleCheckService.OutcomeView outcome =
        ruleChecks.evaluate(
            new RuleCheckService.Change("EXTRA", employeeId, unitId, templateCode, startAt),
            ruleSetVersion);

    // The supervisor saw the offer-time warnings in the ranked list and acknowledged them by
    // making the offer. A warning that is *new* at confirmation still needs a fresh human answer.
    List<String> offerWarnCodes = snapshotWarnCodes(offer.get("rule_snapshot"));
    List<String> currentWarnCodes = warnCodes(outcome);
    if (!offerWarnCodes.containsAll(currentWarnCodes)) {
      throw new RuleViolationException(RuleViolationException.Kind.WARNINGS, outcome);
    }

    UUID assignmentId =
        assignments.assign(
            new RuleCheckRequest(
                new RuleCheckRequest.Change(
                    "EXTRA", employeeId, unitId, templateCode, startAt),
                currentWarnCodes,
                null),
            principal);

    int confirmed =
        jdbc.update(
            "UPDATE overtime_offer SET status = 'CONFIRMED' WHERE id = ? AND status = 'ACCEPTED'",
            offerId);
    if (confirmed == 0) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Only an accepted offer can be confirmed");
    }
    jdbc.update(
        "UPDATE open_shift SET status = 'FILLED', filled_assignment_id = ? WHERE id = ?",
        assignmentId,
        shift.get("id"));
    audit(principal, "confirm_overtime_offer", "overtime_offer", offerId, Map.of(
        "assignmentId", assignmentId.toString(), "employeeId", employeeId.toString()));

    return new OfferRecordView(
        formatInstant(Instant.now()), employeeId.toString(), employeeName(employeeId), "CONFIRMED");
  }

  @Transactional
  public Map<String, Object> assignDirect(
      UUID openShiftId, DirectAssignRequest request, AuthPrincipal principal) {
    Map<String, Object> shift = shiftRow(openShiftId);
    scopeGuard.requireUnit(principal, (String) shift.get("unit_code"));
    if (request == null || request.employeeId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "employeeId is required");
    }
    if ("FILLED".equals(shift.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This shift is already filled");
    }
    if ("CANCELLED".equals(shift.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This shift was cancelled");
    }
    requireAvailable(request.employeeId(), shift);

    UUID assignmentId =
        assignments.assign(
            new RuleCheckRequest(
                new RuleCheckRequest.Change(
                    "EXTRA",
                    request.employeeId(),
                    (UUID) shift.get("unit_id"),
                    (String) shift.get("template_code"),
                    ((java.sql.Timestamp) shift.get("start_at")).toInstant()),
                request.acknowledgeWarnings(),
                request.override()),
            principal);

    jdbc.update(
        "UPDATE open_shift SET status = 'FILLED', filled_assignment_id = ? WHERE id = ?",
        assignmentId,
        openShiftId);
    audit(principal, "assign_open_shift", "open_shift", openShiftId, Map.of(
        "assignmentId", assignmentId.toString(), "employeeId", request.employeeId().toString()));

    return Map.of("assignmentId", assignmentId.toString(), "status", "PLANNED");
  }

  // ---------------------------------------------------------------------------------------------
  // Queries and views
  // ---------------------------------------------------------------------------------------------

  private List<Map<String, Object>> officers(AuthPrincipal principal) {
    // The demo clock decides the quarter, not the host clock (review-r1 F7).
    LocalDate quarterStart =
        asOf.withMonth(((asOf.getMonthValue() - 1) / 3) * 3 + 1).withDayOfMonth(1);
    List<Map<String, Object>> officers =
        jdbc.queryForList(
            "SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.seniority_date,"
                + " u.code AS home_unit,"
                + " coalesce((SELECT sum(te.hours) FROM time_entry te"
                + "   WHERE te.employee_id = e.id AND te.pay_code = 'OT15'"
                + "   AND te.start_at >= ?), 0) AS overtime_hours,"
                + " coalesce((SELECT array_agg(q.code) FROM employee_qualification eq"
                + "   JOIN qualification q ON q.id = eq.qualification_id"
                + "   WHERE eq.employee_id = e.id), '{}') AS qualifications"
                + " FROM employee e LEFT JOIN unit u ON u.id = e.home_unit_id"
                + " WHERE e.active ORDER BY e.last_name, e.first_name",
            java.sql.Timestamp.from(quarterStart.atStartOfDay(REGINA).toInstant()));
    // Candidates come from the caller's units only: the list shows overtime totals, which the
    // permission matrix limits to scope (docs/09 §2).
    return officers.stream()
        .filter(officer -> inScope(principal, (String) officer.get("home_unit")))
        .toList();
  }

  private Map<String, Object> shiftRow(UUID id) {
    return jdbc.queryForMap(
        "SELECT o.id, o.unit_id, o.shift_template_id, u.code AS unit_code, u.name AS unit_name,"
            + " u.kind AS unit_kind, t.code AS template_code, o.start_at, o.end_at, o.reason,"
            + " o.status FROM open_shift o JOIN unit u ON u.id = o.unit_id"
            + " JOIN shift_template t ON t.id = o.shift_template_id WHERE o.id = ?",
        id);
  }

  private OpenShiftView openShift(UUID id) {
    return openShiftView(shiftRow(id));
  }

  private OpenShiftView openShiftView(Map<String, Object> row) {
    Instant start = ((java.sql.Timestamp) row.get("start_at")).toInstant();
    Instant end = ((java.sql.Timestamp) row.get("end_at")).toInstant();
    String status = (String) row.get("status");
    return new OpenShiftView(
        row.get("id").toString(),
        start.atZone(REGINA).toLocalDate().toString(),
        start.toString(),
        end.toString(),
        new UnitRef((UUID) row.get("unit_id"), (String) row.get("unit_name")),
        (String) row.get("template_code"),
        "FILLED".equals(status) ? 0 : 1,
        apiStatus(status),
        humanReason((String) row.get("reason")));
  }

  private Map<String, Object> offerRow(UUID id) {
    return jdbc.queryForMap(
        "SELECT id, open_shift_id, employee_id, status, rule_snapshot FROM overtime_offer"
            + " WHERE id = ?",
        id);
  }

  private Map<String, Object> offerRowForUpdate(UUID id) {
    return jdbc.queryForMap(
        "SELECT id, open_shift_id, employee_id, status, rule_snapshot FROM overtime_offer"
            + " WHERE id = ? FOR UPDATE",
        id);
  }

  /**
   * The same qualification and overlap gate the ranked list shows (review-r1 F1). It must run on
   * offer, confirm and direct assign too, or UNAVAILABLE would be display-only.
   */
  private void requireAvailable(UUID employeeId, Map<String, Object> shift) {
    String required = requiredQualification((String) shift.get("unit_kind"));
    if (required != null) {
      Integer qualified =
          jdbc.queryForObject(
              "SELECT count(*) FROM employee_qualification eq"
                  + " JOIN qualification q ON q.id = eq.qualification_id"
                  + " WHERE eq.employee_id = ? AND q.code = ?",
              Integer.class,
              employeeId,
              required);
      if (qualified == null || qualified == 0) {
        throw new CandidateUnavailableException(
            "Does not hold the " + required + " qualification");
      }
    }
    Integer overlapping =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment WHERE employee_id = ?"
                + " AND status <> 'CANCELLED' AND start_at < ? AND end_at > ?",
            Integer.class,
            employeeId,
            shift.get("end_at"),
            shift.get("start_at"));
    if (overlapping != null && overlapping > 0) {
      throw new CandidateUnavailableException("Already scheduled for an overlapping shift");
    }
  }

  private List<OfferRecordView> history(UUID openShiftId) {
    List<OfferRecordView> history = new ArrayList<>();
    jdbc.query(
        "SELECT oo.employee_id, oo.status, oo.offered_at, e.first_name, e.last_name"
            + " FROM overtime_offer oo JOIN employee e ON e.id = oo.employee_id"
            + " WHERE oo.open_shift_id = ? ORDER BY oo.rank NULLS LAST, oo.offered_at",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                history.add(
                    new OfferRecordView(
                        OFFER_TIME.format(
                            resultSet.getTimestamp("offered_at").toInstant().atZone(REGINA)),
                        resultSet.getObject("employee_id").toString(),
                        resultSet.getString("first_name") + " " + resultSet.getString("last_name"),
                        resultSet.getString("status"))),
        openShiftId);
    return history;
  }

  private MyOfferView myOffer(UUID id, AuthPrincipal principal) {
    return myOffers(principal, null).stream()
        .filter(offer -> offer.id().equals(id.toString()))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Offer not found"));
  }

  private String unitCode(UUID unitId) {
    return jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, unitId);
  }

  private boolean inScope(AuthPrincipal principal, String unitCode) {
    if (principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY")) {
      return true;
    }
    return unitCode != null && principal.scopesUnit(unitCode);
  }

  private static String requiredQualification(String unitKind) {
    return switch (unitKind == null ? "" : unitKind) {
      case "CONTROL" -> "CONTROL";
      case "ESCORT" -> "ESCORT";
      default -> null;
    };
  }

  private static String databaseStatus(String apiStatus) {
    return "OFFERS_SENT".equals(apiStatus) ? "OFFERED" : apiStatus;
  }

  private static String apiStatus(String databaseStatus) {
    return "OFFERED".equals(databaseStatus) ? "OFFERS_SENT" : databaseStatus;
  }

  private static String humanReason(String reason) {
    return switch (reason == null ? "" : reason) {
      case "SICK_CALL" -> "Sick call";
      case "VACATION" -> "Vacation";
      case "EXTRA_COVERAGE" -> "Extra coverage";
      case "OTHER" -> "Other";
      default -> "";
    };
  }

  private static String formatInstant(Instant instant) {
    return instant.atZone(REGINA).toOffsetDateTime().toString();
  }

  private static List<String> strings(Object value) {
    if (value instanceof java.sql.Array array) {
      try {
        return List.of((String[]) array.getArray());
      } catch (java.sql.SQLException e) {
        return List.of();
      }
    }
    return List.of();
  }

  private static RuleOutcome worstOutcome(RuleCheckService.OutcomeView outcome) {
    if (outcome == null) {
      return null;
    }
    boolean warn = false;
    for (RuleCheckService.ResultView result : outcome.ruleResults()) {
      if ("BLOCK".equals(result.outcome())) {
        return RuleOutcome.BLOCK;
      }
      warn |= "WARN".equals(result.outcome());
    }
    return warn ? RuleOutcome.WARN : null;
  }

  private static String reason(RuleCheckService.OutcomeView outcome) {
    if (outcome == null) {
      return null;
    }
    for (String wanted : List.of("BLOCK", "WARN")) {
      for (RuleCheckService.ResultView result : outcome.ruleResults()) {
        if (wanted.equals(result.outcome())) {
          return result.ruleCode() + ": " + result.message();
        }
      }
    }
    return null;
  }

  private static List<String> flaggedCodes(RuleCheckService.OutcomeView outcome) {
    if (outcome == null) {
      return List.of();
    }
    return outcome.ruleResults().stream()
        .filter(result -> "BLOCK".equals(result.outcome()) || "WARN".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  private static List<String> warnCodes(RuleCheckService.OutcomeView outcome) {
    return outcome.ruleResults().stream()
        .filter(result -> "WARN".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  private Map<String, Object> readSnapshot(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    try {
      return mapper.readValue(json, Map.class);
    } catch (RuntimeException e) {
      return Map.of();
    }
  }

  private List<RuleCheckService.ResultView> snapshotOutcome(Map<String, Object> snapshot) {
    Object outcome = snapshot.get("outcome");
    if (outcome == null) {
      return List.of();
    }
    return mapper.convertValue(outcome, RuleCheckService.OutcomeView.class).ruleResults();
  }

  private List<String> snapshotWarnCodes(Object json) {
    if (json == null) {
      return List.of();
    }
    Map<String, Object> snapshot = readSnapshot(json.toString());
    return snapshotOutcome(snapshot).stream()
        .filter(result -> "WARN".equals(result.outcome()))
        .map(RuleCheckService.ResultView::ruleCode)
        .toList();
  }

  private String employeeName(UUID employeeId) {
    return jdbc.queryForObject(
        "SELECT first_name || ' ' || last_name FROM employee WHERE id = ?", String.class,
        employeeId);
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
