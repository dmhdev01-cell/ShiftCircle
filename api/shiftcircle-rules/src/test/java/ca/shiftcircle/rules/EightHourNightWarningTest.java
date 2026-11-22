package ca.shiftcircle.rules;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.facts.ShiftLengthFact;
import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.kie.api.KieBase;

/** Release 4 #10: an 8 h officer on a night shift is a WARN; a 12 h night shift is not. */
class EightHourNightWarningTest {

  private static KieBase ruleBase() {
    return new RuleSetCompiler().compile(RuleRowsV1.ruleSet());
  }

  private static List<RuleResult> evaluate(KieBase ruleBase, ShiftLengthFact fact) {
    return new RuleEvaluator().evaluate(ruleBase, RuleRowsV1.VERSION, fact).stream()
        .filter(result -> result.ruleId().equals("U-16"))
        .toList();
  }

  @Test
  void theShippedRowIsAWarningTheSupervisorAcknowledges() {
    RuleRow row =
        RuleRowsV1.ruleSet().rows().stream()
            .filter(candidate -> candidate.code().equals("U-16"))
            .findFirst()
            .orElseThrow();
    assertThat(row.severity()).isEqualTo(RuleOutcome.WARN);
    assertThat(row.overridePolicy()).isEqualTo(OverridePolicy.ACKNOWLEDGE);
    assertThat(row.params()).containsEntry("nightShiftOnly", true);
  }

  @Test
  void anEightHourNightShiftWarns() {
    List<RuleResult> results =
        evaluate(ruleBase(), new ShiftLengthFact("N8", 480, 480, true, true, "N8 23:00", "id"));
    assertThat(results).hasSize(1);
    assertThat(results.get(0).outcome()).isEqualTo(RuleOutcome.WARN);
    assertThat(results.get(0).message()).contains("8-hour officer");
  }

  @Test
  void anEightHourDayShiftAndATwelveHourNightShiftDoNotWarn() {
    KieBase ruleBase = ruleBase();
    assertThat(
            evaluate(ruleBase, new ShiftLengthFact("D8", 480, 480, true, false, "D8 07:00", "id")))
        .isEmpty();
    assertThat(
            evaluate(ruleBase, new ShiftLengthFact("N12", 720, 720, true, true, "N12 19:00", "id")))
        .isEmpty();
  }
}
