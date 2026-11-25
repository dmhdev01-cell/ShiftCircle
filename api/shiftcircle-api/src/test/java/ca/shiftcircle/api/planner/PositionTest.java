package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.domain.Position;
import org.junit.jupiter.api.Test;

/**
 * The rank lookup (release v1.3, S1): the two ranks the api knows, and a rank the api does not
 * know, which must not stop anything.
 */
class PositionTest {

  @Test
  void theTwoRanksTheApiKnowsAreFound() {
    assertThat(Position.fromCode("CO")).isEqualTo(Position.CO);
    assertThat(Position.fromCode("CS")).isEqualTo(Position.CS);

    assertThat(Position.CO.isSupervisory()).isFalse();
    assertThat(Position.CS.isSupervisory()).isTrue();
    assertThat(Position.CS.rankOrder()).isGreaterThan(Position.CO.rankOrder());
  }

  @Test
  void anUnknownRankIsFoundAsNothingAndFallsBackToTheLowestNonSupervisoryRank() {
    // The rank table is the source of truth, so it can hold a rank this build has no constant for.
    assertThat(Position.fromCode("LT")).isNull();

    // Where a rank is needed, an unknown one is the lowest, non-supervisory rank: it can never
    // make the planner treat someone as a supervisor by accident.
    assertThat(Position.fromCodeOrDefault("LT")).isEqualTo(Position.CO);
    assertThat(Position.fromCodeOrDefault("LT").isSupervisory()).isFalse();
    assertThat(Position.fromCodeOrDefault(null)).isEqualTo(Position.CO);
  }
}
