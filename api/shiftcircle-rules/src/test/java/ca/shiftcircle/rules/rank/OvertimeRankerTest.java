package ca.shiftcircle.rules.rank;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.RuleTestSupport;
import ca.shiftcircle.rules.facts.OvertimeRankingFact;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.rank.OvertimeRanker.Candidate;
import ca.shiftcircle.rules.rank.OvertimeRanker.Eligibility;
import ca.shiftcircle.rules.rank.OvertimeRanker.Ranked;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The overtime ranking (docs/05 §2F): fewest overtime hours first, ties by seniority, a blocked
 * officer skipped without losing their place, an unqualified officer shown as unavailable where the
 * fairness order puts them. These are the rules PC-07, PC-08 and PC-09 stand on.
 */
class OvertimeRankerTest {

  private final OvertimeRanker ranker = new OvertimeRanker();
  private final RankingPolicy policy = RankingPolicy.v1();

  private static Candidate candidate(
      String id,
      double overtimeHours,
      LocalDate seniority,
      String unavailableReason,
      RuleOutcome outcome,
      String reason) {
    return new Candidate(
        id,
        "Officer " + id,
        List.of("FIRST_AID"),
        overtimeHours,
        seniority,
        unavailableReason,
        outcome,
        reason,
        outcome == null ? List.of() : List.of("U-01"));
  }

  @Test
  void fewestOvertimeHoursRanksFirst() {
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate("a", 18.5, LocalDate.of(2017, 2, 1), null, null, null),
                candidate("b", 4.0, LocalDate.of(2014, 3, 1), null, null, null),
                candidate("c", 9.5, LocalDate.of(2011, 5, 1), null, null, null)),
            policy);

    assertThat(ranked).extracting(r -> r.candidate().employeeId()).containsExactly("b", "c", "a");
    assertThat(ranked).extracting(Ranked::rank).containsExactly(1, 2, 3);
    assertThat(ranked).allSatisfy(r -> assertThat(r.eligibility()).isEqualTo(Eligibility.ELIGIBLE));
  }

  @Test
  void equalOvertimeIsBrokenBySeniority() {
    // PC-07: two officers share the overtime total; the earlier seniority date wins.
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate("junior", 8.0, LocalDate.of(2016, 11, 1), null, null, null),
                candidate("senior", 8.0, LocalDate.of(2014, 3, 1), null, null, null)),
            policy);

    assertThat(ranked).extracting(r -> r.candidate().employeeId()).containsExactly("senior",
        "junior");
  }

  @Test
  void aBlockedOfficerIsSkippedAndKeepsTheirPlace() {
    // O-03: fewest overtime hours, but the shift would break U-01. Rank 1 stays rank 1.
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate(
                    "blocked",
                    1.0,
                    LocalDate.of(2014, 3, 1),
                    null,
                    RuleOutcome.BLOCK,
                    "U-01: 5 hours rest after the night shift"),
                candidate("next", 2.0, LocalDate.of(2016, 1, 1), null, null, null)),
            policy);

    Ranked first = ranked.get(0);
    assertThat(first.rank()).isEqualTo(1);
    assertThat(first.candidate().employeeId()).isEqualTo("blocked");
    assertThat(first.eligibility()).isEqualTo(Eligibility.SKIPPED);
    assertThat(first.reason()).contains("U-01");
    assertThat(ranked.get(1).candidate().employeeId()).isEqualTo("next");
    assertThat(ranked.get(1).eligibility()).isEqualTo(Eligibility.ELIGIBLE);
  }

  @Test
  void anUnqualifiedOfficerKeepsTheFairnessPlaceButIsUnavailable() {
    // PC-09: the officer with the fewest overtime hours lacks CONTROL; they still head the list,
    // so the supervisor can see why the fairest candidate cannot take it.
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate(
                    "unqualified",
                    0.0,
                    LocalDate.of(2012, 6, 1),
                    "Does not hold the CONTROL qualification",
                    null,
                    null),
                candidate("qualified", 3.5, LocalDate.of(2015, 4, 1), null, null, null)),
            policy);

    assertThat(ranked.get(0).rank()).isEqualTo(1);
    assertThat(ranked.get(0).candidate().employeeId()).isEqualTo("unqualified");
    assertThat(ranked.get(0).eligibility()).isEqualTo(Eligibility.UNAVAILABLE);
    assertThat(ranked.get(0).reason()).contains("CONTROL");
    assertThat(ranked.get(1).eligibility()).isEqualTo(Eligibility.ELIGIBLE);
  }

  @Test
  void anAlreadyScheduledOfficerIsUnavailable() {
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate(
                    "booked", 2.0, LocalDate.of(2014, 3, 1), "Already scheduled", null, null)),
            policy);

    assertThat(ranked.get(0).eligibility()).isEqualTo(Eligibility.UNAVAILABLE);
  }

  @Test
  void aWarningStaysEligibleWithTheWarning() {
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate(
                    "warned",
                    2.0,
                    LocalDate.of(2014, 3, 1),
                    null,
                    RuleOutcome.WARN,
                    "U-14: 56 hours that week")),
            policy);

    assertThat(ranked.get(0).eligibility()).isEqualTo(Eligibility.WARN);
    assertThat(ranked.get(0).reason()).contains("U-14");
  }

  @Test
  void thePolicyComesFromTheOtRankingRows() {
    RankingPolicy fromRows = RankingPolicy.from(RuleRowsV1.ruleSet());

    assertThat(fromRows.orderBy())
        .containsExactly(
            RankingPolicy.SortKey.OT_HOURS_QUARTER_ASC, RankingPolicy.SortKey.SENIORITY_ASC);
    assertThat(fromRows.skipIfBlocked()).isTrue();
    assertThat(fromRows.keepPlace()).isTrue();
  }

  @Test
  void keepPlaceCanBeTurnedOffByThePolicy() {
    RankingPolicy moveDown = new RankingPolicy(RankingPolicy.defaults(), true, false);
    List<Ranked> ranked =
        ranker.rank(
            List.of(
                candidate("blocked", 1.0, LocalDate.of(2014, 3, 1), null, RuleOutcome.BLOCK,
                    "U-01 rest"),
                candidate("available", 5.0, LocalDate.of(2016, 1, 1), null, null, null)),
            moveDown);

    assertThat(ranked).extracting(r -> r.candidate().employeeId())
        .containsExactly("available", "blocked");
    assertThat(ranked).extracting(Ranked::rank).containsExactly(1, 2);
  }

  @Test
  void tiesAreBrokenDeterministically() {
    Candidate one = candidate("id-1", 8.0, LocalDate.of(2014, 3, 1), null, null, null);
    Candidate two = candidate("id-2", 8.0, LocalDate.of(2014, 3, 1), null, null, null);

    assertThat(ranker.rank(List.of(two, one), policy))
        .extracting(r -> r.candidate().employeeId())
        .containsExactly("id-1", "id-2");
  }

  @Test
  void theRankingRuleRowsRecordThePolicy() {
    // The ranking is Java, but the rule table still records which policy produced the list, so the
    // audit trail names the rule-set version (O-01 to O-03).
    List<RuleResult> results =
        RuleTestSupport.evaluate(new OvertimeRankingFact(4, 1, "4 ranked, 1 skipped"));

    assertThat(results)
        .filteredOn(result -> result.ruleTable().equals("OT_RANKING"))
        .extracting(RuleResult::ruleId)
        .contains("O-01", "O-02", "O-03");
  }
}
