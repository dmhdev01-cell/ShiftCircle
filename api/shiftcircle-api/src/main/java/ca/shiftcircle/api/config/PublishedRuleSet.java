package ca.shiftcircle.api.config;

import ca.shiftcircle.api.rulesets.RuleRowsRepository;
import ca.shiftcircle.rules.RuleSetCompiler;
import ca.shiftcircle.rules.model.RuleSet;
import org.kie.api.KieBase;
import org.springframework.stereotype.Component;

/**
 * The live rule base, held so a published version can replace it without a restart (docs/04 §6,
 * step 11).
 *
 * <p>At boot the holder compiles the published rows from PostgreSQL (falling back to v1 only when
 * no version is published). {@link #publish(RuleSet)} compiles the new rows <em>first</em> and swaps
 * only if compilation succeeds, so a reader sees either the old base or the new one, never a
 * half-built state.
 */
@Component
public class PublishedRuleSet {

  private final RuleSetCompiler compiler;
  private volatile RuleSet ruleSet;
  private volatile KieBase kieBase;

  public PublishedRuleSet(RuleSetCompiler compiler, RuleRowsRepository rows) {
    this.compiler = compiler;
    this.ruleSet = rows.publishedRuleSet();
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
