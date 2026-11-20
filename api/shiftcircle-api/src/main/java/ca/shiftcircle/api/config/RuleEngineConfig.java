package ca.shiftcircle.api.config;

import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.RuleSetCompiler;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import org.kie.api.KieBase;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the published rule set into the Spring context.
 *
 * <p>Step 4 scope: rule set v1 from {@code RuleRowsV1} compiled at startup. Step 11 replaces this
 * with rows loaded from PostgreSQL and a hot-swapped KieBase.
 */
@Configuration
public class RuleEngineConfig {

  @Bean
  public RuleSetCompiler ruleSetCompiler() {
    return new RuleSetCompiler();
  }

  @Bean
  public RuleEvaluator ruleEvaluator() {
    return new RuleEvaluator();
  }

  @Bean
  public KieBase publishedRuleBase(RuleSetCompiler compiler) {
    return compiler.compile(RuleRowsV1.ruleSet());
  }
}
