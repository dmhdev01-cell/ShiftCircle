package ca.shiftcircle.rules.scenario;

import ca.shiftcircle.rules.RuleEvaluator;
import ca.shiftcircle.rules.build.ConsecutiveRunFactBuilder;
import ca.shiftcircle.rules.build.DaysOffFactBuilder;
import ca.shiftcircle.rules.build.LongShiftCountFactBuilder;
import ca.shiftcircle.rules.build.RestFactBuilder;
import ca.shiftcircle.rules.build.RollingHoursFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import ca.shiftcircle.rules.build.ShiftLengthFactBuilder;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.rank.OvertimeRanker;
import ca.shiftcircle.rules.rank.RankingPolicy;
import ca.shiftcircle.rules.model.RuleSet;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * The named rule scenarios from docs/10 §4, as data the publish pipeline runs before a version can
 * go live (docs/04 §6 step 4).
 *
 * <p>These are the scenarios a rule-set version must still pass: T1 (a clean assignment), T2 (the
 * PC-01 double booking), T3 (exactly eight hours' rest), T4 (rest after a 16-hour shift), T5 (the
 * fifth overnight shift) and the O-02 ranking order. The DB and workflow scenarios (T8–T14) are
 * covered by their own tests; they are not facts a rule version can change.
 */
public final class RuleScenarioRunner {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  public record Expectation(String ruleCode, RuleOutcome outcome) {}

  public record Scenario(
      String id, String name, List<ShiftFact> shifts, List<Expectation> expected,
      boolean allowUnexpectedBlocks) {}

  public record Result(String id, String name, boolean passed, List<String> failures) {}

  public List<Result> run(org.kie.api.KieBase kieBase, String ruleSetVersion) {
    List<Result> results = new ArrayList<>();
    for (Scenario scenario : scenarios()) {
      results.add(runOne(kieBase, ruleSetVersion, scenario));
    }
    return results;
  }

  private Result runOne(
      org.kie.api.KieBase kieBase, String ruleSetVersion, Scenario scenario) {
    List<Object> facts = factsFor(scenario.shifts());
    List<RuleResult> outcome =
        new RuleEvaluator().evaluate(kieBase, ruleSetVersion, facts.toArray());

    List<String> failures = new ArrayList<>();
    for (Expectation expected : scenario.expected()) {
      boolean met =
          outcome.stream()
              .anyMatch(
                  result ->
                      result.ruleId().equals(expected.ruleCode())
                          && result.outcome() == expected.outcome());
      if (!met) {
        String actual =
            outcome.stream()
                .filter(result -> result.ruleId().equals(expected.ruleCode()))
                .map(result -> result.outcome().name())
                .findFirst()
                .orElse("no result");
        failures.add(
            expected.ruleCode() + " expected " + expected.outcome() + " but was " + actual);
      }
    }
    if (!scenario.allowUnexpectedBlocks()) {
      for (RuleResult result : outcome) {
        if (result.outcome() == RuleOutcome.BLOCK
            && scenario.expected().stream()
                .noneMatch(expected -> expected.ruleCode().equals(result.ruleId()))) {
          failures.add("unexpected BLOCK from " + result.ruleId() + ": " + result.message());
        }
      }
    }
    return new Result(scenario.id(), scenario.name(), failures.isEmpty(), failures);
  }

  private List<Object> factsFor(List<ShiftFact> shifts) {
    List<Object> facts = new ArrayList<>();
    facts.addAll(new RestFactBuilder().build(shifts));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 24));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    facts.addAll(new ConsecutiveRunFactBuilder().build(shifts));
    facts.addAll(new LongShiftCountFactBuilder().build(shifts));
    facts.addAll(new DaysOffFactBuilder().build(shifts));
    facts.addAll(new ShiftLengthFactBuilder().build(shifts));
    return facts;
  }

  /**
   * The O-02 order is Java, not a rule row's firing, so the build checks it separately: the policy
   * must still parse and the ranker must still put the fewest overtime hours first.
   */
  public List<Result> checkRanking(RuleSet ruleSet) {
    RankingPolicy policy = RankingPolicy.from(ruleSet);
    List<OvertimeRanker.Candidate> candidates =
        List.of(
            candidate("more", 12.0, LocalDate.of(2010, 1, 1)),
            candidate("fewest", 4.0, LocalDate.of(2016, 1, 1)),
            candidate("middle", 8.0, LocalDate.of(2014, 1, 1)));
    List<String> order =
        new OvertimeRanker().rank(candidates, policy).stream()
            .map(ranked -> ranked.candidate().employeeId())
            .toList();
    boolean passed = order.equals(List.of("fewest", "middle", "more"));
    return List.of(
        new Result(
            "T6",
            "Overtime candidates rank by fewest hours, then seniority",
            passed,
            passed ? List.of() : List.of("ranking order was " + order)));
  }

  private static OvertimeRanker.Candidate candidate(
      String id, double overtimeHours, LocalDate seniority) {
    return new OvertimeRanker.Candidate(
        id, id, List.of("FIRST_AID"), overtimeHours, seniority, null, null, null, List.of());
  }

  private static List<Scenario> scenarios() {
    return List.of(
        new Scenario(
            "T1",
            "A rested officer on a free day",
            List.of(shift("T1", "D8", "2026-11-24", "07:00", 480)),
            List.of(),
            false),
        new Scenario(
            "T2",
            "PC-01: a 12-hour afternoon then a day shift gives 7 hours' rest",
            List.of(
                shift("T2", "P12", "2026-11-20", "12:00", 720),
                shift("T2", "D8", "2026-11-21", "07:00", 480)),
            List.of(
                new Expectation("U-01", RuleOutcome.BLOCK),
                new Expectation("U-05", RuleOutcome.BLOCK)),
            true),
        new Scenario(
            "T3",
            "PC-02: a night ending 07:00 then an evening at 15:00 is exactly 8 hours",
            List.of(
                shift("T3", "N8", "2026-11-25", "23:00", 480),
                shift("T3", "E8", "2026-11-26", "15:00", 480)),
            List.of(new Expectation("U-02", RuleOutcome.WARN)),
            false),
        new Scenario(
            "T4",
            "A 16-hour shift then the same evening gives 8 hours: U-03 blocks",
            List.of(
                shift("T4", "L16", "2026-11-25", "20:00", 960),
                shift("T4", "E8", "2026-11-26", "20:00", 480)),
            List.of(new Expectation("U-03", RuleOutcome.BLOCK)),
            true),
        new Scenario(
            "T5",
            "A fifth consecutive overnight 12-hour shift warns",
            fiveNights(),
            List.of(new Expectation("U-10", RuleOutcome.WARN)),
            true));
  }

  private static List<ShiftFact> fiveNights() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int day = 0; day < 5; day++) {
      shifts.add(
          shift(
              "T5",
              "A12",
              LocalDate.of(2026, 11, 2).plusDays(day).toString(),
              "00:00",
              720));
    }
    return shifts;
  }

  private static ShiftFact shift(
      String employee, String template, String date, String time, int minutes) {
    Instant start = LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(REGINA).toInstant();
    return new ShiftFact(
        employee + "-" + date + "-" + time,
        employee,
        "A",
        template,
        start,
        start.plusSeconds(minutes * 60L),
        ShiftKind.ROSTERED,
        0,
        true,
        true);
  }
}
