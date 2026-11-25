package ca.shiftcircle.api.proposals;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.pay.PayClassifier;
import ca.shiftcircle.rules.pay.PayPolicy;
import org.junit.jupiter.api.Test;

/**
 * "Would be overtime: N h" on the decision card (owner Q5): the P-01 threshold and the P-04
 * under-30-minute rule decide it, from the policy, exactly as payroll will.
 */
class ProposalOvertimeTest {

  private final PayClassifier classifier = new PayClassifier();

  @Test
  void theThresholdAndTheP04MinimumDecideTheOvertimeAnItemAdds() {
    PayPolicy policy = PayPolicy.DEFAULT; // 80 h, 30 min unpaid minimum
    // Reaching the threshold exactly is no overtime.
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 72, 8, policy)).isEqualTo(0.0);
    // 15 minutes over is under the P-04 minimum: still no overtime.
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 72.25, 8, policy)).isEqualTo(0.0);
    // Exactly the minimum (30 minutes) is paid as overtime.
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 72.5, 8, policy)).isEqualTo(0.5);
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 76, 8, policy)).isEqualTo(4.0);
    // Already over: the whole shift is overtime.
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 85, 8, policy)).isEqualTo(8.0);
    // An item that lifts a period from under the minimum to over it counts all of it.
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 80.25, 8, policy)).isEqualTo(8.25);
  }

  @Test
  void theThresholdComesFromTheRuleSetNotFromTheCode() {
    PayPolicy seventy = new PayPolicy("PAY_PERIOD", 70, 1.5, 30);
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 66, 8, seventy)).isEqualTo(4.0);
    assertThat(ProposalDecisionService.overtimeAdded(classifier, 62, 8, seventy)).isEqualTo(0.0);
  }
}
