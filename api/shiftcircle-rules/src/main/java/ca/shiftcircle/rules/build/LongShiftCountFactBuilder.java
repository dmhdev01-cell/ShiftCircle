package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.LongShiftCountFact;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Builds the 16-hour-shift count fact for U-11: the most 16-hour shifts in any rolling 7- and 28-day
 * window, counted from the start of each long shift.
 *
 * <p>The far edge is exclusive, so a shift exactly 7 days after the first one is not in the same
 * 7-day window (docs/10 §3, U-11 "4th exactly 7 d after the 1st → PASS").
 */
public final class LongShiftCountFactBuilder {

  public List<LongShiftCountFact> build(List<ShiftFact> shifts) {
    Map<String, List<ShiftFact>> byEmployee =
        shifts.stream()
            .collect(Collectors.groupingBy(ShiftFact::employeeId, Collectors.toList()));

    List<LongShiftCountFact> facts = new ArrayList<>();
    byEmployee
        .values()
        .forEach(
            employeeShifts -> {
              employeeShifts.sort(Comparator.comparing(ShiftFact::start));
              facts.add(maxFor(employeeShifts));
            });
    return facts;
  }

  private LongShiftCountFact maxFor(List<ShiftFact> sorted) {
    int best7 = 0;
    int best28 = 0;
    ShiftFact bestAnchor = null;

    for (ShiftFact anchor : sorted) {
      if (!anchor.isSixteenHour()) {
        continue;
      }
      int in7 = countWithin(sorted, anchor, 7);
      int in28 = countWithin(sorted, anchor, 28);
      if (in7 > best7 || in28 > best28) {
        best7 = Math.max(best7, in7);
        best28 = Math.max(best28, in28);
        bestAnchor = anchor;
      }
    }

    String evidence =
        bestAnchor == null
            ? "No 16-hour shifts"
            : String.format(
                "%d 16-hour shifts in 7 days and %d in 28 days up to %s",
                best7, best28, BusinessTime.evidence(bestAnchor.start()));
    return new LongShiftCountFact(best7, best28, evidence);
  }

  private int countWithin(List<ShiftFact> sorted, ShiftFact anchor, int days) {
    long windowSeconds = Duration.ofDays(days).toSeconds();
    int count = 0;
    for (ShiftFact shift : sorted) {
      if (!shift.isSixteenHour()) {
        continue;
      }
      long secondsBefore = Duration.between(shift.start(), anchor.start()).toSeconds();
      if (secondsBefore >= 0 && secondsBefore < windowSeconds) {
        count++;
      }
    }
    return count;
  }
}
