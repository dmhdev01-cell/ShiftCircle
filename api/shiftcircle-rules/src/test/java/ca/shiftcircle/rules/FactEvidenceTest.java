package ca.shiftcircle.rules;

import static ca.shiftcircle.rules.RuleTestSupport.schedule;
import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.build.BusinessTime;
import ca.shiftcircle.rules.build.ConsecutiveRunFactBuilder;
import ca.shiftcircle.rules.build.LongShiftCountFactBuilder;
import ca.shiftcircle.rules.build.RollingHoursFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import ca.shiftcircle.rules.build.ShiftLengthFactBuilder;
import ca.shiftcircle.rules.facts.ConsecutiveRunFact;
import ca.shiftcircle.rules.facts.LongShiftCountFact;
import ca.shiftcircle.rules.facts.MaxHoursInWindowFact;
import ca.shiftcircle.rules.facts.ShiftLengthFact;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * V19 follow-up: every fact builder's evidence line is read by a supervisor in the rule-check panel,
 * so it must name the shifts in words and never echo the database assignment id (a UUID).
 *
 * <p>These tests feed real UUID assignment ids, which is the only way to catch a regression: the
 * shared test helper's ids are already words.
 */
class FactEvidenceTest {

  private static final String ID = "b729d3c7-7d8b-3db9-93e3-547cd68c5911";
  private static final String ID_2 = "c41d9e2a-1f4b-4a6c-8d5e-2b7a9c0d1e3f";

  private static ShiftFact shift(
      String id, String code, String date, String time, int minutes) {
    Instant start = BusinessTime.at(date, time);
    return new ShiftFact(
        id,
        "officer",
        "A",
        code,
        start,
        start.plusSeconds(minutes * 60L),
        ShiftKind.ROSTERED,
        0,
        true,
        true);
  }

  @Test
  void theRollingHoursEvidenceNamesNoAssignmentId() {
    List<MaxHoursInWindowFact> facts =
        new RollingHoursFactBuilder()
            .build(schedule(shift(ID, "D8", "2026-11-19", "07:00", 480)), 24);

    assertThat(facts)
        .singleElement()
        .satisfies(
            fact -> {
              assertThat(fact.getEvidence()).doesNotContain(ID);
              assertThat(fact.getEvidenceAssignmentIds()).containsExactly(ID);
            });
  }

  @Test
  void theLongShiftEvidenceNamesNoAssignmentId() {
    List<LongShiftCountFact> facts =
        new LongShiftCountFactBuilder()
            .build(schedule(shift(ID, "L16", "2026-11-19", "06:00", 960)));

    assertThat(facts)
        .singleElement()
        .satisfies(
            fact -> {
              assertThat(fact.getEvidence()).doesNotContain(ID);
              assertThat(fact.getEvidenceAssignmentIds()).containsExactly(ID);
            });
  }

  @Test
  void theConsecutiveRunEvidenceNamesNoAssignmentId() {
    List<ConsecutiveRunFact> facts =
        new ConsecutiveRunFactBuilder()
            .build(
                schedule(
                    shift(ID, "A12", "2026-11-19", "07:00", 720),
                    shift(ID_2, "A12", "2026-11-20", "07:00", 720)));

    assertThat(facts).isNotEmpty();
    for (ConsecutiveRunFact fact : facts) {
      assertThat(fact.getEvidence())
          .as(fact.getCounts())
          .doesNotContain(ID)
          .doesNotContain(ID_2);
    }
    assertThat(facts)
        .filteredOn(fact -> "DAYS".equals(fact.getCounts()))
        .singleElement()
        .satisfies(fact -> assertThat(fact.getEvidenceAssignmentIds()).containsExactly(ID_2));
    assertThat(facts)
        .filteredOn(fact -> "SHIFTS_12H".equals(fact.getCounts()))
        .singleElement()
        .satisfies(fact -> assertThat(fact.getEvidenceAssignmentIds()).containsExactly(ID_2));
  }

  @Test
  void theShiftLengthEvidenceNamesNoAssignmentId() {
    List<ShiftLengthFact> facts =
        new ShiftLengthFactBuilder().build(schedule(shift(ID, "A12", "2026-11-19", "07:00", 720)));

    assertThat(facts)
        .singleElement()
        .satisfies(
            fact -> {
              assertThat(fact.getEvidence()).doesNotContain(ID);
              assertThat(fact.getEvidenceAssignmentIds()).containsExactly(ID);
            });
  }
}
