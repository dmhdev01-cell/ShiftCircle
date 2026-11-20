package ca.shiftcircle.rules.facts;

import java.util.List;

/**
 * Derived fact for consecutive-work rules (U-08 days, U-09 12-hour shifts, U-10 overnight 12-hour
 * shifts): the longest run for one officer, and whether the shift that causes it was picked up
 * outside the roster (overtime-caused runs warn instead of block).
 */
public class ConsecutiveRunFact {

  private final String counts;
  private final int runLength;
  private final boolean causedByOvertime;
  private final String evidence;
  private final List<String> evidenceAssignmentIds;

  public ConsecutiveRunFact(
      String counts,
      int runLength,
      boolean causedByOvertime,
      String evidence,
      List<String> evidenceAssignmentIds) {
    this.counts = counts;
    this.runLength = runLength;
    this.causedByOvertime = causedByOvertime;
    this.evidence = evidence;
    this.evidenceAssignmentIds = List.copyOf(evidenceAssignmentIds);
  }

  public String getCounts() {
    return counts;
  }

  public int getRunLength() {
    return runLength;
  }

  public boolean isCausedByOvertime() {
    return causedByOvertime;
  }

  public String getEvidence() {
    return evidence;
  }

  public List<String> getEvidenceAssignmentIds() {
    return evidenceAssignmentIds;
  }

  @Override
  public String toString() {
    return "ConsecutiveRunFact[counts="
        + counts
        + ", runLength="
        + runLength
        + ", causedByOvertime="
        + causedByOvertime
        + "]";
  }
}
