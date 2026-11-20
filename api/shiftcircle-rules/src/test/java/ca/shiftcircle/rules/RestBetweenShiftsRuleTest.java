package ca.shiftcircle.rules;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.facts.MinRestInWindowFact;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.tables.RestBetweenShiftsRows;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.kie.api.KieBase;

/**
 * Day 1 compatibility spike (HANDOFF §6 step 1): a Drools rule template plus a data row compiles
 * into a KieBase and U-01 fires in a stateless session.
 *
 * <p>These are also the first real boundary tests for U-01: under, exactly at, and over the
 * 8-hour legal minimum.
 */
class RestBetweenShiftsRuleTest {

  private static final String RULE_SET_VERSION = "v1";

  private static KieBase ruleBase() {
    return new RuleSetCompiler()
        .compileFromClasspath(RestBetweenShiftsRows.TEMPLATE, RestBetweenShiftsRows.v1Defaults());
  }

  private static List<RuleResult> evaluate(double restHours) {
    MinRestInWindowFact fact =
        new MinRestInWindowFact(
            "ANY", 24, restHours, "Previous shift ended 23:00; next shift starts 07:00");
    return new RuleEvaluator().evaluate(ruleBase(), RULE_SET_VERSION, fact);
  }

  @Test
  void blocksWhenRestIsUnderTheLegalMinimum() {
    List<RuleResult> results = evaluate(4.0);

    assertThat(results).hasSize(1);
    RuleResult result = results.get(0);
    assertThat(result.ruleId()).isEqualTo("U-01");
    assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
    assertThat(result.required()).isEqualTo(8.0);
    assertThat(result.actual()).isEqualTo(4.0);
    assertThat(result.overridePolicy()).isEqualTo("EMERGENCY");
    assertThat(result.ruleSetVersion()).isEqualTo(RULE_SET_VERSION);
  }

  @Test
  void passesAtExactlyEightHours() {
    assertThat(evaluate(8.0)).isEmpty();
  }

  @Test
  void passesAboveTheMinimum() {
    assertThat(evaluate(9.5)).isEmpty();
  }

  @Test
  void doesNotApplyToAFactFromAnotherWindow() {
    MinRestInWindowFact weeklyFact =
        new MinRestInWindowFact("ANY", 168, 4.0, "weekly window, not the 24 h table row");
    assertThat(new RuleEvaluator().evaluate(ruleBase(), RULE_SET_VERSION, weeklyFact)).isEmpty();
  }
}
