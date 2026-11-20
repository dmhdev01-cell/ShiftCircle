package ca.shiftcircle.infrastructure.health;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.infrastructure.demo.DemoDataReadiness;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ReferenceDataHealthIndicatorTest {

  private static JdbcTemplate jdbcReturning(int published) {
    return new JdbcTemplate() {
      @Override
      @SuppressWarnings("unchecked")
      public <T> T queryForObject(String sql, Class<T> requiredType) {
        return (T) Integer.valueOf(published);
      }
    };
  }

  @Test
  void staysDownUntilTheDemoDatasetIsReady() {
    DemoDataReadiness readiness = new DemoDataReadiness();
    ReferenceDataHealthIndicator indicator =
        new ReferenceDataHealthIndicator(jdbcReturning(1), readiness);

    assertThat(indicator.health().getStatus().getCode()).isEqualTo("DOWN");

    readiness.markReady();
    assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
  }

  @Test
  void doesNotGateWhenThereIsNoDemoGenerator() {
    ReferenceDataHealthIndicator indicator =
        new ReferenceDataHealthIndicator(jdbcReturning(1), (DemoDataReadiness) null);

    assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
  }

  @Test
  void staysDownWhenTheRuleSetIsNotPublished() {
    DemoDataReadiness readiness = new DemoDataReadiness();
    readiness.markReady();
    ReferenceDataHealthIndicator indicator =
        new ReferenceDataHealthIndicator(jdbcReturning(0), readiness);

    assertThat(indicator.health().getStatus().getCode()).isEqualTo("DOWN");
  }
}
