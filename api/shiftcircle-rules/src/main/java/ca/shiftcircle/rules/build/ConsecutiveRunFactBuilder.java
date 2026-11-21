package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.ConsecutiveRunFact;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Builds the consecutive-work facts (U-08 days, U-09 12-hour shifts, U-10 overnight 12-hour shifts).
 *
 * <p>Three facts per officer, one per counting mode the decision table offers. A run counts as
 * overtime-caused when the shift that extends it was picked up beyond the roster, because the rule
 * warns instead of blocking in that case (docs/05 §2.B).
 */
public final class ConsecutiveRunFactBuilder {

  public List<ConsecutiveRunFact> build(List<ShiftFact> shifts) {
    Map<String, List<ShiftFact>> byEmployee =
        shifts.stream()
            .collect(Collectors.groupingBy(ShiftFact::employeeId, Collectors.toList()));

    List<ConsecutiveRunFact> facts = new ArrayList<>();
    byEmployee
        .values()
        .forEach(
            employeeShifts -> {
              employeeShifts.sort(Comparator.comparing(ShiftFact::start));
              facts.add(daysRun(employeeShifts));
              facts.add(twelveHourRun(employeeShifts));
              facts.add(nightTwelveHourRun(employeeShifts));
            });
    return facts;
  }

  private ConsecutiveRunFact daysRun(List<ShiftFact> shifts) {
    Map<LocalDate, List<ShiftFact>> byDate = new LinkedHashMap<>();
    shifts.forEach(
        shift ->
            byDate
                .computeIfAbsent(shift.start().atZone(BusinessTime.REGINA).toLocalDate(),
                    date -> new ArrayList<>())
                .add(shift));

    int best = 0;
    int current = 0;
    LocalDate previous = null;
    LocalDate bestEnd = null;
    boolean bestOvertime = false;
    for (LocalDate date : byDate.keySet().stream().sorted().toList()) {
      current = previous != null && previous.plusDays(1).equals(date) ? current + 1 : 1;
      boolean overtimeToday =
          byDate.get(date).stream().anyMatch(shift -> shift.kind() == ShiftKind.EXTRA);
      // Equal-length runs are not equivalent: a scheduled run of the same length is the worse
      // finding, so it must win the tie (review F2).
      if (current > best
          || (current == best && bestOvertime && !overtimeToday)) {
        best = current;
        bestEnd = date;
        bestOvertime = overtimeToday;
      }
      previous = date;
    }

    boolean overtime = bestOvertime;
    String evidence =
        best <= 0
            ? "No shifts"
            : String.format(
                "%d consecutive work days, ending %s%s",
                best,
                bestEnd,
                overtime ? " picked up outside the roster" : "");
    List<String> ids =
        bestEnd == null
            ? List.of()
            : List.of(byDate.get(bestEnd).get(byDate.get(bestEnd).size() - 1).assignmentId());
    return new ConsecutiveRunFact("DAYS", best, overtime, evidence, ids);
  }

  private ConsecutiveRunFact twelveHourRun(List<ShiftFact> shifts) {
    return runOf(shifts, false);
  }

  private ConsecutiveRunFact nightTwelveHourRun(List<ShiftFact> shifts) {
    return runOf(shifts, true);
  }

  private ConsecutiveRunFact runOf(List<ShiftFact> shifts, boolean nightOnly) {
    int best = 0;
    int current = 0;
    LocalDate previousDate = null;
    ShiftFact bestLast = null;
    boolean bestOvertime = false;

    for (ShiftFact shift : shifts) {
      boolean matches =
          shift.isTwelveHour()
              && (!nightOnly
                  || "A12".equals(shift.templateCode())
                  || "N12".equals(shift.templateCode()));
      if (!matches) {
        current = 0;
        previousDate = null;
        continue;
      }

      LocalDate date = shift.start().atZone(BusinessTime.REGINA).toLocalDate();
      boolean nextDay = previousDate == null || previousDate.plusDays(1).equals(date);
      current = nextDay ? current + 1 : 1;
      previousDate = date;

      boolean overtimeHere = shift.kind() == ShiftKind.EXTRA;
      if (current > best || (current == best && bestOvertime && !overtimeHere)) {
        best = current;
        bestLast = shift;
        bestOvertime = overtimeHere;
      }
    }

    boolean overtime = bestOvertime;
    String mode = nightOnly ? "SHIFTS_NIGHT_12H" : "SHIFTS_12H";
    String evidence =
        best <= 0
            ? "No 12-hour shifts"
            : String.format(
                "%d consecutive %s12-hour shifts, ending %s%s",
                best,
                nightOnly ? "overnight " : "",
                bestLast.start().atZone(BusinessTime.REGINA).toLocalDate(),
                overtime ? " (picked up)" : "");
    return new ConsecutiveRunFact(
        mode,
        best,
        overtime,
        evidence,
        bestLast == null ? List.of() : List.of(bestLast.assignmentId()));
  }
}
