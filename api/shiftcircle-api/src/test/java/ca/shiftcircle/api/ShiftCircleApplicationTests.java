package ca.shiftcircle.api;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.facts.MinRestInWindowFact;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import java.util.List;
import org.junit.jupiter.api.Test;
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

  @Autowired private PublishedRuleSet publishedRuleSet;

  @Autowired private RuleEvaluator ruleEvaluator;

  @Test
  void contextLoads() {
    assertThat(publishedRuleSet.kieBase()).isNotNull();
    assertThat(publishedRuleSet.ruleSet()).isNotNull();
  }

  @Test
  void firesU01InsideTheSpringContext() {
    MinRestInWindowFact fact =
        new MinRestInWindowFact(
            "D8", 24, 4.0, 0, "D8 ends Thu 19 Nov 15:00, next shift starts 19:00 (4.00 h rest)");

    List<RuleResult> results = ruleEvaluator.evaluate(publishedRuleSet.kieBase(), "v1", fact);

    assertThat(results)
        .filteredOn(result -> result.ruleId().equals("U-01"))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }
}
