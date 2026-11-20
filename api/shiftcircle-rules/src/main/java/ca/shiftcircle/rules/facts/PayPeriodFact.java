package ca.shiftcircle.rules.facts;

import java.util.List;

/**
 * Derived fact for the pay table: one officer's hours so far in a week or pay period, already
 * classified by {@code PayClassifier}. The rule reports the classification; it never recomputes it.
 */
public class PayPeriodFact {

  private final double totalHours;
  private final double regularHours;
  private final double overtimeHours;
  private final double overtimeMinutes;
  private final double rate;
  private final double thresholdHours;
  private final String evidence;

  public PayPeriodFact(
      double totalHours,
      double regularHours,
      double overtimeHours,
      double overtimeMinutes,
      double rate,
      double thresholdHours,
      String evidence) {
    this.totalHours = totalHours;
    this.regularHours = regularHours;
    this.overtimeHours = overtimeHours;
    this.overtimeMinutes = overtimeMinutes;
    this.rate = rate;
    this.thresholdHours = thresholdHours;
    this.evidence = evidence;
  }

  public double getTotalHours() {
    return totalHours;
  }

  public double getRegularHours() {
    return regularHours;
  }

  public double getOvertimeHours() {
    return overtimeHours;
  }

  public double getOvertimeMinutes() {
    return overtimeMinutes;
  }

  public double getRate() {
    return rate;
  }

  public double getThresholdHours() {
    return thresholdHours;
  }

  public String getEvidence() {
    return evidence;
  }

  /** A pay classification is per officer, not per assignment. */
  public List<String> getEvidenceAssignmentIds() {
    return List.of();
  }
}
