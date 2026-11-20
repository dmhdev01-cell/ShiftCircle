package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.DaysOffFact;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Builds the days-off fact for U-12: the longest break without a shift inside the rolling 7-day
 * window. Two consecutive days off is 48 hours, so 47 h 59 m fails the row.
 */
public final class DaysOffFactBuilder {

  private static final int WINDOW_DAYS = 7;

  public List<DaysOffFact> build(List<ShiftFact> shifts) {
    Map<String, List<ShiftFact>> byEmployee =
        shifts.stream()
            .collect(Collectors.groupingBy(ShiftFact::employeeId, Collectors.toList()));

    List<DaysOffFact> facts = new ArrayList<>();
    byEmployee
        .values()
        .forEach(
            employeeShifts -> {
              employeeShifts.sort(Comparator.comparing(ShiftFact::start));
              facts.add(longestBreak(employeeShifts));
            });
    return facts;
  }

  private DaysOffFact longestBreak(List<ShiftFact> sorted) {
    double best = 0;
    String evidence = "No break between shifts";

    for (int i = 1; i < sorted.size(); i++) {
      double gap = Duration.between(sorted.get(i - 1).end(), sorted.get(i).start()).toMinutes() / 60.0;
      if (gap > best) {
        best = gap;
        evidence =
            String.format(
                "Longest break %.2f h: %s to %s",
                gap,
                BusinessTime.evidence(sorted.get(i - 1).end()),
                BusinessTime.evidence(sorted.get(i).start()));
      }
    }
    return new DaysOffFact(WINDOW_DAYS, best, evidence);
  }
}
