package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.MaxHoursInWindowFact;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Builds the hours-in-a-window facts: U-05 (16 h in 24 h), U-14 (weekly ceiling) and U-15 (pay-period
 * overtime status).
 *
 * <p>The window slides: the binding number is the most hours the officer works in any window of that
 * length, which is what the rules limit. Time maths lives here, not in rule syntax.
 */
public final class RollingHoursFactBuilder {

  public List<MaxHoursInWindowFact> build(List<ShiftFact> shifts, int windowHours) {
    Map<String, List<ShiftFact>> byEmployee =
        shifts.stream()
            .collect(Collectors.groupingBy(ShiftFact::employeeId, Collectors.toList()));

    List<MaxHoursInWindowFact> facts = new ArrayList<>();
    byEmployee
        .values()
        .forEach(
            employeeShifts -> {
              employeeShifts.sort(Comparator.comparing(ShiftFact::start));
              facts.add(maxFor(employeeShifts, windowHours));
            });
    return facts;
  }

  private MaxHoursInWindowFact maxFor(List<ShiftFact> sorted, int windowHours) {
    double best = 0;
    Instant bestFrom = null;
    int bestContributors = 0;

    for (ShiftFact anchor : sorted) {
      Instant from = anchor.start();
      Instant to = from.plus(Duration.ofHours(windowHours));
      double hours = 0;
      int contributors = 0;

      for (ShiftFact shift : sorted) {
        Instant overlapStart = shift.start().isAfter(from) ? shift.start() : from;
        Instant overlapEnd = shift.end().isBefore(to) ? shift.end() : to;
        if (overlapEnd.isAfter(overlapStart)) {
          hours += Duration.between(overlapStart, overlapEnd).toMinutes() / 60.0;
          contributors++;
        }
      }

      if (hours > best) {
        best = hours;
        bestFrom = from;
        bestContributors = contributors;
      }
    }

    String evidence =
        String.format(
            "%.2f h in the %d h window from %s (%d shifts)",
            best, windowHours, BusinessTime.evidence(bestFrom), bestContributors);
    return new MaxHoursInWindowFact(windowHours, best, evidence);
  }
}
