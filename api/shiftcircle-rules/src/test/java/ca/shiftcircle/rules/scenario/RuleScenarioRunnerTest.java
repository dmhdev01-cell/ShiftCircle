package ca.shiftcircle.rules.scenario;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.RuleTestSupport;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The publish pipeline runs these before a version can go live (docs/04 §6). If a scenario fails
 * here, the build must fail, so this is the safety net for a rule change that breaks a named case.
 */
class RuleScenarioRunnerTest {

  @Test
  void everyNamedScenarioPassesOnThePublishedRuleSet() {
    List<RuleScenarioRunner.Result> results =
        new RuleScenarioRunner().run(RuleTestSupport.v1RuleBase(), RuleRowsV1.VERSION);

    assertThat(results)
        .allSatisfy(
            result ->
                assertThat(result.passed())
                    .as(result.id() + " " + result.name() + ": " + result.failures())
                    .isTrue());
    assertThat(results).extracting(RuleScenarioRunner.Result::id)
        .containsExactly("T1", "T2", "T3", "T4", "T5");
  }

  @Test
  void removingTheRestTargetFailsTheBoundaryScenario() {
    List<RuleRow> rows =
        RuleRowsV1.ruleSet().rows().stream()
            .filter(row -> !row.code().equals("U-02"))
            .toList();

    List<RuleScenarioRunner.Result> results =
        new RuleScenarioRunner()
            .run(new ca.shiftcircle.rules.RuleSetCompiler().compile(new RuleSet("broken", rows)),
                "broken");

    assertThat(results)
        .filteredOn(result -> result.id().equals("T3"))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.passed()).isFalse();
              assertThat(result.failures()).anySatisfy(
                  failure -> assertThat(failure).contains("U-02"));
            });
  }

  @Test
  void theRankingCheckPassesOnThePublishedPolicy() {
    List<RuleScenarioRunner.Result> results =
        new RuleScenarioRunner().checkRanking(RuleRowsV1.ruleSet());

    assertThat(results).allSatisfy(result -> assertThat(result.passed()).isTrue());
  }
}
