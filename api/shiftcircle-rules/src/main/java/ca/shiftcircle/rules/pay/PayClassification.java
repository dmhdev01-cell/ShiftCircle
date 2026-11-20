package ca.shiftcircle.rules.pay;

/**
 * Result of classifying one officer's hours in a period.
 *
 * @param totalHours all worked hours in the period
 * @param regularHours hours up to the threshold
 * @param overtimeHours hours beyond the threshold that are paid (0 when under the unpaid minimum)
 * @param overtimeMinutes raw overtime minutes, before the P-04 minimum is applied
 * @param rate overtime multiplier applied to {@code overtimeHours}
 */
public record PayClassification(
    double totalHours,
    double regularHours,
    double overtimeHours,
    double overtimeMinutes,
    double rate) {

  public boolean hasOvertime() {
    return overtimeHours > 0;
  }
}
