package ca.shiftcircle.rules.facts;

import java.util.List;

/**
 * Derived fact for rule U-12: the worst 7-day window's longest break without a shift, and how many
 * days off that break counts as.
 *
 * <p>"A break of 24 hours or less does not count as a day of rest" (docs/05 §2.B), so a 24 h break
 * counts as zero days, 24 h 01 m as one, 48 h as two. Two consecutive days off therefore needs 48
 * hours.
 */
public class DaysOffFact {

  private final int windowDays;
  private final double longestBreakHours;
  private final int countedDaysOff;
  private final String evidence;

  public DaysOffFact(
      int windowDays, double longestBreakHours, int countedDaysOff, String evidence) {
    this.windowDays = windowDays;
    this.longestBreakHours = longestBreakHours;
    this.countedDaysOff = countedDaysOff;
    this.evidence = evidence;
  }

  public int getWindowDays() {
    return windowDays;
  }

  public double getLongestBreakHours() {
    return longestBreakHours;
  }

  public int getCountedDaysOff() {
    return countedDaysOff;
  }

  public String getEvidence() {
    return evidence;
  }

  /** The fact covers a window, not one assignment, so there is no id to carry. */
  public List<String> getEvidenceAssignmentIds() {
    return List.of();
  }

  @Override
  public String toString() {
    return "DaysOffFact[windowDays="
        + windowDays
        + ", longestBreakHours="
        + longestBreakHours
        + ", countedDaysOff="
        + countedDaysOff
        + "]";
  }
}
