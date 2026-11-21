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
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 100 full-time + 50 casuals (FTE 0.4-0.8): fill pool never exceeds each officer's target. */
class PlanGeneratorFteTest {

  @Test
  void casualsFillGapsWithoutExceedingTheirTarget() {
    List<PlanGenerator.Unit> units = new ArrayList<>();
    List<PlanGenerator.Employee> employees = new ArrayList<>();
    Map<String, Integer> fullTime = Map.of("A", 18, "B", 18, "C", 17, "ADM", 13, "CTL", 15, "ESC", 19);
    Map<String, Integer> casuals = Map.of("A", 9, "B", 9, "C", 9, "ADM", 6, "CTL", 7, "ESC", 10);
    int phase = 0;
    int casualIndex = 0;
    for (String code : List.of("A", "B", "C", "ADM", "CTL", "ESC")) {
      UUID unitId = UUID.nameUUIDFromBytes(("unit:" + code).getBytes());
      Map<String, Integer> required =
          switch (code) {
            case "A", "B" -> Map.of("DAY", 5, "EVENING", 5, "NIGHT", 4);
            case "C" -> Map.of("DAY", 5, "EVENING", 4, "NIGHT", 4);
            case "ADM" -> Map.of("DAY", 3, "EVENING", 3, "NIGHT", 2);
            case "CTL" -> Map.of("DAY", 3, "EVENING", 3, "NIGHT", 3);
            default -> Map.of("DAY", 6, "EVENING", 4, "NIGHT", 2);
          };
      units.add(new PlanGenerator.Unit(unitId, code, code, code.equals("CTL") || code.equals("ESC"),
          false, required));
      for (int i = 0; i < fullTime.get(code); i++, phase++) {
        employees.add(employee(code, unitId, "F" + i, 1.0, phase));
      }
      for (int i = 0; i < casuals.get(code); i++, casualIndex++) {
        double fte = 0.4 + (casualIndex % 3) * 0.2; // 0.4, 0.6, 0.8
        employees.add(employee(code, unitId, "C" + i, fte, 2027));
      }
    }
    long start = System.nanoTime();
    PlanGenerator.Result result =
        new PlanGenerator()
            .generate(employees, units, templates(), new HashMap<>(), "ROTATING_5_2", 20261001,
                (employee, unit, template, instant, current) ->
                    new PlanGenerator.Check(false, List.of()));
    long ms = (System.nanoTime() - start) / 1_000_000;
    Map<UUID, Map<Integer, Double>> casualHours = new LinkedHashMap<>();
    employees.stream().filter(e -> e.fte() < 1.0)
        .forEach(e -> casualHours.put(e.id(), new LinkedHashMap<>()));
    for (PlanGenerator.Assignment assignment : result.assignments()) {
      Map<Integer, Double> perPeriod = casualHours.get(assignment.employeeId());
      if (perPeriod == null) {
        continue;
      }
      int period =
          (int) (ChronoUnit.DAYS.between(PlanGenerator.FROM, assignment.date()) / 14);
      perPeriod.merge(period, Duration.between(assignment.start(), assignment.end()).toMinutes() / 60.0,
          Double::sum);
    }
    Map<UUID, Double> fte = new HashMap<>();
    employees.forEach(e -> fte.put(e.id(), e.fte()));
    for (Map.Entry<UUID, Map<Integer, Double>> entry : casualHours.entrySet()) {
      for (double hours : entry.getValue().values()) {
        assertThat(hours)
            .as("casual %s target %s", entry.getKey(), fte.get(entry.getKey()) * 80)
            .isLessThanOrEqualTo(fte.get(entry.getKey()) * 80 + 0.001);
      }
    }
    System.out.println(
        "FTE gaps " + result.gaps().size() + " of 1764, assignments "
            + result.assignments().size() + ", casuals " + casualHours.size() + ", " + ms + " ms; "
            + "fte bands " + result.scorecard().get("fteBands"));
    assertThat(casualHours.values().stream().anyMatch(m -> !m.isEmpty())).isTrue();
    assertThat(result.gaps().size()).isLessThan(617);
    assertThat(((Map<?, ?>) result.scorecard().get("fteBands")).get("bands"))
        .asList()
        .isNotEmpty();
  }

  private static PlanGenerator.Employee employee(
      String unit, UUID unitId, String suffix, double fte, int phase) {
    return new PlanGenerator.Employee(
        UUID.nameUUIDFromBytes((unit + suffix).getBytes()),
        unit + "-" + suffix,
        unit + " " + suffix,
        unitId,
        unit,
        LocalDate.of(2006, 1, 1).plusDays((suffix.hashCode() & 0x7fffffff) % (19 * 365)),
        fte,
        new PlanGenerator.Pref(8, "NONE", List.of()),
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
    t.put("L16", t("L16", LocalTime.of(6, 0), 960));
    return t;
  }

  private static PlanGenerator.Template t(String code, LocalTime start, int minutes) {
    return new PlanGenerator.Template(UUID.nameUUIDFromBytes(code.getBytes()), code, start, minutes);
  }
}
