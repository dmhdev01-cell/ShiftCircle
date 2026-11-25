package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.domain.Position;
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
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Release v1.3 S3: the rank-aware planner, on a synthetic centre with two supervisor posts and ten
 * supervisors beside two officer units. The planner never cross-covers in any pass (the home-unit
 * fill, the casual pool, closed-unit relief, the cross-unit fill and the part-time top-up), the
 * officers' plan and their scorecard cards are exactly what they are without supervisors, and the
 * supervisor card counts the posts.
 */
class PlanGeneratorSupervisorTest {

  private static final UUID UNIT_A = UUID.nameUUIDFromBytes("unit:A".getBytes());
  private static final UUID UNIT_B = UUID.nameUUIDFromBytes("unit:B".getBytes());
  private static final UUID SUP_L = UUID.nameUUIDFromBytes("unit:SUP-L".getBytes());
  private static final UUID SUP_O = UUID.nameUUIDFromBytes("unit:SUP-O".getBytes());

  /** Every option on, so every pass that could offer someone another unit runs. */
  private static final PlanGenerator.Options ALL = new PlanGenerator.Options(true, true, true);

  /** Unit A closed the second week, SUP-L closed the third: both relief pools have people. */
  private static final PlanGenerator.Availability CLOSURES =
      (unitId, date) -> {
        long day = ChronoUnit.DAYS.between(PlanGenerator.FROM, date);
        if (unitId.equals(UNIT_A)) {
          return day < 7 || day >= 14;
        }
        if (unitId.equals(SUP_L)) {
          return day < 14 || day >= 21;
        }
        return true;
      };

  @Test
  void noPassEverOffersSomeoneAPostOfTheOtherRank() {
    Centre centre = centre(true);
    for (PlanGenerator.Options options : List.of(PlanGenerator.Options.DEFAULT, ALL)) {
      // A verifier that allows everything: only the rank guard can keep the ranks apart, and the
      // verifier must never even be asked about a cross-rank proposal.
      AtomicInteger crossRankChecks = new AtomicInteger();
      PlanGenerator.Verifier allow =
          (employee, unit, template, start, current) -> {
            if (employee.isSupervisor() != unit.isSupervision()) {
              crossRankChecks.incrementAndGet();
            }
            return new PlanGenerator.Check(false, List.of());
          };
      PlanGenerator.Result result = generate(centre, allow, options);

      assertThat(crossRankChecks.get()).as("cross-rank proposals with %s", options).isZero();
      Map<UUID, PlanGenerator.Employee> byId = byId(centre);
      assertThat(result.assignments())
          .isNotEmpty()
          .allSatisfy(
              assignment -> {
                PlanGenerator.Employee person = byId.get(assignment.employeeId());
                boolean post = assignment.unitId().equals(SUP_L) || assignment.unitId().equals(SUP_O);
                assertThat(person.isSupervisor())
                    .as("%s on %s", person.name(), assignment.unitCode())
                    .isEqualTo(post);
              });
      // The posts are covered: SUP-L has its crews, so it is never short while it is open.
      assertThat(result.gaps()).noneMatch(gap -> gap.unitId().equals(SUP_L));
      assertThat(result.assignments()).anyMatch(a -> a.unitId().equals(SUP_L));
      assertThat(result.assignments()).anyMatch(a -> a.unitId().equals(SUP_O));
      // The fixture really tempts every pool: SUP-O and the officer units stay short.
      assertThat(result.gaps()).anyMatch(gap -> gap.unitId().equals(SUP_O));
      assertThat(result.gaps()).anyMatch(gap -> gap.unitId().equals(UNIT_B));
    }
  }

  @Test
  void ruleR01AndR02NeverFireOnGeneratedRows() {
    Centre centre = centre(true);
    // The planner's R-01/R-02 as the engine words them: an officer on a supervisor post is a
    // Block, a supervisor on an officer post a warning.
    PlanGenerator.Verifier posts =
        (employee, unit, template, start, current) -> {
          if (!employee.isSupervisor() && unit.isSupervision()) {
            return new PlanGenerator.Check(true, List.of());
          }
          if (employee.isSupervisor() && !unit.isSupervision()) {
            return new PlanGenerator.Check(
                false, List.of(new PlanGenerator.RuleWarning("R-02", "Supervisor on an officer post")));
          }
          return new PlanGenerator.Check(false, List.of());
        };
    for (PlanGenerator.Options options : List.of(PlanGenerator.Options.DEFAULT, ALL)) {
      PlanGenerator.Result result = generate(centre, posts, options);
      assertThat(result.warnings()).noneMatch(w -> w.ruleCode().startsWith("R-0"));
      assertThat(result.assignments())
          .allSatisfy(a -> assertThat(a.warnings()).noneMatch(w -> w.ruleCode().startsWith("R-0")));
    }
  }

  @Test
  void theOfficersPlanAndTheirCardsDoNotChangeWhenSupervisorsAreAdded() {
    Centre with = centre(true);
    Centre without = centre(false);
    Set<UUID> officerIds =
        without.employees.stream().map(PlanGenerator.Employee::id).collect(Collectors.toSet());
    for (PlanGenerator.Options options : List.of(PlanGenerator.Options.DEFAULT, ALL)) {
      PlanGenerator.Result withSupervisors = generate(with, ALLOW, options);
      PlanGenerator.Result officersOnly = generate(without, ALLOW, options);

      assertThat(rows(withSupervisors, officerIds)).isEqualTo(rows(officersOnly, officerIds));
      assertThat(
              withSupervisors.gaps().stream()
                  .filter(gap -> !gap.unitId().equals(SUP_L) && !gap.unitId().equals(SUP_O))
                  .toList())
          .isEqualTo(officersOnly.gaps());
      for (String card :
          List.of(
              "coverage", "warnings", "preferences", "nights", "overtime", "weekends", "fteBands",
              "quarterHours", "patterns", "absences")) {
        assertThat(withSupervisors.scorecard().get(card))
            .as("%s card with %s", card, options)
            .isEqualTo(officersOnly.scorecard().get(card));
      }
      assertThat(officersOnly.scorecard()).doesNotContainKey("supervisors");
    }
  }

  @Test
  @SuppressWarnings("unchecked")
  void theSupervisorCardAndTheTotalsAreExact() {
    Centre centre = centre(true);
    PlanGenerator.Result result = generate(centre, ALLOW, PlanGenerator.Options.DEFAULT);
    Map<String, Object> card = (Map<String, Object>) result.scorecard().get("supervisors");

    assertThat(card.get("supervisors")).isEqualTo(10);
    assertThat(card.get("posts")).isEqualTo(2);
    // 98 days x 2 posts, less the 7 days SUP-L is closed, x 3 blocks.
    long days = ChronoUnit.DAYS.between(PlanGenerator.FROM, PlanGenerator.TO) + 1;
    assertThat(days).isEqualTo(98);
    long total = (days * 2 - 7) * 3;
    assertThat(total).isEqualTo(567);
    long short_ =
        result.gaps().stream()
            .filter(gap -> gap.unitId().equals(SUP_L) || gap.unitId().equals(SUP_O))
            .count();
    long postShifts =
        result.assignments().stream()
            .filter(a -> a.unitId().equals(SUP_L) || a.unitId().equals(SUP_O))
            .count();
    Map<String, Object> coverage = (Map<String, Object>) card.get("coverage");
    assertThat(coverage)
        .containsEntry("totalBlockDays", total)
        .containsEntry("shortBlockDays", (int) short_)
        .containsEntry("coveredBlockDays", total - short_);
    assertThat(card.get("shifts")).isEqualTo((int) postShifts);
    assertThat(card.get("line"))
        .isEqualTo(
            "Supervisor posts covered " + (total - short_) + " of " + total + " block-days; "
                + short_ + " short.");
    assertThat((List<Object>) ((Map<String, Object>) card.get("fteBands")).get("bands"))
        .hasSize(2); // full-time and the 0.6 casual
    assertThat(((Map<String, Object>) card.get("warnings")).get("total")).isEqualTo(0);

    // The officer coverage card counts the officer units only.
    Map<String, Object> officerCoverage = (Map<String, Object>) result.scorecard().get("coverage");
    assertThat(officerCoverage.get("totalBlockDays")).isEqualTo((days * 2 - 7) * 3);
    assertThat(officerCoverage.get("shortBlockDays"))
        .isEqualTo(result.gaps().size() - (int) short_);

    Map<String, Object> totals = (Map<String, Object>) result.scorecard().get("totals");
    int all = result.assignments().size();
    assertThat(totals)
        .containsEntry("shifts", all)
        .containsEntry("supervisorShifts", (int) postShifts)
        .containsEntry("officerShifts", all - (int) postShifts)
        .containsEntry("warnings", 0);
    assertThat(totals.get("supervisors")).isEqualTo(10);
    assertThat(totals.get("line"))
        .isEqualTo(
            PlanGenerator.shiftsLine(all - (int) postShifts, (int) postShifts));
    assertThat(PlanGenerator.shiftsLine(5103, 1170))
        .isEqualTo("5,103 officer + 1,170 supervisor shifts");
    assertThat(PlanGenerator.shiftsLine(5103, 0)).isEqualTo("5,103 officer shifts");
  }

  @Test
  void aSupervisorHomedOnAnOfficerUnitIsNeverPlacedThere() {
    Centre centre = centre(true);
    List<PlanGenerator.Employee> employees = new ArrayList<>(centre.employees);
    // A data slip: a full-time and a part-time supervisor with an officer unit as home. The home
    // fill, the casual pool and the top-up only ever look at the home unit, so the guard is what
    // keeps them off it.
    PlanGenerator.Employee fullTime =
        person("A", UNIT_A, "XS1", 1.0, "D12_DAY_4ON4OFF", 12, Position.CS, 2001, 2024);
    PlanGenerator.Employee partTime =
        person("A", UNIT_A, "XS2", 0.6, "CASUAL_12", 12, Position.CS, 2002, 2024);
    employees.add(fullTime);
    employees.add(partTime);
    PlanGenerator.Result result =
        generate(new Centre(centre.units, employees), ALLOW, ALL);
    assertThat(result.assignments())
        .filteredOn(
            a -> a.employeeId().equals(fullTime.id()) || a.employeeId().equals(partTime.id()))
        .allSatisfy(a -> assertThat(a.unitId()).isIn(SUP_L, SUP_O));
  }

  @Test
  void seniorityInsideTheRankOrdersTheFillPools() {
    // Same hours, so the cross-unit order falls to seniority: newest first. X joined in 2000 but
    // was promoted in 2025, Y joined in 2010 and was promoted in 2015: X is the newer supervisor.
    PlanGenerator.Employee x =
        person("SUP-L", SUP_L, "X", 1.0, null, 8, Position.CS, 2000, 2025);
    PlanGenerator.Employee y =
        person("SUP-L", SUP_L, "Y", 1.0, null, 8, Position.CS, 2010, 2015);
    Map<UUID, double[]> hours = new HashMap<>();
    hours.put(x.id(), new double[PlanGenerator.PERIODS]);
    hours.put(y.id(), new double[PlanGenerator.PERIODS]);
    List<PlanGenerator.Employee> order = new ArrayList<>(List.of(y, x));
    order.sort(PlanGenerator.crossUnitOrder(hours, 0));
    assertThat(order).containsExactly(x, y);

    // An officer's rank seniority is the service date, so every officer ordering is unchanged.
    PlanGenerator.Employee officer =
        person("A", UNIT_A, "O", 1.0, null, 8, Position.CO, 2005, 0);
    assertThat(officer.rankSeniority()).isEqualTo(officer.seniority());
  }

  // ---- fixture ---------------------------------------------------------------------------------

  private static final PlanGenerator.Verifier ALLOW =
      (employee, unit, template, start, current) -> new PlanGenerator.Check(false, List.of());

  private record Centre(List<PlanGenerator.Unit> units, List<PlanGenerator.Employee> employees) {}

  /**
   * Two officer units (12 h crews, one short at night so gaps tempt every pool, plus a 0.6 casual
   * each) and, with supervisors, two posts at 1/1/1: SUP-L with 2 N12 + 3 D12 + 1 D8 supervisors,
   * SUP-O with 2 N12 + 1 D12 (so its days are short) + a 0.6 casual: ten supervisors.
   */
  private static Centre centre(boolean supervisors) {
    List<PlanGenerator.Unit> units = new ArrayList<>();
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    int year = 2000;
    for (UUID unitId : List.of(UNIT_A, UNIT_B)) {
      String code = unitId.equals(UNIT_A) ? "A" : "B";
      units.add(
          new PlanGenerator.Unit(
              unitId, code, "Unit " + code, true, false,
              Map.of("DAY", 2, "EVENING", 2, "NIGHT", 3)));
      for (int i = 0; i < 4; i++) {
        employees.add(person(code, unitId, "N" + i, 1.0, "N12_NIGHT_4ON4OFF", 12, Position.CO, year++, 0));
        employees.add(person(code, unitId, "D" + i, 1.0, "D12_DAY_4ON4OFF", 12, Position.CO, year++, 0));
      }
      employees.add(person(code, unitId, "C0", 0.6, "CASUAL_12", 12, Position.CO, year++, 0));
    }
    if (supervisors) {
      units.add(
          new PlanGenerator.Unit(
              SUP_L, "SUP-L", "Supervision · Living units", true, false,
              Map.of("DAY", 1, "EVENING", 1, "NIGHT", 1), "SUPERVISION"));
      units.add(
          new PlanGenerator.Unit(
              SUP_O, "SUP-O", "Supervision · Operations", true, false,
              Map.of("DAY", 1, "EVENING", 1, "NIGHT", 1), "SUPERVISION"));
      int promoted = 2015;
      for (int i = 0; i < 2; i++) {
        employees.add(person("SUP-L", SUP_L, "N" + i, 1.0, "N12_NIGHT_4ON4OFF", 12, Position.CS, year++, promoted++));
      }
      for (int i = 0; i < 3; i++) {
        employees.add(person("SUP-L", SUP_L, "D" + i, 1.0, "D12_DAY_4ON4OFF", 12, Position.CS, year++, promoted++));
      }
      employees.add(person("SUP-L", SUP_L, "E0", 1.0, "D8_DAY_5ON2OFF", 8, Position.CS, year++, promoted++));
      for (int i = 0; i < 2; i++) {
        employees.add(person("SUP-O", SUP_O, "N" + i, 1.0, "N12_NIGHT_4ON4OFF", 12, Position.CS, year++, promoted++));
      }
      employees.add(person("SUP-O", SUP_O, "D0", 1.0, "D12_DAY_4ON4OFF", 12, Position.CS, year++, promoted++));
      employees.add(person("SUP-O", SUP_O, "C0", 0.6, "CASUAL_12", 12, Position.CS, year++, promoted++));
    }
    return new Centre(units, employees);
  }

  private static PlanGenerator.Employee person(
      String unit, UUID unitId, String suffix, double fte, String crew, int length,
      Position position, int serviceYear, int promotedYear) {
    LocalDate service = LocalDate.of(serviceYear, 1, 1);
    return new PlanGenerator.Employee(
        UUID.nameUUIDFromBytes((unit + ":" + suffix).getBytes()),
        unit + "-" + suffix,
        unit + " " + suffix,
        unitId,
        unit,
        service,
        fte,
        new PlanGenerator.Pref(length, List.of(), List.of()),
        length,
        0,
        crew,
        null,
        position,
        promotedYear == 0 ? null : LocalDate.of(promotedYear, 1, 1));
  }

  private static PlanGenerator.Result generate(
      Centre centre, PlanGenerator.Verifier verifier, PlanGenerator.Options options) {
    return new PlanGenerator()
        .generate(
            centre.employees, centre.units, templates(), new HashMap<>(), null, 20261001, verifier,
            Map.of(), CLOSURES, options, PlanGenerator.Qualifications.NONE);
  }

  private static Map<UUID, PlanGenerator.Employee> byId(Centre centre) {
    Map<UUID, PlanGenerator.Employee> byId = new HashMap<>();
    centre.employees.forEach(e -> byId.put(e.id(), e));
    return byId;
  }

  private static List<String> rows(PlanGenerator.Result result, Set<UUID> people) {
    return result.assignments().stream()
        .filter(a -> people.contains(a.employeeId()))
        .map(a -> a.employeeId() + "|" + a.unitCode() + "|" + a.date() + "|" + a.templateCode())
        .toList();
  }

  private static Map<String, PlanGenerator.Template> templates() {
    Map<String, PlanGenerator.Template> t = new LinkedHashMap<>();
    t.put("D8", t("D8", LocalTime.of(7, 0), 480));
    t.put("E8", t("E8", LocalTime.of(15, 0), 480));
    t.put("N8", t("N8", LocalTime.of(23, 0), 480));
    t.put("D12", t("D12", LocalTime.of(7, 0), 720));
    t.put("N12", t("N12", LocalTime.of(19, 0), 720));
    t.put("A12", t("A12", LocalTime.of(0, 0), 720));
    t.put("P12", t("P12", LocalTime.of(12, 0), 720));
    return t;
  }

  private static PlanGenerator.Template t(String code, LocalTime start, int minutes) {
    return new PlanGenerator.Template(UUID.nameUUIDFromBytes(code.getBytes()), code, start, minutes);
  }
}
