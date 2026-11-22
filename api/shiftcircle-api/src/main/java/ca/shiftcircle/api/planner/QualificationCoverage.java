package ca.shiftcircle.api.planner;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiPredicate;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The qualification-coverage card (release 6 #6, Option A): read-only over a generated draft.
 *
 * <p>For every active unit requirement with a qualified minimum, it counts the block-days where
 * fewer qualified officers are on duty than the minimum. It never changes a placement and never
 * enforces anything. The SQL shape is the same measurement the 120 reset test used; the date rule
 * comes from {@link ca.shiftcircle.api.units.ActiveUnits} so a closed unit has no requirement on the
 * closed day. An officer placed in another unit as relief is counted there, with their own
 * qualifications, because the draft assignment carries the unit where they were placed.
 *
 * <p>{@code employee_qualification.valid_from} is not read: an endorsement counts whenever it
 * exists. The card says so in words.
 */
public final class QualificationCoverage {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  private QualificationCoverage() {}

  public static Map<String, Object> card(
      JdbcTemplate jdbc,
      List<PlanGenerator.Assignment> assignments,
      BiPredicate<UUID, LocalDate> unitActive) {
    record Requirement(
        UUID unitId,
        String unitCode,
        String unitName,
        String block,
        UUID qualificationId,
        String qualification,
        int minimum) {}

    List<Requirement> requirements =
        jdbc.query(
            "SELECT r.unit_id, u.code, u.name, r.block, r.qualification_id, q.code AS qualification,"
                + " r.min_with_qualification FROM unit_requirement r"
                + " JOIN unit u ON u.id = r.unit_id JOIN qualification q ON q.id = r.qualification_id"
                + " WHERE r.effective_to IS NULL AND r.min_with_qualification > 0"
                + " ORDER BY u.code, r.block",
            (rs, row) ->
                new Requirement(
                    rs.getObject("unit_id", UUID.class),
                    rs.getString("code"),
                    rs.getString("name"),
                    rs.getString("block"),
                    rs.getObject("qualification_id", UUID.class),
                    rs.getString("qualification"),
                    rs.getInt("min_with_qualification")));

    Map<UUID, Set<UUID>> qualified =
        jdbc.query(
                "SELECT employee_id, qualification_id FROM employee_qualification",
                (rs, row) ->
                    Map.entry(
                        rs.getObject("employee_id", UUID.class),
                        rs.getObject("qualification_id", UUID.class)))
            .stream()
            .collect(
                Collectors.groupingBy(
                    Map.Entry::getKey,
                    Collectors.mapping(Map.Entry::getValue, Collectors.toSet())));

    record Key(String unitCode, String block) {}
    Map<Key, int[]> counts = new LinkedHashMap<>();
    List<Map<String, Object>> rows = new ArrayList<>();
    int failing = 0;
    int checked = 0;

    for (Requirement requirement : requirements) {
      Key key = new Key(requirement.unitCode(), requirement.block());
      int[] pair = counts.computeIfAbsent(key, ignored -> new int[2]);
      int requirementFailing = 0;
      int requirementChecked = 0;
      for (LocalDate date = PlanGenerator.FROM;
          !date.isAfter(PlanGenerator.TO);
          date = date.plusDays(1)) {
        // A closed unit has no requirement that day; it is not a failure and not checked.
        if (!unitActive.test(requirement.unitId(), date)) {
          continue;
        }
        Instant start = blockStart(date, requirement.block());
        Instant end = start.plusSeconds(8 * 3600L);
        int onDuty = 0;
        int qualifiedOnDuty = 0;
        for (PlanGenerator.Assignment assignment : assignments) {
          if (!requirement.unitId().equals(assignment.unitId())) {
            continue;
          }
          if (assignment.start().isBefore(end) && assignment.end().isAfter(start)) {
            onDuty++;
            if (qualified
                .getOrDefault(assignment.employeeId(), Set.of())
                .contains(requirement.qualificationId())) {
              qualifiedOnDuty++;
            }
          }
        }
        requirementChecked++;
        checked++;
        if (qualifiedOnDuty < requirement.minimum()) {
          requirementFailing++;
          failing++;
        }
      }
      pair[0] += requirementFailing;
      pair[1] += requirementChecked;
      rows.add(
          Map.of(
              "unitCode", requirement.unitCode(),
              "unitName", requirement.unitName(),
              "block", requirement.block(),
              "qualification", requirement.qualification(),
              "minimum", requirement.minimum(),
              "failingBlockDays", requirementFailing,
              "checkedBlockDays", requirementChecked));
    }

    String sentence =
        failing == 0
            ? "No block-day is below the qualified minimum in this draft. The planner does not"
                + " enforce this, so a new draft can change it."
            : failing == 1
                ? "1 block-day is below the qualified minimum. The planner does not enforce this."
                : failing
                    + " block-days are below the qualified minimum. The planner does not enforce"
                    + " this.";
    String validFromNote =
        "Qualification start dates are not checked: an officer with a qualification counts as"
            + " qualified for the whole quarter.";
    Map<String, Object> card = new LinkedHashMap<>();
    card.put("failingBlockDays", failing);
    card.put("checkedBlockDays", checked);
    card.put("passes", failing == 0);
    card.put("byUnitBlock", rows);
    card.put("from", PlanGenerator.FROM.toString());
    card.put("to", PlanGenerator.TO.toString());
    card.put("validFromRespected", false);
    card.put("validFromNote", validFromNote);
    card.put("sentence", sentence);
    return card;
  }

  private static Instant blockStart(LocalDate date, String block) {
    int hour =
        switch (block) {
          case "DAY" -> 7;
          case "EVENING" -> 15;
          default -> 23;
        };
    return date.atTime(hour, 0).atZone(REGINA).toInstant();
  }
}
