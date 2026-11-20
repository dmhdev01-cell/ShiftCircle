package ca.shiftcircle.rules.pay;

/**
 * The pay-relevant settings from the PAY table: threshold (P-01), overtime rate (P-01b) and the
 * unpaid minimum (P-04). Read from the rule rows so a rules admin changes the values, not the code.
 */
public record PayPolicy(
    String thresholdWindow, double thresholdHours, double overtimeRate, double ignoreUnderMinutes) {

  public static final PayPolicy DEFAULT = new PayPolicy("PAY_PERIOD", 80, 1.5, 30);
}
