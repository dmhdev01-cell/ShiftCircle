package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The shared time-of-day set rules: canonical order, any-match, night volunteer, ranking. */
class PreferenceTimesTest {

  @Test
  void normalizeCanonicalisesAndCollapsesDuplicates() {
    assertThat(PreferenceTimes.normalize(List.of("NIGHT", "day", "EVENING", "DAY")))
        .containsExactly("DAY", "EVENING", "NIGHT");
    assertThat(PreferenceTimes.normalize(List.of())).isEmpty();
    assertThat(PreferenceTimes.normalize(null)).isEmpty();
  }

  @Test
  void legacyMapsToOneElementOrEmpty() {
    assertThat(PreferenceTimes.fromLegacy("DAY")).containsExactly("DAY");
    assertThat(PreferenceTimes.fromLegacy("evening")).containsExactly("EVENING");
    assertThat(PreferenceTimes.fromLegacy("NONE")).isEmpty();
    assertThat(PreferenceTimes.fromLegacy(null)).isEmpty();
    assertThatThrownBy(() -> PreferenceTimes.fromLegacy("MORNING"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anyChosenPartMatches() {
    assertThat(PreferenceTimes.matches(List.of("DAY", "EVENING"), "EVENING")).isTrue();
    assertThat(PreferenceTimes.matches(List.of("DAY", "EVENING"), "NIGHT")).isFalse();
    assertThat(PreferenceTimes.matches(List.of(), "DAY")).isFalse();
  }

  @Test
  void nightVolunteerAndAvoidsNights() {
    assertThat(PreferenceTimes.nightVolunteer(List.of("EVENING", "NIGHT"))).isTrue();
    assertThat(PreferenceTimes.nightVolunteer(List.of("DAY", "EVENING"))).isFalse();
    assertThat(PreferenceTimes.avoidsNights(List.of("DAY", "EVENING"))).isTrue();
    assertThat(PreferenceTimes.avoidsNights(List.of("EVENING", "NIGHT"))).isFalse();
    assertThat(PreferenceTimes.avoidsNights(List.of())).isFalse();
  }

  @Test
  void rankingUsesTheEarliestChosenPart() {
    assertThat(PreferenceTimes.rank(List.of("DAY", "NIGHT"))).isZero();
    assertThat(PreferenceTimes.rank(List.of("EVENING", "NIGHT"))).isEqualTo(1);
    assertThat(PreferenceTimes.rank(List.of("NIGHT"))).isEqualTo(2);
    assertThat(PreferenceTimes.rank(List.of())).isEqualTo(2);
    assertThat(PreferenceTimes.preferredBlock(List.of("DAY", "NIGHT"))).isEqualTo("DAY");
    assertThat(PreferenceTimes.preferredBlock(List.of("EVENING", "NIGHT"))).isEqualTo("EVENING");
    assertThat(PreferenceTimes.preferredBlock(List.of("NIGHT"))).isEqualTo("NIGHT");
    assertThat(PreferenceTimes.preferredBlock(List.of())).isEqualTo("DAY");
  }
}
