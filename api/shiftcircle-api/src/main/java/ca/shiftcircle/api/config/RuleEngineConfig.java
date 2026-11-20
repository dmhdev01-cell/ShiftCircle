package ca.shiftcircle.api.config;

import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.RuleSetCompiler;
import ca.shiftcircle.rules.tables.RestBetweenShiftsRows;
import org.kie.api.KieBase;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the published rule set into the Spring context.
 *
 * <p>Day 1 spike scope: one decision table (rest between shifts, U-01) compiled at startup. The
 * rules publish pipeline replaces this with rows loaded from PostgreSQL and a hot-swapped KieBase.
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
    return compiler.compileFromClasspath(
        RestBetweenShiftsRows.TEMPLATE, RestBetweenShiftsRows.v1Defaults());
  }
}
