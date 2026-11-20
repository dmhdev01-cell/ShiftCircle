package ca.shiftcircle.rules.pay;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import java.util.Map;

/**
 * Classifies hours for payroll (P-01, P-01b, P-04).
 *
 * <p>Time maths stays in Java, as docs/04-rules-engine.md §3 requires; the rule rows supply the
 * threshold, the rate and the unpaid minimum. Overtime is hours beyond the threshold in the period,
 * in time order, so a rostered 12- or 16-hour shift is regular time (ADR-016).
 */
public final class PayClassifier {

  /**
   * Reads the policy from the rule set. All three pay rows must be present and enabled: silently
   * falling back to built-in defaults would pay people under a rule set that is not the published
   * one (review F7), so a missing row fails loudly.
   */
  public PayPolicy policyFrom(RuleSet ruleSet) {
    Map<String, RuleRow> rows = new java.util.HashMap<>();
    ruleSet.enabledRows().forEach(row -> rows.put(row.code(), row));

    RuleRow threshold = require(rows, "P-01");
    RuleRow rate = require(rows, "P-01b");
    RuleRow minimum = require(rows, "P-04");

    return new PayPolicy(
        threshold.text("thresholdWindow"),
        threshold.number("thresholdHours"),
        rate.number("otRate"),
        minimum.number("ignoreUnderMinutes"));
  }

  private static RuleRow require(Map<String, RuleRow> rows, String code) {
    RuleRow row = rows.get(code);
    if (row == null) {
      throw new IllegalStateException(
          "Pay policy is incomplete: rule row " + code + " is missing or disabled");
    }
    return row;
  }

  /** Classifies one officer's period hours under the given policy. */
  public PayClassification classify(double totalHours, PayPolicy policy) {
    double rawOvertimeMinutes = Math.max(0, (totalHours - policy.thresholdHours()) * 60.0);
    double paidOvertimeMinutes =
        rawOvertimeMinutes > 0 && rawOvertimeMinutes < policy.ignoreUnderMinutes()
            ? 0
            : rawOvertimeMinutes;

    double overtimeHours = paidOvertimeMinutes / 60.0;
    double regularHours = Math.min(totalHours, policy.thresholdHours());

    return new PayClassification(
        totalHours, regularHours, overtimeHours, rawOvertimeMinutes, policy.overtimeRate());
  }
}
