package ca.shiftcircle.rules.facts;

/**
 * Derived fact for rule U-12: the longest break without a shift inside the 7-day window. Two
 * consecutive days off is 48 hours, so a 47 h 59 m break fails the row.
 */
public class DaysOffFact {

  private final int windowDays;
  private final double longestBreakHours;
  private final String evidence;

  public DaysOffFact(int windowDays, double longestBreakHours, String evidence) {
    this.windowDays = windowDays;
    this.longestBreakHours = longestBreakHours;
    this.evidence = evidence;
  }

  public int getWindowDays() {
    return windowDays;
  }

  public double getLongestBreakHours() {
    return longestBreakHours;
  }

  public String getEvidence() {
    return evidence;
  }

  @Override
  public String toString() {
    return "DaysOffFact[windowDays=" + windowDays + ", longestBreakHours=" + longestBreakHours + "]";
  }
}
