package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.DaysOffFact;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Builds the days-off fact for U-12 the way the rule is written: <em>in each 7-day period</em>.
 *
 * <p>For every 7-day window ending on a day the officer works, the longest break is measured
 * including the leading and trailing breaks inside the window; the fact reports the worst window.
 * A long break in an earlier week therefore cannot satisfy the current week, and a single shift in a
 * window reports its real break, not zero.
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
              facts.add(worstWindow(employeeShifts));
            });
    return facts;
  }

  private DaysOffFact worstWindow(List<ShiftFact> sorted) {
    Set<LocalDate> anchors = new TreeSet<>();
    sorted.forEach(shift -> anchors.add(shift.start().atZone(BusinessTime.REGINA).toLocalDate()));

    double worstBreak = Double.MAX_VALUE;
    LocalDate worstAnchor = null;
    for (LocalDate anchor : anchors) {
      Instant windowStart =
          anchor.minusDays(WINDOW_DAYS - 1L).atStartOfDay(BusinessTime.REGINA).toInstant();
      Instant windowEnd =
          anchor.plusDays(1).atStartOfDay(BusinessTime.REGINA).toInstant();
      double longest = longestBreak(sorted, windowStart, windowEnd);
      if (longest < worstBreak) {
        worstBreak = longest;
        worstAnchor = anchor;
      }
    }

    if (worstAnchor == null) {
      return new DaysOffFact(WINDOW_DAYS, 0, 0, "No shifts in the window");
    }

    String evidence =
        String.format(
            "worst %d-day window ending %s: longest break %.2f h counts as %d days off",
            WINDOW_DAYS, worstAnchor, worstBreak, countedDaysOff(worstBreak));
    return new DaysOffFact(WINDOW_DAYS, worstBreak, countedDaysOff(worstBreak), evidence);
  }

  /** Longest gap without a shift inside the window, including the leading and trailing gaps. */
  private double longestBreak(List<ShiftFact> sorted, Instant windowStart, Instant windowEnd) {
    List<Instant[]> intervals = new ArrayList<>();
    for (ShiftFact shift : sorted) {
      Instant start = shift.start().isAfter(windowStart) ? shift.start() : windowStart;
      Instant end = shift.end().isBefore(windowEnd) ? shift.end() : windowEnd;
      if (end.isAfter(start)) {
        intervals.add(new Instant[] {start, end});
      }
    }
    intervals.sort(Comparator.comparing(interval -> interval[0]));

    double longest = 0;
    Instant cursor = windowStart;
    for (Instant[] interval : intervals) {
      if (interval[0].isAfter(cursor)) {
        longest = Math.max(longest, Duration.between(cursor, interval[0]).toMinutes() / 60.0);
      }
      if (interval[1].isAfter(cursor)) {
        cursor = interval[1];
      }
    }
    if (windowEnd.isAfter(cursor)) {
      longest = Math.max(longest, Duration.between(cursor, windowEnd).toMinutes() / 60.0);
    }
    return longest;
  }

  /** A break of 24 hours or less counts as no day off; 48 hours counts as two. */
  public static int countedDaysOff(double breakHours) {
    if (breakHours <= 24) {
      return 0;
    }
    return (int) (breakHours / 24);
  }
}
