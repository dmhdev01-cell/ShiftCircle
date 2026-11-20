package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.PayPeriodFact;
import ca.shiftcircle.rules.pay.PayClassification;
import ca.shiftcircle.rules.pay.PayPolicy;

/** Turns a classification into the pay fact the PAY rule reports on. */
public final class PayFactBuilder {

  public PayPeriodFact build(String employee, PayClassification classification, PayPolicy policy) {
    String evidence =
        String.format(
            "%s: %.2f h worked, %.2f h regular, %.2f h at %.2fx (threshold %.2f h per %s)",
            employee,
            classification.totalHours(),
            classification.regularHours(),
            classification.overtimeHours(),
            classification.rate(),
            policy.thresholdHours(),
            policy.thresholdWindow());
    return new PayPeriodFact(
        classification.totalHours(),
        classification.regularHours(),
        classification.overtimeHours(),
        classification.overtimeMinutes(),
        classification.rate(),
        policy.thresholdHours(),
        evidence);
  }
}
