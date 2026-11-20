package ca.shiftcircle.rules.facts;

/**
 * Derived fact for the shift-length table (L-01, S-03): a shift's template length and whether the
 * unit's local agreement allows that pattern.
 */
public class ShiftLengthFact {

  private final String templateCode;
  private final int durationMinutes;
  private final boolean allowedPatternByUnit;
  private final String evidence;

  public ShiftLengthFact(
      String templateCode, int durationMinutes, boolean allowedPatternByUnit, String evidence) {
    this.templateCode = templateCode;
    this.durationMinutes = durationMinutes;
    this.allowedPatternByUnit = allowedPatternByUnit;
    this.evidence = evidence;
  }

  public String getTemplateCode() {
    return templateCode;
  }

  public int getDurationMinutes() {
    return durationMinutes;
  }

  public boolean isAllowedPatternByUnit() {
    return allowedPatternByUnit;
  }

  public boolean isTwelveHour() {
    return durationMinutes == 720;
  }

  public boolean isSixteenHour() {
    return durationMinutes == 960;
  }

  public String getEvidence() {
    return evidence;
  }
}
