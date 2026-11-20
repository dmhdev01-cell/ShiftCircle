package ca.shiftcircle.api;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.facts.MinRestInWindowFact;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.kie.api.KieBase;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Compatibility spike, Spring half: a Spring Boot 4.x context starts with Drools 10.x on the
 * classpath and the published rule base fires inside it.
 */
@SpringBootTest
class ShiftCircleApplicationTests {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private KieBase publishedRuleBase;

  @Autowired private RuleEvaluator ruleEvaluator;

  @Test
  void contextLoads() {
    assertThat(publishedRuleBase).isNotNull();
  }

  @Test
  void firesU01InsideTheSpringContext() {
    MinRestInWindowFact fact =
        new MinRestInWindowFact("ANY", 24, 4.0, "Shortest rest gap in the 24 h window was 4.0 h");

    List<RuleResult> results = ruleEvaluator.evaluate(publishedRuleBase, "v1", fact);

    assertThat(results).singleElement().satisfies(result -> {
      assertThat(result.ruleId()).isEqualTo("U-01");
      assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
    });
  }
}
