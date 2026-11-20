package ca.shiftcircle.rules;

import ca.shiftcircle.rules.build.BusinessTime;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.kie.api.KieBase;

/**
 * Test support: build shifts by local date and time, compile v1 once, and evaluate facts.
 *
 * <p>Times are America/Regina local times, as the matrix in docs/10-testing.md writes them.
 */
public final class RuleTestSupport {

  private static KieBase v1;

  private RuleTestSupport() {}

  public static synchronized KieBase v1RuleBase() {
    if (v1 == null) {
      v1 = new RuleSetCompiler().compile(RuleRowsV1.ruleSet());
    }
    return v1;
  }

  public static List<RuleResult> evaluate(Object... facts) {
    return new RuleEvaluator().evaluate(v1RuleBase(), RuleRowsV1.VERSION, facts);
  }

  public static List<RuleResult> resultsFor(String ruleCode, Object... facts) {
    return evaluate(facts).stream().filter(result -> result.ruleId().equals(ruleCode)).toList();
  }

  /** A shift starting at {@code date} {@code time} and running {@code minutes}. */
  public static ShiftFact shift(
      String employee, String templateCode, String date, String time, int minutes) {
    return shift(employee, templateCode, date, time, minutes, ShiftKind.ROSTERED, 0, true, true);
  }

  public static ShiftFact shift(
      String employee,
      String templateCode,
      String date,
      String time,
      int minutes,
      ShiftKind kind,
      int extensionMinutes,
      boolean unitAllows12h,
      boolean unitAllows16h) {
    Instant start = BusinessTime.at(date, time);
    return new ShiftFact(
        employee + "-" + date + "-" + time,
        employee,
        "A",
        templateCode,
        start,
        start.plusSeconds(minutes * 60L),
        kind,
        extensionMinutes,
        unitAllows12h,
        unitAllows16h);
  }

  /** A roster of shifts for one officer, as the fact builders expect. */
  public static List<ShiftFact> schedule(ShiftFact... shifts) {
    return new ArrayList<>(List.of(shifts));
  }
}
