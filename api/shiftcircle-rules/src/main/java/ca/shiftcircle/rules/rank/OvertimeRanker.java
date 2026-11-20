package ca.shiftcircle.rules.rank;

import ca.shiftcircle.rules.facts.RuleOutcome;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Ranks officers for an open shift the way the overtime-ranking table says (docs/05 §2F,
 * O-01 to O-03).
 *
 * <p>The ranking is deliberately simple and explainable: fewest overtime hours this quarter first,
 * ties broken by seniority (O-02). Every officer keeps the place that ordering gives them — an
 * officer a Block rule would stop is shown as {@link Eligibility#SKIPPED} in that same place, not
 * pushed to the bottom ("skipped, not penalised": O-03). An officer who cannot take the shift at
 * all (unqualified, already scheduled) is {@link Eligibility#UNAVAILABLE} in their place too, so the
 * supervisor can see that the fairest next person is not the one who can work it (PC-09).
 *
 * <p>{@code skipIfBlocked} from the policy is enforced unconditionally: an offer must never be made
 * for a shift the rules would block. Turning it off is refused by the publish validation.
 */
public final class OvertimeRanker {

  /** How a candidate stands for this shift (the web's {@code Eligibility}). */
  public enum Eligibility {
    /** Can be offered; every rule passed. */
    ELIGIBLE,
    /** Can be offered, but carries warnings the supervisor must acknowledge. */
    WARN,
    /** Would break a Block rule; skipped, and keeps their place in the order. */
    SKIPPED,
    /** Cannot be considered: unqualified, already scheduled, or not an active officer. */
    UNAVAILABLE
  }

  /**
   * What the API knows about one officer before ranking.
   *
   * @param unavailableReason non-null when the officer cannot be considered at all
   * @param worstOutcome the worst shift-rule outcome, or null when every rule passed
   * @param reason a one-line, human reason for a warning or a skip
   * @param ruleCodes the rule codes behind that outcome
   */
  public record Candidate(
      String employeeId,
      String name,
      List<String> qualifications,
      double overtimeHoursThisQuarter,
      LocalDate seniorityDate,
      String unavailableReason,
      RuleOutcome worstOutcome,
      String reason,
      List<String> ruleCodes) {

    public Candidate {
      qualifications = List.copyOf(qualifications);
      ruleCodes = List.copyOf(ruleCodes);
    }
  }

  /** A candidate with the rank and eligibility the ranker decided. */
  public record Ranked(int rank, Candidate candidate, Eligibility eligibility, String reason) {}

  public List<Ranked> rank(List<Candidate> candidates, RankingPolicy policy) {
    List<Candidate> ordered = new ArrayList<>(candidates);
    ordered.sort(comparator(policy));

    if (!policy.keepPlace()) {
      // A rule set may choose to move skipped officers down; v1 does not (O-03).
      ordered.sort(
          Comparator.comparingInt(
              candidate ->
                  candidate.unavailableReason() != null
                      ? 2
                      : candidate.worstOutcome() == RuleOutcome.BLOCK ? 1 : 0));
    }

    List<Ranked> ranked = new ArrayList<>(ordered.size());
    int rank = 0;
    for (Candidate candidate : ordered) {
      rank++;
      Eligibility eligibility;
      String reason;
      if (candidate.unavailableReason() != null) {
        eligibility = Eligibility.UNAVAILABLE;
        reason = candidate.unavailableReason();
      } else if (candidate.worstOutcome() == RuleOutcome.BLOCK) {
        eligibility = Eligibility.SKIPPED;
        reason = candidate.reason() == null ? "Bypassed: breaks a block rule" : candidate.reason();
      } else if (candidate.worstOutcome() == RuleOutcome.WARN) {
        eligibility = Eligibility.WARN;
        reason = candidate.reason();
      } else {
        eligibility = Eligibility.ELIGIBLE;
        reason = null;
      }
      ranked.add(new Ranked(rank, candidate, eligibility, reason));
    }
    return ranked;
  }

  private Comparator<Candidate> comparator(RankingPolicy policy) {
    Comparator<Candidate> comparator = null;
    for (RankingPolicy.SortKey key : policy.orderBy()) {
      Comparator<Candidate> next =
          switch (key) {
            case OT_HOURS_QUARTER_ASC ->
                Comparator.comparingDouble(Candidate::overtimeHoursThisQuarter);
            case SENIORITY_ASC ->
                Comparator.comparing(
                    Candidate::seniorityDate,
                    Comparator.nullsLast(Comparator.naturalOrder()));
          };
      comparator = comparator == null ? next : comparator.thenComparing(next);
    }
    // Deterministic even when two officers share both keys: the result must not depend on
    // hash order, or a rerun could show a different list.
    return (comparator == null ? Comparator.comparing(Candidate::name) : comparator)
        .thenComparing(Candidate::employeeId);
  }
}
