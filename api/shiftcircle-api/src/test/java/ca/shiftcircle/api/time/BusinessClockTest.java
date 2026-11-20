package ca.shiftcircle.api.time;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class BusinessClockTest {

  @Test
  void theDemoClockIsFrozenAtNoonOnTheDemoDay() {
    BusinessClock clock = new BusinessClock("2026-11-19");

    assertThat(clock.now()).isEqualTo(Instant.parse("2026-11-19T18:00:00Z"));
    assertThat(clock.today()).isEqualTo(LocalDate.of(2026, 11, 19));
  }

  @Test
  void withoutADemoDateTheRealClockIsUsed() {
    BusinessClock clock = new BusinessClock("");

    assertThat(Duration.between(clock.now(), Instant.now()).abs()).isLessThan(Duration.ofSeconds(2));
    assertThat(clock.today()).isEqualTo(LocalDate.now(BusinessClock.REGINA));
  }
}
