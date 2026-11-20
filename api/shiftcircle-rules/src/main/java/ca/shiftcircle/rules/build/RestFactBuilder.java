package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.MinRestInWindowFact;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Builds the rest-between-shifts facts (rules U-01 to U-04) from a set of shifts.
 *
 * <p>One fact per gap between two consecutive shifts of the same officer. The shortest gap is what
 * the legal floor (8 h in any 24 h) and the agreement targets (12 h, 10 h after a long extension)
 * are compared against, so a single fact covers all four rows.
 */
public final class RestFactBuilder {

  public List<MinRestInWindowFact> build(List<ShiftFact> shifts) {
    Map<String, List<ShiftFact>> byEmployee =
        shifts.stream()
            .collect(Collectors.groupingBy(ShiftFact::employeeId, Collectors.toList()));

    List<MinRestInWindowFact> facts = new ArrayList<>();
    byEmployee
        .values()
        .forEach(
            employeeShifts -> {
              employeeShifts.sort(Comparator.comparing(ShiftFact::start));
              for (int i = 1; i < employeeShifts.size(); i++) {
                facts.add(gap(employeeShifts.get(i - 1), employeeShifts.get(i)));
              }
            });
    return facts;
  }

  private MinRestInWindowFact gap(ShiftFact previous, ShiftFact next) {
    double restHours = Duration.between(previous.end(), next.start()).toMinutes() / 60.0;
    String evidence =
        String.format(
            "%s (%s) ends %s, next shift %s starts %s (%.2f h rest)",
            previous.templateCode(),
            previous.assignmentId(),
            BusinessTime.evidence(previous.end()),
            next.assignmentId(),
            BusinessTime.evidence(next.start()),
            restHours);

    return new MinRestInWindowFact(
        previous.templateCode(), 24, restHours, previous.workedExtensionMinutes(), evidence);
  }
}
