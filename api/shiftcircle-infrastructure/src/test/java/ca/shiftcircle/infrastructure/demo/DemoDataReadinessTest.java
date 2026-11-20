package ca.shiftcircle.infrastructure.demo;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class DemoDataReadinessTest {

  @Test
  void startsDown() {
    assertThat(new DemoDataReadiness().isReady()).isFalse();
  }

  @Test
  void generatorMarksReadyWhenTheDatasetIsAlreadyPresent() {
    DemoDataReadiness readiness = new DemoDataReadiness();
    JdbcTemplate jdbc =
        new JdbcTemplate() {
          @Override
          @SuppressWarnings("unchecked")
          public <T> T queryForObject(String sql, Class<T> requiredType) {
            // The generator skips when officers already exist; readiness must still flip.
            return (T) Integer.valueOf(120);
          }
        };

    new DemoDataGenerator(jdbc, null, readiness).run(null);

    assertThat(readiness.isReady()).isTrue();
  }
}
