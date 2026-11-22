package ca.shiftcircle.infrastructure.demo;

import ca.shiftcircle.rules.build.BusinessTime;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the shift slots for the 90-day window and assigns officers.
 *
 * <p>Coverage is the primary goal: each unit gets its required block staffing first (8-hour shifts
 * on the block boundaries), then some day+evening pairs are swapped for 12-hour shifts. A swap never
 * reduces coverage: 00-12 plus 12-24 covers the same day and evening hours as an 8-hour day plus an
 * 8-hour evening shift, and adds night coverage. The 16-hour swap was retired in release 5 (#19):
 * a "16 h shift" is a 12 h shift plus an extension, not a template row.
 *
 * <p>Assignment is a fairness walk with the block rules pre-checked in Java (no overlap, eight hours
 * of rest, consecutive limits); the self-check then evaluates the saved roster against the real rule
 * set.
 */
final class RosterPlanner {

  record Shift(
      LocalDate date,
      String unitCode,
      String templateCode,
      Instant start,
      Instant end,
      String block,
      int sequence) {}

  record Assignment(Shift shift, String employeeNo) {}

  record Requirements(int day, int evening, int night) {}

  private static final Map<String, LocalTime> TEMPLATE_START =
      Map.of("D8", LocalTime.of(7, 0), "E8", LocalTime.of(15, 0), "N8", LocalTime.of(23, 0),
          "A12", LocalTime.of(0, 0), "P12", LocalTime.of(12, 0));

  private static final Map<String, Integer> TEMPLATE_MINUTES =
      Map.of("D8", 480, "E8", 480, "N8", 480, "A12", 720, "P12", 720);

  /** Slots for one unit and day, with the swap rules applied. */
  List<Shift> shiftsFor(LocalDate date, String unitCode, Requirements requirements,
      boolean allows12h) {
    int day = requirements.day();
    int evening = requirements.evening();
    int night = requirements.night();

    int a12 = 0;
    int p12 = 0;

    // Swap A: one day + one evening shift become a 00-12 and a 12-24 pair.
    if (allows12h && day >= 1 && evening >= 1) {
      a12++;
      p12++;
      day--;
      evening--;
    }
    List<Shift> shifts = new ArrayList<>();
    for (int i = 0; i < a12; i++) {
      shifts.add(shift(date, unitCode, "A12", "NIGHT", shifts.size()));
    }
    for (int i = 0; i < day; i++) {
      shifts.add(shift(date, unitCode, "D8", "DAY", shifts.size()));
    }
    for (int i = 0; i < evening; i++) {
      shifts.add(shift(date, unitCode, "E8", "EVENING", shifts.size()));
    }
    for (int i = 0; i < p12; i++) {
      shifts.add(shift(date, unitCode, "P12", "EVENING", shifts.size()));
    }
    for (int i = 0; i < night; i++) {
      shifts.add(shift(date, unitCode, "N8", "NIGHT", shifts.size()));
    }
    shifts.sort(Comparator.comparing(Shift::start).thenComparing(Shift::sequence));
    return shifts;
  }

  private Shift shift(LocalDate date, String unit, String template, String block, int sequence) {
    LocalTime startTime = TEMPLATE_START.get(template);
    Instant start = date.atTime(startTime).atZone(BusinessTime.REGINA).toInstant();
    Instant end = start.plusSeconds(TEMPLATE_MINUTES.get(template) * 60L);
    return new Shift(date, unit, template, start, end, block, sequence);
  }

  /**
   * Assigns officers to slots, most constrained first, preferring the officer with the fewest hours
   * so far. Slots that cannot be filled stay unassigned; the generator turns them into open shifts.
   */
  Map<Shift, String> assign(List<Shift> shifts, Map<String, List<String>> officersByUnit) {
    Map<String, List<Shift>> byEmployee = new LinkedHashMap<>();
    Map<Shift, String> assigned = new LinkedHashMap<>();

    List<Shift> ordered = new ArrayList<>(shifts);
    ordered.sort(Comparator.comparing(Shift::start).thenComparing(Shift::unitCode));

    for (Shift shift : ordered) {
      List<String> candidates = officersByUnit.getOrDefault(shift.unitCode(), List.of());
      String chosen =
          candidates.stream()
              .sorted(
                  Comparator.comparingDouble((String employee) -> hoursSoFar(byEmployee.get(employee)))
                      .thenComparing(employee -> employee))
              .filter(employee -> canWork(employee, shift, byEmployee.get(employee)))
              .findFirst()
              .orElse(null);

      if (chosen != null) {
        assigned.put(shift, chosen);
        byEmployee.computeIfAbsent(chosen, key -> new ArrayList<>()).add(shift);
      }
    }
    return assigned;
  }

  private static double hoursSoFar(List<Shift> shifts) {
    if (shifts == null) {
      return 0;
    }
    return shifts.stream()
        .mapToDouble(shift -> (shift.end().toEpochMilli() - shift.start().toEpochMilli()) / 3_600_000.0)
        .sum();
  }

  private boolean canWork(String employee, Shift shift, List<Shift> existing) {
    if (existing == null) {
      return true;
    }
    for (Shift other : existing) {
      // Eight hours is the legal floor. A 16 h worked shift (12 h + extension) needs twelve
      // (U-03), but the generator no longer creates 16 h slots; its extensions stay under U-05.
      long restBefore = 8 * 3600L;
      long restAfter = 8 * 3600L;
      boolean overlaps = shift.start().isBefore(other.end().plusSeconds(restBefore))
          && other.start().isBefore(shift.end().plusSeconds(restAfter));
      if (overlaps) {
        return false;
      }
    }

    boolean twelveHour = "A12".equals(shift.templateCode()) || "P12".equals(shift.templateCode());
    int maxRun = twelveHour ? 4 : 7;
    int run = 1;
    LocalDate cursor = shift.date().minusDays(1);
    while (hasShiftOn(existing, cursor) && run < maxRun + 1) {
      run++;
      cursor = cursor.minusDays(1);
    }
    return run <= maxRun;
  }

  private boolean hasShiftOn(List<Shift> shifts, LocalDate date) {
    return shifts.stream().anyMatch(other -> other.date().equals(date));
  }
}
