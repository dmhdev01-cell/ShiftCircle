package ca.shiftcircle.rules.facts;

import java.util.List;

/**
 * Derived fact for rest rules: the shortest gap between two consecutive shifts inside the window.
 *
 * <p>Built by a Java fact builder, never by rule authors. Uses JavaBean accessors because Drools
 * constraints resolve properties through getters, not record accessors.
 */
public class MinRestInWindowFact {

  private final String shiftKind;
  private final int windowHours;
  private final double minRestHours;
  private final double previousExtensionMinutes;
  private final String evidence;
  private final List<String> evidenceAssignmentIds;

  public MinRestInWindowFact(
      String shiftKind,
      int windowHours,
      double minRestHours,
      double previousExtensionMinutes,
      String evidence,
      List<String> evidenceAssignmentIds) {
    this.shiftKind = shiftKind;
    this.windowHours = windowHours;
    this.minRestHours = minRestHours;
    this.previousExtensionMinutes = previousExtensionMinutes;
    this.evidence = evidence;
    this.evidenceAssignmentIds = List.copyOf(evidenceAssignmentIds);
  }

  public String getShiftKind() {
    return shiftKind;
  }

  public int getWindowHours() {
    return windowHours;
  }

  public double getMinRestHours() {
    return minRestHours;
  }

  public double getPreviousExtensionMinutes() {
    return previousExtensionMinutes;
  }

  public String getEvidence() {
    return evidence;
  }

  public List<String> getEvidenceAssignmentIds() {
    return evidenceAssignmentIds;
  }

  @Override
  public String toString() {
    return "MinRestInWindowFact[shiftKind="
        + shiftKind
        + ", windowHours="
        + windowHours
        + ", minRestHours="
        + minRestHours
        + ", previousExtensionMinutes="
        + previousExtensionMinutes
        + "]";
  }
}
