package ca.shiftcircle.api.config;

import ca.shiftcircle.api.rulesets.RuleRowsRepository;
import ca.shiftcircle.rules.RuleSetCompiler;
import ca.shiftcircle.rules.model.RuleSet;
import java.util.concurrent.atomic.AtomicReference;
import org.kie.api.KieBase;
import org.springframework.stereotype.Component;

/**
 * The live rule base, held so a published version can replace it without a restart (docs/04 §6,
 * step 11).
 *
 * <p>At boot the holder compiles the published rows from PostgreSQL (falling back to v1 only when
 * no version is published). The rows and the compiled {@link KieBase} are one immutable
 * {@link Snapshot} swapped by a single atomic write, so a request can never rank under one version
 * while its rules evaluate under another. {@link #publish(RuleSet)} compiles first and swaps only
 * if compilation succeeds.
 */
@Component
public class PublishedRuleSet {

  /** One consistent triple: the version label, the rows and the base compiled from exactly them. */
  public record Snapshot(int version, RuleSet ruleSet, KieBase kieBase) {}

  private final RuleSetCompiler compiler;
  private final AtomicReference<Snapshot> current = new AtomicReference<>();

  public PublishedRuleSet(RuleSetCompiler compiler, RuleRowsRepository rows) {
    this.compiler = compiler;
    RuleSet initial = rows.publishedRuleSet();
    this.current.set(
        new Snapshot(versionOf(initial.version()), initial, compiler.compile(initial)));
  }

  /** Read once per request: the label, the rows and the base are guaranteed to belong together. */
  public Snapshot snapshot() {
    return current.get();
  }

  /** The live version, taken from the same snapshot as the rows and the base. */
  public int version() {
    return current.get().version();
  }

  public KieBase kieBase() {
    return current.get().kieBase();
  }

  public RuleSet ruleSet() {
    return current.get().ruleSet();
  }

  /**
   * Compile and swap in one atomic step. A compilation error leaves the live snapshot untouched.
   *
   * @throws ca.shiftcircle.rules.RuleCompilationException when the rows do not compile
   */
  public synchronized void publish(RuleSet newRuleSet) {
    KieBase compiled = compiler.compile(newRuleSet);
    current.set(new Snapshot(versionOf(newRuleSet.version()), newRuleSet, compiled));
  }

  private static int versionOf(String label) {
    String digits = label != null && label.startsWith("v") ? label.substring(1) : label;
    try {
      return Integer.parseInt(digits);
    } catch (RuntimeException notAVersion) {
      return 1;
    }
  }
}
