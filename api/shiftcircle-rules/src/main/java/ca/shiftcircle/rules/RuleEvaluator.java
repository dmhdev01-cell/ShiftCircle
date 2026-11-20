package ca.shiftcircle.rules;

import ca.shiftcircle.rules.facts.RuleResult;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.kie.api.KieBase;
import org.kie.api.runtime.StatelessKieSession;

/**
 * Fires a rule base against a set of facts in a stateless session.
 *
 * <p>One session per check: stateless sessions are fast and thread-safe, and nothing carries over
 * between two schedule changes.
 */
public final class RuleEvaluator {

  /** Evaluates the facts and returns the rule results the templates produced. */
  public List<RuleResult> evaluate(KieBase kieBase, String ruleSetVersion, Object... facts) {
    StatelessKieSession session = kieBase.newStatelessKieSession();
    List<RuleResult> results = new ArrayList<>();
    session.setGlobal("ruleResults", results);
    session.setGlobal("ruleSetVersion", ruleSetVersion == null ? "unversioned" : ruleSetVersion);
    session.execute(Arrays.asList(facts));
    return results;
  }
}
