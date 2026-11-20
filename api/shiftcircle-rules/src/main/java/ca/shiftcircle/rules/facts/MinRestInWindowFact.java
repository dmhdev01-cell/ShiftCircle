package ca.shiftcircle.rules.facts;

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
  private final String evidence;

  public MinRestInWindowFact(
      String shiftKind, int windowHours, double minRestHours, String evidence) {
    this.shiftKind = shiftKind;
    this.windowHours = windowHours;
    this.minRestHours = minRestHours;
    this.evidence = evidence;
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

  public String getEvidence() {
    return evidence;
  }

  @Override
  public String toString() {
    return "MinRestInWindowFact[shiftKind="
        + shiftKind
        + ", windowHours="
        + windowHours
        + ", minRestHours="
        + minRestHours
        + "]";
  }
}
