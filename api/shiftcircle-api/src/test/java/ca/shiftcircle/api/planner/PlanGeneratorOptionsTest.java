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
        generate(facility, new PlanGenerator.Options(false, false, false));
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
    PlanGenerator.Result upTo = generate(facility, new PlanGenerator.Options(true, true, false));
    Set<UUID> partTimers = partTimers(facility);

    double hoursAfter = partTimeHours(after, partTimers);
    double hoursUpTo = partTimeHours(upTo, partTimers);
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
                new PlanGenerator.Options(true, true, false));
    assertThat(upTo.assignments())
        .filteredOn(assignment -> partTimers.contains(assignment.employeeId()))
        .isNotEmpty()
        .noneMatch(assignment -> assignment.date().getDayOfWeek() == java.time.DayOfWeek.SUNDAY);
  }

  @Test
  void partTimeFillUpToFteIsDeterministic() {
    Facility facility = facility();
    PlanGenerator.Options upTo = new PlanGenerator.Options(true, true, false);
    PlanGenerator.Result first = generate(facility, upTo);
    PlanGenerator.Result second = generate(facility, upTo);
    assertThat(first.assignments().stream().map(a -> a.employeeId() + "|" + a.date() + "|" + a.templateCode()).toList())
        .isEqualTo(second.assignments().stream().map(a -> a.employeeId() + "|" + a.date() + "|" + a.templateCode()).toList());
    assertThat(first.gaps()).isEqualTo(second.gaps());
    assertThat(first.warnings()).isEqualTo(second.warnings());
    for (String card : List.of("coverage", "warnings", "preferences", "fteBands", "quarterHours")) {
      assertThat(first.scorecard().get(card)).as(card).isEqualTo(second.scorecard().get(card));
    }
  }

  @Test
  void partTimeFillUpToFteSpreadsShiftsEvenlyThroughThePeriod() {
    UUID unitId = UUID.nameUUIDFromBytes("unit:E".getBytes());
    List<PlanGenerator.Unit> units =
        List.of(new PlanGenerator.Unit(unitId, "E", "E", false, false, Map.of("DAY", 1, "EVENING", 1)));
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      employees.add(employee("E", unitId, "F" + i, 1.0, i, i));
    }
    PlanGenerator.Employee partTimer = employee("E", unitId, "P0", 0.8, 0, 20);
    employees.add(partTimer);
    Facility facility = new Facility(units, employees);
    // The gap fill places the part-timer unpaced; the top-up adds the rest, paced.
    Set<LocalDate> gapShifts =
        generate(facility, PlanGenerator.Options.DEFAULT).assignments().stream()
            .filter(a -> a.employeeId().equals(partTimer.id()))
            .map(PlanGenerator.Assignment::date)
            .collect(Collectors.toSet());

    PlanGenerator.Result upTo = generate(facility, new PlanGenerator.Options(true, true, false));
    double target = 0.8 * 80;
    double[] cumulative = new double[PlanGenerator.PERIODS];
    int added = 0;
    for (PlanGenerator.Assignment shift :
        upTo.assignments().stream()
            .filter(a -> a.employeeId().equals(partTimer.id()))
            .sorted(java.util.Comparator.comparing(PlanGenerator.Assignment::date))
            .toList()) {
      long day = ChronoUnit.DAYS.between(PlanGenerator.FROM, shift.date());
      int period = (int) (day / 14);
      long dayInPeriod = day % 14;
      if (!gapShifts.contains(shift.date())) {
        added++;
        // A top-up shift is placed only when the period's hours so far are not ahead of an even
        // pace: hours before it <= target x (day + 1) / 14.
        assertThat(cumulative[period])
            .as("%s, day %d of period %d", shift.date(), dayInPeriod, period)
            .isLessThanOrEqualTo(target * (dayInPeriod + 1) / 14.0 + 0.001);
      }
      cumulative[period] += 8;
    }
    assertThat(added).as("the top-up added shifts").isGreaterThan(20);
    for (double hours : cumulative) {
      assertThat(hours).isLessThanOrEqualTo(target);
    }
  }

  // --- cross-unit fill -------------------------------------------------------------------------

  private static final PlanGenerator.Options CROSS = new PlanGenerator.Options(true, false, true);

  @Test
  void crossUnitFillCoversAnotherUnitsGapsWithSpareOfficersAndOnlyAdds() {
    Facility facility = shortAndSpare();
    PlanGenerator.Result off = generate(facility, PlanGenerator.Options.DEFAULT);
    PlanGenerator.Result on = generate(facility, CROSS);
    UUID shortUnit = facility.units.get(1).id();

    assertThat(on.gaps().size()).isLessThan(off.gaps().size());
    assertThat(rows(on)).containsAll(rows(off));
    // Every added shift is in the short unit, by an officer homed in the spare unit.
    Map<UUID, UUID> home = new HashMap<>();
    facility.employees.forEach(e -> home.put(e.id(), e.unitId()));
    List<PlanGenerator.Assignment> away =
        on.assignments().stream()
            .filter(a -> !a.unitId().equals(home.get(a.employeeId())))
            .toList();
    assertThat(away).isNotEmpty().allMatch(a -> a.unitId().equals(shortUnit));
    assertThat(away.size()).isEqualTo(on.assignments().size() - off.assignments().size());

    @SuppressWarnings("unchecked")
    Map<String, Object> card = (Map<String, Object>) on.scorecard().get("crossUnit");
    assertThat(card.get("gapsCovered")).isEqualTo(off.gaps().size() - on.gaps().size());
    assertThat(card.get("shifts")).isEqualTo(away.size());
    assertThat((String) card.get("line")).contains("covered from other units");
    assertThat(off.scorecard()).doesNotContainKey("crossUnit");

    // FTE caps kept and one shift a day, for everyone.
    Map<UUID, Double> fte = new HashMap<>();
    facility.employees.forEach(e -> fte.put(e.id(), e.fte()));
    Map<String, Double> perPeriod = new HashMap<>();
    Map<String, Long> perDay = new HashMap<>();
    for (PlanGenerator.Assignment a : on.assignments()) {
      perDay.merge(a.employeeId() + "|" + a.date(), 1L, Long::sum);
      long period = ChronoUnit.DAYS.between(PlanGenerator.FROM, a.date()) / 14;
      perPeriod.merge(a.employeeId() + "|" + period,
          Duration.between(a.start(), a.end()).toMinutes() / 60.0, Double::sum);
    }
    assertThat(perDay.values()).allMatch(count -> count == 1);
    perPeriod.forEach(
        (key, hours) ->
            assertThat(hours).as(key)
                .isLessThanOrEqualTo(fte.get(UUID.fromString(key.split("\\|")[0])) * 80 + 0.001));
  }

  @Test
  void crossUnitFillOnlyOffersAQualifiedBlockToOfficersWhoHoldTheQualification() {
    Facility facility = shortAndSpare();
    UUID shortUnit = facility.units.get(1).id();
    UUID escort = UUID.nameUUIDFromBytes("q:ESCORT".getBytes());
    // The short unit's evenings need Escort; only spare part-timer S0 holds it.
    UUID holder = facility.employees.stream()
        .filter(e -> e.employeeNo().equals("S-P0")).findFirst().orElseThrow().id();
    PlanGenerator.Qualifications qualifications =
        new PlanGenerator.Qualifications(
            Map.of(shortUnit, Map.of("EVENING", escort)), Map.of(holder, Set.of(escort)));
    PlanGenerator.Result on =
        new PlanGenerator()
            .generate(facility.employees, facility.units, templates(), new HashMap<>(), null,
                20261001, ALLOW, Map.of(), PlanGenerator.ALWAYS, CROSS, qualifications);
    Map<UUID, UUID> home = new HashMap<>();
    facility.employees.forEach(e -> home.put(e.id(), e.unitId()));
    List<PlanGenerator.Assignment> awayEvenings =
        on.assignments().stream()
            .filter(a -> !a.unitId().equals(home.get(a.employeeId())))
            .filter(a -> "E8".equals(a.templateCode()))
            .toList();
    assertThat(awayEvenings).isNotEmpty().allMatch(a -> a.employeeId().equals(holder));
    // Day shifts there have no qualification, so other spare officers still help.
    assertThat(on.assignments().stream()
            .filter(a -> !a.unitId().equals(home.get(a.employeeId())))
            .filter(a -> "D8".equals(a.templateCode()))
            .map(PlanGenerator.Assignment::employeeId)
            .distinct()
            .count())
        .isGreaterThan(1);
  }

  @Test
  void crossUnitFillRespectsABlockingRuleAndIsDeterministic() {
    Facility facility = shortAndSpare();
    PlanGenerator.Verifier noAway =
        (employee, unit, template, instant, current) ->
            new PlanGenerator.Check(!employee.unitId().equals(unit.id()), List.of());
    PlanGenerator.Result blocked =
        new PlanGenerator()
            .generate(facility.employees, facility.units, templates(), new HashMap<>(), null,
                20261001, noAway, Map.of(), PlanGenerator.ALWAYS, CROSS);
    PlanGenerator.Result off =
        new PlanGenerator()
            .generate(facility.employees, facility.units, templates(), new HashMap<>(), null,
                20261001, noAway, Map.of(), PlanGenerator.ALWAYS, PlanGenerator.Options.DEFAULT);
    assertThat(rows(blocked)).isEqualTo(rows(off));
    @SuppressWarnings("unchecked")
    Map<String, Object> card = (Map<String, Object>) blocked.scorecard().get("crossUnit");
    assertThat(card.get("gapsCovered")).isEqualTo(0);

    // Same input, same plan, in the same order.
    PlanGenerator.Result first = generate(facility, CROSS);
    PlanGenerator.Result second = generate(facility, CROSS);
    assertThat(first.assignments().stream().map(a -> a.employeeId() + "|" + a.date() + "|" + a.unitId()).toList())
        .isEqualTo(second.assignments().stream().map(a -> a.employeeId() + "|" + a.date() + "|" + a.unitId()).toList());
  }

  @Test
  void crossUnitGapsComeBeforeTheUpToFteExtras() {
    Facility facility = shortAndSpare();
    PlanGenerator.Result cross = generate(facility, CROSS);
    PlanGenerator.Result both = generate(facility, new PlanGenerator.Options(true, true, true));
    // The extras run after the cross-unit fill, so they only add to it and never cost a gap.
    assertThat(rows(both)).containsAll(rows(cross));
    assertThat(both.gaps().size()).isLessThanOrEqualTo(cross.gaps().size());
    PlanGenerator.Result upToOnly = generate(facility, new PlanGenerator.Options(true, true, false));
    assertThat(both.gaps().size()).isLessThan(upToOnly.gaps().size());
  }

  /** Unit S (spare): 8 full-timers and 4 part-timers for a small need. Unit T (short): 3 full-timers. */
  private static Facility shortAndSpare() {
    UUID spare = UUID.nameUUIDFromBytes("unit:S".getBytes());
    UUID shortUnit = UUID.nameUUIDFromBytes("unit:T".getBytes());
    List<PlanGenerator.Unit> units =
        List.of(
            new PlanGenerator.Unit(spare, "S", "S", false, false, Map.of("DAY", 3, "EVENING", 2)),
            new PlanGenerator.Unit(shortUnit, "T", "T", false, false, Map.of("DAY", 3, "EVENING", 3)));
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      employees.add(employee("S", spare, "F" + i, 1.0, i, i));
    }
    for (int i = 0; i < 4; i++) {
      employees.add(employee("S", spare, "P" + i, 0.6, 0, 20 + i));
    }
    for (int i = 0; i < 3; i++) {
      employees.add(employee("T", shortUnit, "F" + i, 1.0, i, 10 + i));
    }
    return new Facility(units, employees);
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
