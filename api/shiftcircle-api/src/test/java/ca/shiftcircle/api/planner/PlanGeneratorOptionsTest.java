package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * PR-N tailoring options, one test per option, on a synthetic facility with a permissive verifier
 * (the API tests run the same options through the real rules engine).
 */
class PlanGeneratorOptionsTest {

  private static final PlanGenerator.Verifier ALLOW =
      (employee, unit, template, instant, current) -> new PlanGenerator.Check(false, List.of());

  @Test
  void theDefaultOptionsAreTheOldGeneratorExactly() {
    Facility facility = facility();
    PlanGenerator.Result old =
        new PlanGenerator()
            .generate(facility.employees, facility.units, templates(), new HashMap<>(), null,
                20261001, ALLOW, Map.of(), PlanGenerator.ALWAYS);
    PlanGenerator.Result withDefaults =
        new PlanGenerator()
            .generate(facility.employees, facility.units, templates(), new HashMap<>(), null,
                20261001, ALLOW, Map.of(), PlanGenerator.ALWAYS, PlanGenerator.Options.DEFAULT);
    assertThat(rows(withDefaults)).isEqualTo(rows(old));
    assertThat(withDefaults.gaps()).isEqualTo(old.gaps());
    assertThat(withDefaults.warnings()).isEqualTo(old.warnings());
    assertThat(withDefaults.scorecard().get("fteBands")).isEqualTo(old.scorecard().get("fteBands"));
    assertThat(withDefaults.scorecard().get("preferences"))
        .isEqualTo(old.scorecard().get("preferences"));
  }

  @Test
  void staffTypesWithoutPartTimePlacesNoPartTimerButStillCountsThem() {
    Facility facility = facility();
    PlanGenerator.Result all = generate(facility, PlanGenerator.Options.DEFAULT);
    PlanGenerator.Result fullTimeOnly =
        generate(facility, new PlanGenerator.Options(false, false));
    Set<UUID> partTimers = partTimers(facility);

    assertThat(fullTimeOnly.assignments())
        .noneMatch(assignment -> partTimers.contains(assignment.employeeId()));
    // The full-time plan is placed before the pool, so it is the same plan either way.
    assertThat(rows(fullTimeOnly))
        .isEqualTo(
            rows(all).stream().filter(row -> !partTimers.contains(row.employee())).toList());
    assertThat(fullTimeOnly.gaps().size()).isGreaterThan(all.gaps().size());
    // The scorecard still lists the part-time band, planned at zero hours: the unused capacity.
    Map<String, Object> band = band(fullTimeOnly, "0.7_TO_0.9");
    assertThat(band.get("plannedMax")).isEqualTo(0.0);
  }

  @Test
  void partTimeFillUpToFteUsesMorePartTimeHoursWithinTargetAndNoMoreGaps() {
    Facility facility = facility();
    PlanGenerator.Result after = generate(facility, PlanGenerator.Options.DEFAULT);
    PlanGenerator.Result upTo = generate(facility, new PlanGenerator.Options(true, true));
    Set<UUID> partTimers = partTimers(facility);

    double hoursAfter = partTimeHours(after, partTimers);
    double hoursUpTo = partTimeHours(upTo, partTimers);
    System.out.printf(
        "partTimeFill: AFTER_FULL_TIME %.0f h, %d gaps; UP_TO_FTE %.0f h, %d gaps%n",
        hoursAfter, after.gaps().size(), hoursUpTo, upTo.gaps().size());
    assertThat(hoursUpTo).isGreaterThan(hoursAfter);
    assertThat(upTo.gaps().size()).isLessThanOrEqualTo(after.gaps().size());
    // The top-up only adds: every shift of the default plan is still there.
    assertThat(rows(upTo)).containsAll(rows(after));

    Map<UUID, Double> fte = new HashMap<>();
    facility.employees.forEach(employee -> fte.put(employee.id(), employee.fte()));
    Map<String, Double> perPeriod = new HashMap<>();
    Map<String, Long> perDay = new HashMap<>();
    for (PlanGenerator.Assignment assignment : upTo.assignments()) {
      perDay.merge(assignment.employeeId() + "|" + assignment.date(), 1L, Long::sum);
      if (!partTimers.contains(assignment.employeeId())) {
        continue;
      }
      long period = ChronoUnit.DAYS.between(PlanGenerator.FROM, assignment.date()) / 14;
      perPeriod.merge(
          assignment.employeeId() + "|" + period,
          Duration.between(assignment.start(), assignment.end()).toMinutes() / 60.0,
          Double::sum);
    }
    perPeriod.forEach(
        (key, hours) ->
            assertThat(hours)
                .as("part-timer %s stays within FTE x 80 h", key)
                .isLessThanOrEqualTo(fte.get(UUID.fromString(key.split("\\|")[0])) * 80 + 0.001));
    assertThat(perDay.values()).as("one shift a day").allMatch(count -> count == 1);
  }

  @Test
  void partTimeFillUpToFteRespectsABlockingRule() {
    Facility facility = facility();
    Set<UUID> partTimers = partTimers(facility);
    // A rule that blocks every part-timer on Sundays: the top-up must never place one there.
    PlanGenerator.Verifier noSundays =
        (employee, unit, template, instant, current) ->
            new PlanGenerator.Check(
                partTimers.contains(employee.id())
                    && instant.atZone(java.time.ZoneId.of("America/Regina")).getDayOfWeek()
                        == java.time.DayOfWeek.SUNDAY,
                List.of());
    PlanGenerator.Result upTo =
        new PlanGenerator()
            .generate(facility.employees, facility.units, templates(), new HashMap<>(), null,
                20261001, noSundays, Map.of(), PlanGenerator.ALWAYS,
                new PlanGenerator.Options(true, true));
    assertThat(upTo.assignments())
        .filteredOn(assignment -> partTimers.contains(assignment.employeeId()))
        .isNotEmpty()
        .noneMatch(assignment -> assignment.date().getDayOfWeek() == java.time.DayOfWeek.SUNDAY);
  }

  // --- helpers ----------------------------------------------------------------------------------

  private record Row(UUID employee, LocalDate date, String template, UUID unit) {}

  private static List<Row> rows(PlanGenerator.Result result) {
    return result.assignments().stream()
        .map(a -> new Row(a.employeeId(), a.date(), a.templateCode(), a.unitId()))
        .sorted(
            java.util.Comparator.comparing(Row::date)
                .thenComparing(row -> row.employee().toString())
                .thenComparing(Row::template))
        .toList();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> band(PlanGenerator.Result result, String name) {
    Map<String, Object> card = (Map<String, Object>) result.scorecard().get("fteBands");
    return ((List<Map<String, Object>>) card.get("bands")).stream()
        .filter(row -> name.equals(row.get("band")))
        .findFirst()
        .orElseThrow();
  }

  private static double partTimeHours(PlanGenerator.Result result, Set<UUID> partTimers) {
    return result.assignments().stream()
        .filter(a -> partTimers.contains(a.employeeId()))
        .mapToDouble(a -> Duration.between(a.start(), a.end()).toMinutes() / 60.0)
        .sum();
  }

  private static Set<UUID> partTimers(Facility facility) {
    return facility.employees.stream()
        .filter(e -> e.fte() < 1.0)
        .map(PlanGenerator.Employee::id)
        .collect(Collectors.toSet());
  }

  private static PlanGenerator.Result generate(Facility facility, PlanGenerator.Options options) {
    return new PlanGenerator()
        .generate(facility.employees, facility.units, templates(), new HashMap<>(), null, 20261001,
            ALLOW, Map.of(), PlanGenerator.ALWAYS, options);
  }

  private record Facility(List<PlanGenerator.Unit> units, List<PlanGenerator.Employee> employees) {}

  /** Two units, 8 h full-timers a little short of the minimum, and 0.8 FTE part-timers. */
  private static Facility facility() {
    List<PlanGenerator.Unit> units = new ArrayList<>();
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    int index = 0;
    for (String code : List.of("A", "B")) {
      UUID unitId = UUID.nameUUIDFromBytes(("unit:" + code).getBytes());
      units.add(new PlanGenerator.Unit(unitId, code, code, false, false,
          Map.of("DAY", 4, "EVENING", 3)));
      for (int i = 0; i < 8; i++, index++) {
        employees.add(employee(code, unitId, "F" + i, 1.0, index, i));
      }
      for (int i = 0; i < 4; i++) {
        employees.add(employee(code, unitId, "C" + i, 0.8, 0, 20 + i));
      }
    }
    return new Facility(units, employees);
  }

  private static PlanGenerator.Employee employee(
      String unit, UUID unitId, String suffix, double fte, int phase, int years) {
    return new PlanGenerator.Employee(
        UUID.nameUUIDFromBytes((unit + suffix).getBytes()),
        unit + "-" + suffix,
        unit + " " + suffix,
        unitId,
        unit,
        LocalDate.of(2000, 1, 1).plusYears(years),
        fte,
        new PlanGenerator.Pref(8, List.of(), List.of()),
        8,
        Math.floorMod(phase, 7));
  }

  private static Map<String, PlanGenerator.Template> templates() {
    Map<String, PlanGenerator.Template> t = new LinkedHashMap<>();
    t.put("D8", t("D8", LocalTime.of(7, 0), 480));
    t.put("E8", t("E8", LocalTime.of(15, 0), 480));
    t.put("N8", t("N8", LocalTime.of(23, 0), 480));
    t.put("A12", t("A12", LocalTime.of(0, 0), 720));
    t.put("P12", t("P12", LocalTime.of(12, 0), 720));
    return t;
  }

  private static PlanGenerator.Template t(String code, LocalTime start, int minutes) {
    return new PlanGenerator.Template(UUID.nameUUIDFromBytes(code.getBytes()), code, start, minutes);
  }
}
