package ca.shiftcircle.api.rulesets;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** A rule that used to fire and now fires nowhere is a safeguard that quietly disappeared (S4). */
class RuleSetServiceDryRunTest {

  @Test
  void aRuleThatStopsFiringIsNamed() {
    Map<String, Integer> before = new LinkedHashMap<>();
    before.put("U-01", 4);
    before.put("U-10", 0);
    Map<String, Integer> after = new LinkedHashMap<>();
    after.put("U-01", 0);

    assertThat(RuleSetService.silentRules(before, after))
        .as("only rules that actually fired before count")
        .containsExactly("U-01");
  }
}
