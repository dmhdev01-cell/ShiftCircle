package ca.shiftcircle.rules.facts;

/**
 * Derived fact for the overtime-ranking table: one open shift that has been ranked. The ordering
 * itself is computed in Java; the rule records which policy produced it.
 */
public class OvertimeRankingFact {

  private final int rankedCount;
  private final int skippedCount;
  private final String evidence;

  public OvertimeRankingFact(int rankedCount, int skippedCount, String evidence) {
    this.rankedCount = rankedCount;
    this.skippedCount = skippedCount;
    this.evidence = evidence;
  }

  public int getRankedCount() {
    return rankedCount;
  }

  public int getSkippedCount() {
    return skippedCount;
  }

  public String getEvidence() {
    return evidence;
  }
}
