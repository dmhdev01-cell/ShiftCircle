package ca.shiftcircle.rules.facts;

/**
 * Derived fact for the shift-length table (L-01, S-03): a shift's template length and whether the
 * unit's local agreement allows that pattern.
 */
public class ShiftLengthFact {

  private final String templateCode;
  private final int durationMinutes;
  private final int nominalMinutes;
  private final boolean allowedPatternByUnit;
  private final String evidence;

  public ShiftLengthFact(
      String templateCode,
      int durationMinutes,
      int nominalMinutes,
      boolean allowedPatternByUnit,
      String evidence) {
    this.templateCode = templateCode;
    this.durationMinutes = durationMinutes;
    this.nominalMinutes = nominalMinutes;
    this.allowedPatternByUnit = allowedPatternByUnit;
    this.evidence = evidence;
  }

  public String getTemplateCode() {
    return templateCode;
  }

  public int getDurationMinutes() {
    return durationMinutes;
  }

  /** Template length, before any extension: what "allowed shift lengths" means (review F5). */
  public int getNominalMinutes() {
    return nominalMinutes;
  }

  public boolean isAllowedPatternByUnit() {
    return allowedPatternByUnit;
  }

  public boolean isTwelveHour() {
    return nominalMinutes == 720;
  }

  public boolean isSixteenHour() {
    return nominalMinutes == 960;
  }

  public String getEvidence() {
    return evidence;
  }
}
