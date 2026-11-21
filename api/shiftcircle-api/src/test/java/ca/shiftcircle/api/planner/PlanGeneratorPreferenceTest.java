package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** A multi-part time preference is met when every shift matches any chosen part. */
class PlanGeneratorPreferenceTest {

  @Test
  void aMixedSetIsMetAndANightOnlySetOnAnEightHourOfficerIsNot() {
    UUID unitId = UUID.nameUUIDFromBytes("unit:pref".getBytes());
    PlanGenerator.Unit unit =
        new PlanGenerator.Unit(unitId, "A", "Unit A", false, false, Map.of("DAY", 1));
    List<PlanGenerator.Employee> employees =
        List.of(
            employee(unitId, "mixed", List.of("DAY", "EVENING"), 0),
            employee(unitId, "night-only", List.of("NIGHT"), 1));

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

    @SuppressWarnings("unchecked")
    Map<String, Object> preferences = (Map<String, Object>) result.scorecard().get("preferences");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> byKind = (List<Map<String, Object>>) preferences.get("byKind");
    Map<String, Object> time =
        byKind.stream()
            .filter(kind -> "TIME_OF_DAY".equals(kind.get("kind")))
            .findFirst()
            .orElseThrow();
    assertThat(time.get("asked")).isEqualTo(2);
    assertThat(time.get("met"))
        .as("the mixed set matches its DAY shift; the 8 h night-only set has no night shift")
        .isEqualTo(1);
    assertThat(
            result.assignments().stream()
                .filter(a -> a.employeeId().equals(employees.get(1).id()))
                .allMatch(a -> "D8".equals(a.templateCode())))
        .as("an 8 h officer is never given a night shift")
        .isTrue();
  }

  private static PlanGenerator.Employee employee(
      UUID unitId, String suffix, List<String> times, int phase) {
    return new PlanGenerator.Employee(
        UUID.nameUUIDFromBytes((unitId + suffix).getBytes()),
        "150-" + suffix,
        "Officer " + suffix,
        unitId,
        "A",
        LocalDate.of(2020, 1, 1).plusDays(phase * 30L),
        1.0,
        new PlanGenerator.Pref(8, times, List.of()),
        8,
        phase);
  }

  private static Map<String, PlanGenerator.Template> templates() {
    Map<String, PlanGenerator.Template> templates = new LinkedHashMap<>();
    templates.put("D8", template("D8", LocalTime.of(7, 0), 480));
    templates.put("E8", template("E8", LocalTime.of(15, 0), 480));
    templates.put("N8", template("N8", LocalTime.of(23, 0), 480));
    return templates;
  }

  private static PlanGenerator.Template template(String code, LocalTime start, int minutes) {
    return new PlanGenerator.Template(
        UUID.nameUUIDFromBytes(code.getBytes()), code, start, minutes);
  }
}
