package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** PR-N: the plan-inputs fill order follows the Generate options it was made with. */
class PlanInputsFillOrderTest {

  private static Map<String, Object> options(
      List<String> staffTypes, String partTimeFill, String crossUnitFill) {
    Map<String, Object> options = new HashMap<>();
    options.put("seed", 20261001L);
    options.put("pattern8h", null);
    options.put("staffTypes", staffTypes);
    options.put("partTimeFill", partTimeFill);
    options.put("crossUnitFill", crossUnitFill);
    return options;
  }

  @Test
  void theDefaultsKeepTheFiveStepsAndAnOlderSnapshotReadsTheSame() {
    List<String> defaults =
        PlanInputs.fillOrder(
            3, options(List.of("FULL_TIME", "PART_TIME"), "AFTER_FULL_TIME", "OFF"));
    assertThat(defaults).hasSize(5);
    // A snapshot from before PR-N has only seed and pattern8h.
    Map<String, Object> older = new HashMap<>();
    older.put("seed", 20261001L);
    older.put("pattern8h", null);
    assertThat(PlanInputs.fillOrder(3, older)).isEqualTo(defaults);
  }

  @Test
  void crossUnitComesAfterReliefAndTheUpToFteExtrasAfterThat() {
    List<String> steps =
        PlanInputs.fillOrder(3, options(List.of("FULL_TIME", "PART_TIME"), "UP_TO_FTE", "ON"));
    assertThat(steps).hasSize(7);
    assertThat(steps.get(3)).startsWith("Where a unit is closed on a day");
    assertThat(steps.get(4))
        .startsWith("Each gap still open is then offered to officers homed in another unit")
        .contains("hold the block's qualification")
        .contains("roster marks them \"From\" their unit");
    assertThat(steps.get(5))
        .isEqualTo(
            "Each part-time officer is then given shifts above the minimum in their home unit"
                + " where cover is thinnest, up to FTE × 80 h in each pay period, spread evenly"
                + " through the period.");
    assertThat(steps.get(6)).startsWith("Every proposed shift is checked by the rules engine");
  }

  @Test
  void fullTimeOnlySaysPartTimersGetNoShiftsAndHasNoTopUp() {
    List<String> steps =
        PlanInputs.fillOrder(3, options(List.of("FULL_TIME"), "AFTER_FULL_TIME", "OFF"));
    assertThat(steps).hasSize(5);
    assertThat(steps.get(2)).contains("are left out of this draft").contains("get no shifts");
  }
}
