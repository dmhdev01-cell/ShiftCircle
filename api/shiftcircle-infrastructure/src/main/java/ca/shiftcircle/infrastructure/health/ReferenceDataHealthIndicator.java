package ca.shiftcircle.infrastructure.health;

import ca.shiftcircle.infrastructure.demo.DemoDataReadiness;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Readiness guard: a running process with no schema, or a schema with no published rule set, is not
 * ready to serve the prototype.
 *
 * <p>Written after a real failure: the app started and reported UP while no migration had run,
 * because Spring Boot 4's Flyway auto-configuration is a separate module. Readiness must not depend
 * on a developer remembering to look at the database.
 */
@Component("referenceData")
public class ReferenceDataHealthIndicator implements HealthIndicator {

  private final JdbcTemplate jdbc;
  private final DemoDataReadiness demoData;

  @Autowired
  public ReferenceDataHealthIndicator(
      JdbcTemplate jdbc, ObjectProvider<DemoDataReadiness> demoData) {
    this(jdbc, demoData.getIfAvailable());
  }

  ReferenceDataHealthIndicator(JdbcTemplate jdbc, DemoDataReadiness demoData) {
    this.jdbc = jdbc;
    this.demoData = demoData;
  }

  @Override
  public Health health() {
    // The demo generator is an ApplicationRunner: the web server can answer before the roster
    // exists. Keep readiness DOWN until it has actually finished, but never gate production.
    if (demoData != null && !demoData.isReady()) {
      return Health.down()
          .withDetail("demoDataset", "generating")
          .withDetail("hint", "The demo roster is still being generated")
          .build();
    }

    Integer published =
        jdbc.queryForObject(
            "SELECT count(*) FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);

    if (published == null || published != 1) {
      return Health.down()
          .withDetail("publishedRuleSets", published)
          .withDetail("hint", "Migrations or the rule-set seed did not run")
          .build();
    }
    return Health.up().withDetail("publishedRuleSets", published).build();
  }
}
