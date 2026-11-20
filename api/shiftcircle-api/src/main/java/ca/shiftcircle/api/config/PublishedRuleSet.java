package ca.shiftcircle.api.config;

import ca.shiftcircle.rules.RuleSetCompiler;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import org.kie.api.KieBase;
import org.springframework.stereotype.Component;

/**
 * The live rule base, held so a published version can replace it without a restart (docs/04 §6,
 * step 11).
 *
 * <p>The holder starts on rule set v1. {@link #publish(RuleSet)} compiles the new rows <em>first</em>
 * and swaps only if compilation succeeds, so a reader sees either the old base or the new one, never
 * a half-built state. Requests use the compiled {@link KieBase}; the same-row {@link RuleSet} is what
 * the ranking policy and the admin screens read.
 */
@Component
public class PublishedRuleSet {

  private final RuleSetCompiler compiler;
  private volatile RuleSet ruleSet;
  private volatile KieBase kieBase;

  public PublishedRuleSet(RuleSetCompiler compiler) {
    this.compiler = compiler;
    this.ruleSet = RuleRowsV1.ruleSet();
    this.kieBase = compiler.compile(ruleSet);
  }

  public KieBase kieBase() {
    return kieBase;
  }

  public RuleSet ruleSet() {
    return ruleSet;
  }

  /**
   * Compile and swap in one step. A compilation error leaves the live base untouched.
   *
   * @throws ca.shiftcircle.rules.RuleCompilationException when the rows do not compile
   */
  public synchronized void publish(RuleSet newRuleSet) {
    KieBase compiled = compiler.compile(newRuleSet);
    this.ruleSet = newRuleSet;
    this.kieBase = compiled;
  }
}
