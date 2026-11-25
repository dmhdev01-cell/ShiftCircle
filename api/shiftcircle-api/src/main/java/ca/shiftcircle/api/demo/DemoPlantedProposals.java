package ca.shiftcircle.api.demo;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.time.BusinessClock;
import ca.shiftcircle.api.units.ActiveUnits;
import ca.shiftcircle.infrastructure.demo.DemoSeedFollowUp;
import ca.shiftcircle.rules.build.ShiftFact;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Planted demo proposals (v1.3 P5, plan v1.2-proposals §7), so a fresh reset shows the proposals
 * feature with something in it:
 *
 * <ul>
 *   <li>Tara: one <b>waiting</b> proposal with two shifts, an evening on Unit B (Tue 22 Dec, M. Ellis
 *       decides) and one on Admissions (Wed 30 Dec, J. Chen decides), which shows per-item routing.
 *       The two are a week apart on purpose: Tara's late December is close to the weekly ceiling
 *       (U-14), so two extra evenings in one week would Block whichever is approved second;
 *   <li>Tara: one <b>declined</b> with J. Chen's comment;
 *   <li>Tara: one <b>expired</b>, a shift that started on 16 Nov before anyone answered;
 *   <li>M. Ellis: one <b>waiting</b> day shift (Sun 29 Nov) on her own post, SUP-L, for J. Chen (or the planner):
 *       nobody approves their own proposal.
 * </ul>
 *
 * So on Dataset 100 M. Ellis's nav count is 1 (her own proposal is left out) and J. Chen's is 2.
 *
 * <p><b>Pins.</b> Proposals create no shift until one is approved, and none of these is approved,
 * so no {@code shift_assignment}, schedule period, time entry or offer is written: the dataset
 * checksums, the payroll golden and the plan fingerprints do not move. The only randomness (the
 * ids and the minute each was sent) comes from this class's own {@code Random} (the seed XOR
 * {@link #SALT}), never the generator's, so not one roster draw moves either.
 *
 * <p><b>Honest rule results.</b> Each item's "rules when sent" is the real result of the live rule
 * set on the generated roster, computed the way {@code POST /proposals} does (each item with the
 * earlier ones as extra facts). A planted waiting item is never Blocked: when the preferred date
 * would be, the next eligible date is taken (Datasets 120 and 150 roster Tara differently), so
 * the walk in docs/demo-script.md §8 can approve it.
 */
@Component
@Profile("demo")
@ConditionalOnProperty(name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
public class DemoPlantedProposals implements DemoSeedFollowUp {

  private static final Logger log = LoggerFactory.getLogger(DemoPlantedProposals.class);
  private static final ZoneId REGINA = BusinessClock.REGINA;

  /** The planted proposals' own stream: seed XOR this salt ("P5"). */
  static final long SALT = 0x5050L;

  /** How far past the preferred date the search for an eligible date goes. */
  private static final int SEARCH_DAYS = 21;

  private record Want(String unit, String template, LocalDate preferred) {}

  private record Placed(String unit, UUID unitId, String template, UUID templateId,
      Instant start, Instant end, LocalDate day, RuleCheckService.OutcomeView outcome) {}

  private final JdbcTemplate jdbc;
  private final RuleCheckService ruleChecks;
  private final PublishedRuleSet published;
  private final ActiveUnits activeUnits;
  private final TransactionTemplate tx;
  private final ObjectMapper mapper = new ObjectMapper();

  public DemoPlantedProposals(
      JdbcTemplate jdbc,
      RuleCheckService ruleChecks,
      PublishedRuleSet published,
      ActiveUnits activeUnits,
      TransactionTemplate tx) {
    this.jdbc = jdbc;
    this.ruleChecks = ruleChecks;
    this.published = published;
    this.activeUnits = activeUnits;
    this.tx = tx;
  }

  /** The fresh-boot path: Dataset 100 was just generated. */
  /**
   * The fresh-boot path. A failure here is logged and boot goes on (security review I-2): the
   * roster is already generated, and the demo without its planted proposals is still a working
   * demo. The reset calls {@link #plant} directly, so a failure there fails the reset, as any
   * other reset step does.
   */
  @Override
  public void afterGenerate(long seed) {
    try {
      plant(seed);
    } catch (RuntimeException failure) {
      log.error("Planted demo proposals skipped at boot; the demo runs without them", failure);
    }
  }

  /**
   * Plants the four proposals once. Skipped when any proposal exists (a restart of a used stack)
   * or when the demo sign-ins are not linked to employees. Runs in one transaction.
   */
  public void plant(long seed) {
    tx.executeWithoutResult(status -> plantInTransaction(seed));
  }

  private void plantInTransaction(long seed) {
    Integer existing = jdbc.queryForObject("SELECT count(*) FROM proposal", Integer.class);
    if (existing != null && existing > 0) {
      return;
    }
    UUID tara = employeeOf("t.nakamura");
    // Datasets 120 and 150 have their own Tara Nakamura (120-0001, Unit A) but do not link the
    // T. Nakamura sign-in to her (unchanged by P5), so her side is not visible there; the
    // supervisors' inboxes are.
    String taraUser = tara == null ? null : "t.nakamura";
    if (tara == null) {
      List<UUID> named =
          jdbc.queryForList(
              "SELECT id FROM employee WHERE first_name = 'Tara' AND last_name = 'Nakamura'"
                  + " AND classification = 'CO' ORDER BY employee_no LIMIT 1",
              UUID.class);
      tara = named.isEmpty() ? null : named.get(0);
    }
    UUID ellis = employeeOf("m.ellis");
    if (tara == null || ellis == null) {
      log.info("Planted proposals skipped: the demo sign-ins are not linked to employees");
      return;
    }
    Random random = new Random(seed ^ SALT);
    PublishedRuleSet.Snapshot live = published.snapshot();

    // 1. Tara, waiting: Unit B (Ellis decides) and Admissions (Chen decides).
    List<Placed> waiting =
        place(tara, live,
            List.of(new Want("B", "E8", LocalDate.of(2026, 12, 22)),
                new Want("ADM", "E8", LocalDate.of(2026, 12, 30))),
            false);
    UUID waitingId =
        proposal(random, tara, taraUser, "WAITING",
            "Happy to pick up two evenings over the holidays if you're short.",
            at(random, LocalDate.of(2026, 11, 18), 16));
    items(random, waitingId, tara, waiting);

    // 2. Tara, declined by J. Chen with a comment.
    List<Placed> declined =
        place(tara, live, List.of(new Want("ADM", "E8", LocalDate.of(2026, 11, 22))), false);
    UUID declinedId =
        proposal(random, tara, taraUser, "DECIDED",
            "I can do the Sunday evening in Admissions.",
            at(random, LocalDate.of(2026, 11, 16), 9));
    UUID declinedItem = items(random, declinedId, tara, declined).get(0);
    Instant decidedAt = at(random, LocalDate.of(2026, 11, 17), 10);
    String comment = "Admissions is fully staffed that evening.";
    jdbc.update(
        "UPDATE proposal_item SET decision = 'DECLINED', decided_by ="
            + " (SELECT id FROM app_user WHERE username = 'j.chen'), decided_at = ?, comment = ?"
            + " WHERE id = ?",
        Timestamp.from(decidedAt), comment, declinedItem);
    jdbc.update(
        "UPDATE proposal SET version = 1, decided_by ="
            + " (SELECT id FROM app_user WHERE username = 'j.chen'), decided_at = ? WHERE id = ?",
        Timestamp.from(decidedAt), declinedId);

    // 3. Tara, expired: the shift started on 16 Nov before anyone answered.
    List<Placed> expired =
        place(tara, live, List.of(new Want("B", "E8", LocalDate.of(2026, 11, 16))), true);
    UUID expiredId =
        proposal(random, tara, taraUser, "EXPIRED",
            "Free Monday evening if Unit B needs someone.",
            at(random, LocalDate.of(2026, 11, 13), 18));
    UUID expiredItem = items(random, expiredId, tara, expired).get(0);
    jdbc.update(
        "UPDATE proposal_item SET decision = 'EXPIRED', decided_at = start_at WHERE id = ?",
        expiredItem);
    jdbc.update("UPDATE proposal SET version = 1 WHERE id = ?", expiredId);

    // 4. M. Ellis, waiting on her own post: J. Chen or the planner decides, never Ellis.
    List<Placed> own =
        place(ellis, live, List.of(new Want("SUP-L", "D8", LocalDate.of(2026, 11, 29))), false);
    UUID ownId =
        proposal(random, ellis, "m.ellis", "WAITING",
            "I can take the Sunday day shift on Living units.",
            at(random, LocalDate.of(2026, 11, 19), 8));
    items(random, ownId, ellis, own);

    // The audit names the same people as the rows (security review L-2): each send by its
    // proposer's sign-in (none for 120/150's unlinked Tara), the decline by J. Chen, and the
    // expiry by the system, as a real expiry is. Every row says planted: true.
    audit(taraUser, waitingId, "submit_proposal", waiting, null);
    audit(taraUser, declinedId, "submit_proposal", declined, null);
    audit("j.chen", declinedId, "decide_proposal_item", declined, Map.of("decision", "DECLINED",
        "comment", comment, "itemId", declinedItem.toString()));
    audit(taraUser, expiredId, "submit_proposal", expired, null);
    audit(null, expiredId, "expire_proposal_item", expired, Map.of("decision", "EXPIRED",
        "itemId", expiredItem.toString()));
    audit("m.ellis", ownId, "submit_proposal", own, null);
    log.info(
        "Planted demo proposals: Tara waiting {} + {}, declined {}, expired {}; Ellis waiting {}",
        waiting.get(0).day(), waiting.get(1).day(), declined.get(0).day(), expired.get(0).day(),
        own.get(0).day());
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Each wanted shift on its preferred date, or the first later (earlier, for a past shift) date
   * where the officer is free, the unit is open and the rules, with the earlier items as facts, do
   * not Block. A supervisor post also tries the 12 h day shift (Datasets 120/150 crews are 12 h).
   */
  private List<Placed> place(UUID employee, PublishedRuleSet.Snapshot live, List<Want> wants,
      boolean past) {
    List<Placed> placed = new ArrayList<>();
    List<ShiftFact> earlier = new ArrayList<>();
    for (Want want : wants) {
      Placed found = null;
      for (int step = 0; step < SEARCH_DAYS && found == null; step++) {
        LocalDate day = past ? want.preferred().minusDays(step) : want.preferred().plusDays(step);
        List<String> templates = want.unit().startsWith("SUP-")
            ? List.of(want.template(), "D12") : List.of(want.template());
        for (String template : templates) {
          found = tryPlace(employee, live, want.unit(), template, day, earlier);
          if (found != null) {
            break;
          }
        }
      }
      if (found == null) {
        throw new IllegalStateException(
            "No eligible date for a planted proposal on " + want.unit() + " near " + want.preferred());
      }
      placed.add(found);
      earlier.add(ruleChecks.factOf(change(employee, found), "planted-" + placed.size()));
    }
    return placed;
  }

  private Placed tryPlace(UUID employee, PublishedRuleSet.Snapshot live, String unit,
      String template, LocalDate day, List<ShiftFact> earlier) {
    Map<String, Object> t =
        jdbc.queryForMap(
            "SELECT id, start_time, duration_minutes FROM shift_template WHERE code = ?", template);
    UUID unitId = jdbc.queryForObject("SELECT id FROM unit WHERE code = ?", UUID.class, unit);
    Instant start =
        day.atTime(((java.sql.Time) t.get("start_time")).toLocalTime()).atZone(REGINA).toInstant();
    Instant end = start.plusSeconds(60L * ((Number) t.get("duration_minutes")).intValue());
    if (!activeUnits.active(unitId, day)) {
      return null;
    }
    Integer busy =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment WHERE employee_id = ? AND status <> 'CANCELLED'"
                + " AND tstzrange(start_at, end_at, '[)') && tstzrange(?, ?, '[)')",
            Integer.class, employee, Timestamp.from(start), Timestamp.from(end));
    Integer absent =
        jdbc.queryForObject(
            "SELECT count(*) FROM absence WHERE employee_id = ? AND ? BETWEEN"
                + " (start_at AT TIME ZONE 'America/Regina')::date"
                + " AND (end_at AT TIME ZONE 'America/Regina')::date",
            Integer.class, employee, day);
    if ((busy != null && busy > 0) || (absent != null && absent > 0)) {
      return null;
    }
    Placed candidate =
        new Placed(unit, unitId, template, (UUID) t.get("id"), start, end, day, null);
    RuleCheckService.OutcomeView outcome =
        ruleChecks.evaluateWithExtras(change(employee, candidate), earlier, live);
    if ("BLOCK".equals(outcome.outcome())) {
      return null;
    }
    return new Placed(unit, unitId, template, candidate.templateId(), start, end, day, outcome);
  }

  private static RuleCheckService.Change change(UUID employee, Placed placed) {
    return new RuleCheckService.Change(
        "EXTRA", employee, placed.unitId(), placed.template(), placed.start());
  }

  private UUID proposal(Random random, UUID employee, String username, String status, String note,
      Instant submittedAt) {
    UUID id = new UUID(random.nextLong(), random.nextLong());
    jdbc.update(
        "INSERT INTO proposal (id, employee_id, note, status, submitted_at, submitted_by)"
            + " VALUES (?, ?, ?, ?, ?, (SELECT id FROM app_user WHERE username = ?))",
        id, employee, note, status, Timestamp.from(submittedAt), username);
    return id;
  }

  private List<UUID> items(Random random, UUID proposalId, UUID employee, List<Placed> placed) {
    List<UUID> ids = new ArrayList<>();
    for (int index = 0; index < placed.size(); index++) {
      Placed p = placed.get(index);
      UUID id = new UUID(random.nextLong(), random.nextLong());
      jdbc.update(
          "INSERT INTO proposal_item (id, proposal_id, employee_id, action, shift_template_id,"
              + " unit_id, start_at, end_at, work_date, decision, rule_snapshot, sort_order)"
              + " VALUES (?, ?, ?, 'ADD', ?, ?, ?, ?, ?, 'PENDING', ?::jsonb, ?)",
          id, proposalId, employee, p.templateId(), p.unitId(), Timestamp.from(p.start()),
          Timestamp.from(p.end()), p.day(), mapper.writeValueAsString(p.outcome()), index);
      ids.add(id);
    }
    return ids;
  }

  /** A business-clock time on that day at the hour, at a seeded minute. */
  private static Instant at(Random random, LocalDate day, int hour) {
    return day.atTime(LocalTime.of(hour, random.nextInt(60))).atZone(REGINA).toInstant();
  }

  private UUID employeeOf(String username) {
    List<UUID> rows =
        jdbc.queryForList(
            "SELECT employee_id FROM app_user WHERE username = ? AND employee_id IS NOT NULL",
            UUID.class, username);
    return rows.isEmpty() ? null : rows.get(0);
  }

  /** The audit trail says these came from the demo seed: {@code planted: true}. */
  private void audit(String actor, UUID proposalId, String action, List<Placed> placed,
      Map<String, Object> extra) {
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("planted", true);
    List<Map<String, Object>> items = new ArrayList<>();
    for (Placed p : placed) {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("unit", p.unit());
      entry.put("template", p.template());
      entry.put("startAt", p.start().toString());
      entry.put("outcome", p.outcome().outcome());
      items.add(entry);
    }
    after.put("items", items);
    if (extra != null) {
      after.putAll(extra);
    }
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, 'proposal', ?, ?::jsonb)",
        actor, action, proposalId, mapper.writeValueAsString(after));
  }
}
