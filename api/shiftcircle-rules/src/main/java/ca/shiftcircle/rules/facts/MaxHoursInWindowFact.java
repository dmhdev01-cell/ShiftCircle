package ca.shiftcircle.rules.facts;

import java.util.List;

/**
 * Derived fact for hours-in-a-window rules (U-05 24 h, U-14 week, U-15 overtime status): the most
 * hours the officer works in any window of that length, starting at one of their shift starts.
 */
public class MaxHoursInWindowFact {

  private final int windowHours;
  private final double hours;
  private final String evidence;
  private final List<String> evidenceAssignmentIds;

  public MaxHoursInWindowFact(
      int windowHours, double hours, String evidence, List<String> evidenceAssignmentIds) {
    this.windowHours = windowHours;
    this.hours = hours;
    this.evidence = evidence;
    this.evidenceAssignmentIds = List.copyOf(evidenceAssignmentIds);
  }

  public int getWindowHours() {
    return windowHours;
  }

  public double getHours() {
    return hours;
  }

  public String getEvidence() {
    return evidence;
  }

  public List<String> getEvidenceAssignmentIds() {
    return evidenceAssignmentIds;
  }

  @Override
  public String toString() {
    return "MaxHoursInWindowFact[windowHours=" + windowHours + ", hours=" + hours + "]";
  }
}
