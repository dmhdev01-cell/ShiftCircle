package ca.shiftcircle.rules.pay;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;

/**
 * Classifies hours for payroll (P-01, P-01b, P-04).
 *
 * <p>Time maths stays in Java, as docs/04-rules-engine.md §3 requires; the rule rows supply the
 * threshold, the rate and the unpaid minimum. Overtime is hours beyond the threshold in the period,
 * in time order, so a rostered 12- or 16-hour shift is regular time (ADR-016).
 */
public final class PayClassifier {

  /** Reads the policy from the rule set, falling back to the v1 defaults when a row is disabled. */
  public PayPolicy policyFrom(RuleSet ruleSet) {
    PayPolicy policy = PayPolicy.DEFAULT;
    for (RuleRow row : ruleSet.enabledRows()) {
      switch (row.code()) {
        case "P-01" ->
            policy =
                new PayPolicy(
                    row.text("thresholdWindow"),
                    row.number("thresholdHours"),
                    policy.overtimeRate(),
                    policy.ignoreUnderMinutes());
        case "P-01b" ->
            policy =
                new PayPolicy(
                    policy.thresholdWindow(),
                    policy.thresholdHours(),
                    row.number("otRate"),
                    policy.ignoreUnderMinutes());
        case "P-04" ->
            policy =
                new PayPolicy(
                    policy.thresholdWindow(),
                    policy.thresholdHours(),
                    policy.overtimeRate(),
                    row.number("ignoreUnderMinutes"));
        default -> {
          // other tables contribute no pay policy
        }
      }
    }
    return policy;
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
