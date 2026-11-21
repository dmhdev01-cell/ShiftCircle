package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Option C: rotating, fixed and 7/3 officers are planned side by side from their own pattern. */
class PlanGeneratorPatternTest {

  private static final UUID UNIT_ID = UUID.nameUUIDFromBytes("unit:A".getBytes());

  @Test
  void mixedCohortsKeepTheirOwnCycleAndAreDeterministic() {
    List<PlanGenerator.Employee> employees = employees();
    PlanGenerator.Result first = generate(employees, null, (employee, unit, template, start, facts) ->
        new PlanGenerator.Check(false, List.of()));
    PlanGenerator.Result second = generate(employees, null, (employee, unit, template, start, facts) ->
        new PlanGenerator.Check(false, List.of()));

    assertThat(fingerprint(second)).isEqualTo(fingerprint(first));
    Map<UUID, Set<LocalDate>> worked = worked(first);
    for (PlanGenerator.Employee employee : employees) {
      Set<LocalDate> days = worked.getOrDefault(employee.id(), Set.of());
      assertThat(days).as("%s is planned", employee.employeeNo()).isNotEmpty();
      if ("ROTATING_5_2".equals(employee.pattern())) {
        // The weekend pair moves earlier every 14-day period; the wrap period takes a 3-day
        // break, so a period holds 9 or 10 work days and no run reaches seven.
        for (LocalDate start = PlanGenerator.FROM;
            start.plusDays(13).isBefore(PlanGenerator.TO);
            start = start.plusDays(14)) {
          int periodDays = 0;
          for (int offset = 0; offset < 14; offset++) {
            if (days.contains(start.plusDays(offset))) {
              periodDays++;
            }
          }
          assertThat(periodDays)
              .as("%s works 9 or 10 days in the period starting %s", employee.employeeNo(), start)
              .isBetween(9, 10);
        }
        continue;
      }
      int step = "5_ON_2_OFF".equals(employee.pattern()) ? 7 : 10;
      for (LocalDate date = PlanGenerator.FROM;
          !date.plusDays(step).isAfter(PlanGenerator.TO);
          date = date.plusDays(1)) {
        assertThat(days.contains(date.plusDays(step)))
            .as("%s keeps its %s cycle on %s", employee.employeeNo(), employee.pattern(), date)
            .isEqualTo(days.contains(date));
      }
    }

    // A fixed 5/2 officer's two days off are the same weekdays every week, inside the cohort.
    PlanGenerator.Employee fixed =
        employees.stream().filter(e -> "5_ON_2_OFF".equals(e.pattern())).findFirst().orElseThrow();
    List<java.time.DayOfWeek> offInFirstWeek = new ArrayList<>();
    List<java.time.DayOfWeek> offInSecondWeek = new ArrayList<>();
    for (LocalDate date = LocalDate.of(2027, 1, 11); date.isBefore(LocalDate.of(2027, 1, 18));
        date = date.plusDays(1)) {
      if (!worked.getOrDefault(fixed.id(), Set.of()).contains(date)) {
        offInFirstWeek.add(date.getDayOfWeek());
      }
    }
    for (LocalDate date = LocalDate.of(2027, 1, 18); date.isBefore(LocalDate.of(2027, 1, 25));
        date = date.plusDays(1)) {
      if (!worked.getOrDefault(fixed.id(), Set.of()).contains(date)) {
        offInSecondWeek.add(date.getDayOfWeek());
      }
    }
    assertThat(offInFirstWeek).hasSize(2);
    assertThat(offInSecondWeek).isEqualTo(offInFirstWeek);

    // The rotating cohort's off pair moves between periods, which is how weekends rotate.
    PlanGenerator.Employee rotating =
        employees.stream().filter(e -> "ROTATING_5_2".equals(e.pattern())).findFirst().orElseThrow();
    Set<java.time.DayOfWeek> firstOff = new LinkedHashSet<>();
    Set<java.time.DayOfWeek> secondOff = new LinkedHashSet<>();
    for (int offset = 0; offset < 14; offset++) {
      LocalDate date = PlanGenerator.FROM.plusDays(offset);
      if (!worked.getOrDefault(rotating.id(), Set.of()).contains(date)) {
        firstOff.add(date.getDayOfWeek());
      }
      LocalDate later = date.plusDays(14);
      if (!worked.getOrDefault(rotating.id(), Set.of()).contains(later)) {
        secondOff.add(later.getDayOfWeek());
      }
    }
    assertThat(secondOff)
        .as("the rotating off pair moves between periods")
        .isNotEqualTo(firstOff);

    // The scorecard names every officer's pattern in words, never a raw code.
    Map<String, Object> patterns = (Map<String, Object>) first.scorecard().get("patterns");
    List<Map<String, Object>> rows = (List<Map<String, Object>>) patterns.get("officers");
    assertThat(rows).hasSize(employees.size());
    assertThat(rows).allSatisfy(row -> assertThat(row.get("words")).isNotEqualTo(row.get("pattern")));
    assertThat(rows)
        .filteredOn(row -> "4_ON_4_OFF".equals(row.get("pattern")))
        .isEmpty();
  }

  @Test
  void theLegacyOverrideStillWinsForOneRelease() {
    List<PlanGenerator.Employee> employees =
        employees().stream()
            .map(
                employee ->
                    new PlanGenerator.Employee(
                        employee.id(),
                        employee.employeeNo(),
                        employee.name(),
                        employee.unitId(),
                        employee.unitCode(),
                        employee.seniority(),
                        employee.fte(),
                        employee.pref(),
                        employee.effectiveLength(),
                        employee.phase(),
                        employee.crew(),
                        null))
            .toList();
    PlanGenerator.Result result = generate(employees, "7_ON_3_OFF",
        (employee, unit, template, start, facts) -> new PlanGenerator.Check(false, List.of()));
    Map<UUID, Set<LocalDate>> worked = worked(result);
    for (PlanGenerator.Employee employee : employees) {
      Set<LocalDate> days = worked.getOrDefault(employee.id(), Set.of());
      for (LocalDate date = PlanGenerator.FROM;
          !date.plusDays(10).isAfter(PlanGenerator.TO);
          date = date.plusDays(1)) {
        assertThat(days.contains(date.plusDays(10)))
            .as("%s follows the override on %s", employee.employeeNo(), date)
            .isEqualTo(days.contains(date));
      }
    }
  }

  @Test
  void aBlockedProposalIsSkippedWithoutChangingThePatternOfOthers() {
    List<PlanGenerator.Employee> employees = employees();
    PlanGenerator.Employee blocked =
        employees.stream().filter(e -> "5_ON_2_OFF".equals(e.pattern())).findFirst().orElseThrow();
    PlanGenerator.Result baseline =
        generate(employees, null, (employee, unit, template, start, facts) ->
            new PlanGenerator.Check(false, List.of()));
    LocalDate blockedDate =
        baseline.assignments().stream()
            .filter(assignment -> assignment.employeeId().equals(blocked.id()))
            .map(PlanGenerator.Assignment::date)
            .filter(date -> date.isAfter(PlanGenerator.FROM.plusDays(9)))
            .findFirst()
            .orElseThrow(() -> new AssertionError("the fixed officer works that week"));

    PlanGenerator.Result result =
        generate(
            employees,
            null,
            (employee, unit, template, start, facts) ->
                employee.id().equals(blocked.id())
                        && start.atZone(java.time.ZoneId.of("America/Regina")).toLocalDate()
                            .equals(blockedDate)
                    ? new PlanGenerator.Check(true, List.of())
                    : new PlanGenerator.Check(false, List.of()));

    assertThat(result.assignments())
        .filteredOn(assignment -> assignment.employeeId().equals(blocked.id()))
        .noneMatch(assignment -> assignment.date().equals(blockedDate));
    assertThat(result.assignments())
        .filteredOn(assignment -> assignment.date().equals(blockedDate))
        .as("the block skips one proposal, not the day")
        .isNotEmpty();
  }

  private static List<PlanGenerator.Employee> employees() {
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    String[] patterns = {
      "ROTATING_5_2", "ROTATING_5_2", "ROTATING_5_2", "ROTATING_5_2", "ROTATING_5_2",
      "ROTATING_5_2", "5_ON_2_OFF", "5_ON_2_OFF", "5_ON_2_OFF", "7_ON_3_OFF", "7_ON_3_OFF",
      "7_ON_3_OFF"
    };
    for (int index = 0; index < patterns.length; index++) {
      String suffix = String.format("%02d", index);
      employees.add(
          new PlanGenerator.Employee(
              UUID.nameUUIDFromBytes(("pattern:" + suffix).getBytes()),
              "P-" + suffix,
              "Officer " + suffix,
              UNIT_ID,
              "A",
              LocalDate.of(2010, 1, 1).plusDays(index * 97L),
              1.0,
              new PlanGenerator.Pref(8, List.of(index % 2 == 0 ? "DAY" : "EVENING"), List.of()),
              8,
              0,
              null,
              patterns[index]));
    }
    return employees;
  }

  private static PlanGenerator.Result generate(
      List<PlanGenerator.Employee> employees,
      String override,
      PlanGenerator.Verifier verifier) {
    PlanGenerator.Unit unit =
        new PlanGenerator.Unit(
            UNIT_ID, "A", "Unit A", false, false, Map.of("DAY", 3, "EVENING", 1));
    return new PlanGenerator()
        .generate(
            employees, List.of(unit), templates(), new HashMap<>(), override, 20261001, verifier);
  }

  private static Map<UUID, Set<LocalDate>> worked(PlanGenerator.Result result) {
    Map<UUID, Set<LocalDate>> worked = new LinkedHashMap<>();
    for (PlanGenerator.Assignment assignment : result.assignments()) {
      worked
          .computeIfAbsent(assignment.employeeId(), key -> new LinkedHashSet<>())
          .add(assignment.date());
    }
    return worked;
  }

  private static List<String> fingerprint(PlanGenerator.Result result) {
    return result.assignments().stream()
        .map(
            assignment ->
                assignment.employeeId()
                    + "|"
                    + assignment.date()
                    + "|"
                    + assignment.templateCode())
        .sorted()
        .toList();
  }

  private static Map<String, PlanGenerator.Template> templates() {
    Map<String, PlanGenerator.Template> templates = new LinkedHashMap<>();
    templates.put("D8", new PlanGenerator.Template(UUID.randomUUID(), "D8", LocalTime.of(7, 0), 480));
    templates.put("E8", new PlanGenerator.Template(UUID.randomUUID(), "E8", LocalTime.of(15, 0), 480));
    return templates;
  }
}
