package ca.shiftcircle.api.config;

import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.RuleSetCompiler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the rules engine into the Spring context.
 *
 * <p>The live {@code KieBase} lives in {@link PublishedRuleSet} so the publish pipeline can hot-swap
 * it (step 11); the compiler and evaluator stay stateless beans.
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
}
