package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** D12 and N12 are separate crews; 8 h crews stay D8/E8; the 4/4 phase pairs cover every day. */
class PlanGeneratorCrewTest {

  private static final java.time.ZoneId ZONE = java.time.ZoneId.of("America/Regina");

  @Test
  void dayAndNightCrewsStaySeparateAndCoverEveryDay() {
    UUID unitId = UUID.nameUUIDFromBytes("unit:A".getBytes());
    PlanGenerator.Unit unit =
        new PlanGenerator.Unit(
            unitId, "A", "Unit A", true, false, Map.of("DAY", 2, "EVENING", 2, "NIGHT", 2));
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    int index = 0;
    for (; index < 4; index++) {
      employees.add(employee(unitId, "N" + index, 12, "NIGHT", "N12_NIGHT_4ON4OFF", index));
    }
    for (; index < 8; index++) {
      employees.add(employee(unitId, "D" + index, 12, "DAY", "D12_DAY_4ON4OFF", index));
    }
    for (; index < 10; index++) {
      employees.add(employee(unitId, "E" + index, 8, "EVENING", "E8_EVENING_5ON2OFF", index));
    }
    for (; index < 14; index++) {
      employees.add(employee(unitId, "d" + index, 8, "DAY", "D8_DAY_5ON2OFF", index));
    }

    PlanGenerator.Result result =
        new PlanGenerator()
            .generate(
                employees,
                List.of(unit),
                templates(),
                new HashMap<>(),
                "ROTATING_5_2",
                20261001,
                (employee, unit1, template, instant, current) ->
                    new PlanGenerator.Check(false, List.of()));

    Map<String, List<PlanGenerator.Assignment>> byTemplate = new LinkedHashMap<>();
    Map<UUID, java.util.Set<String>> byEmployee = new LinkedHashMap<>();
    Map<LocalDate, Integer> nightByDate = new LinkedHashMap<>();
    for (PlanGenerator.Assignment assignment : result.assignments()) {
      byTemplate
          .computeIfAbsent(assignment.templateCode(), key -> new ArrayList<>())
          .add(assignment);
      byEmployee
          .computeIfAbsent(assignment.employeeId(), key -> new java.util.LinkedHashSet<>())
          .add(assignment.templateCode());
      if ("N12".equals(assignment.templateCode())) {
        nightByDate.merge(assignment.date(), 1, Integer::sum);
        assertThat(assignment.start().atZone(ZONE).toLocalTime())
            .isEqualTo(LocalTime.of(19, 0));
        assertThat(assignment.end())
            .isEqualTo(assignment.start().plus(Duration.ofHours(12)));
      }
      if ("D12".equals(assignment.templateCode())) {
        assertThat(assignment.start().atZone(ZONE).toLocalTime())
            .isEqualTo(LocalTime.of(7, 0));
      }
    }

    assertThat(byTemplate).doesNotContainKeys("N8", "L16", "A12", "P12");
    assertThat(byTemplate).containsKeys("N12", "D12", "D8", "E8");
    // Two night posts, four N12 officers paired 0/4 and 1/5: exactly two on every night.
    for (LocalDate date = PlanGenerator.FROM;
        !date.isAfter(PlanGenerator.TO);
        date = date.plusDays(1)) {
      assertThat(nightByDate.getOrDefault(date, 0))
          .as("N12 on duty on %s", date)
          .isEqualTo(2);
    }
    assertThat(byTemplate.get("N12")).hasSize(196);
    assertThat(byTemplate.get("D12")).hasSize(196);

    for (PlanGenerator.Employee employee : employees) {
      java.util.Set<String> codes = byEmployee.getOrDefault(employee.id(), java.util.Set.of());
      switch (employee.crew()) {
        case "N12_NIGHT_4ON4OFF" -> assertThat(codes).containsOnly("N12");
        case "D12_DAY_4ON4OFF" -> assertThat(codes).containsOnly("D12");
        case "D8_DAY_5ON2OFF" -> assertThat(codes).containsOnly("D8");
        case "E8_EVENING_5ON2OFF" -> assertThat(codes).containsOnly("E8");
        default -> throw new IllegalStateException(employee.crew());
      }
    }
    assertThat(result.gaps().stream().filter(gap -> "NIGHT".equals(gap.block())))
        .as("the N12 crew covers every night")
        .isEmpty();
    @SuppressWarnings("unchecked")
    Map<String, Object> nights = (Map<String, Object>) result.scorecard().get("nights");
    assertThat(nights.get("n12Officers")).isEqualTo(4L);
    assertThat(nights.get("n12NightShifts")).isEqualTo(196L);
    assertThat(nights.get("crewNote").toString()).contains("newest officers into the night crew");
    assertThat((List<?>) nights.get("bands")).hasSize(3);
  }

  private static PlanGenerator.Employee employee(
      UUID unitId, String suffix, int length, String time, String crew, int index) {
    return new PlanGenerator.Employee(
        UUID.nameUUIDFromBytes((crew + suffix).getBytes()),
        "150-" + suffix,
        "Officer " + suffix,
        unitId,
        "A",
        LocalDate.of(2020, 1, 1).plusDays(index * 37L),
        1.0,
        new PlanGenerator.Pref(length, time, List.of()),
        length,
        0,
        crew);
  }

  private static Map<String, PlanGenerator.Template> templates() {
    Map<String, PlanGenerator.Template> t = new LinkedHashMap<>();
    t.put("D8", t("D8", LocalTime.of(7, 0), 480));
    t.put("E8", t("E8", LocalTime.of(15, 0), 480));
    t.put("N8", t("N8", LocalTime.of(23, 0), 480));
    t.put("A12", t("A12", LocalTime.of(0, 0), 720));
    t.put("P12", t("P12", LocalTime.of(12, 0), 720));
    t.put("D12", t("D12", LocalTime.of(7, 0), 720));
    t.put("N12", t("N12", LocalTime.of(19, 0), 720));
    t.put("L16", t("L16", LocalTime.of(6, 0), 960));
    return t;
  }

  private static PlanGenerator.Template t(String code, LocalTime start, int minutes) {
    return new PlanGenerator.Template(UUID.nameUUIDFromBytes(code.getBytes()), code, start, minutes);
  }
}
