package ca.shiftcircle.api.rulesets;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** V12 publishes v3 with U-16 and keeps v2 as history; v4 (release v1.3) keeps v3 as history. */
@SpringBootTest
@ActiveProfiles("demo")
class RuleSetV3SeedTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;

  @Test
  void v3CarriesU16AndV2IsRetained() {
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM rule_set_version WHERE version = 3", String.class))
        .isEqualTo("SUPERSEDED");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM rule_set_version WHERE version = 2", String.class))
        .isEqualTo("SUPERSEDED");
    List<String> row =
        jdbc.queryForList(
            "SELECT rr.code || '|' || rr.severity || '|' || rr.override_policy || '|' ||"
                + " (rr.params->>'nightShiftOnly') FROM rule_row rr JOIN rule_set_version v"
                + " ON v.id = rr.rule_set_version_id WHERE v.version = 3 AND rr.code = 'U-16'",
            String.class);
    assertThat(row).containsExactly("U-16|WARN|ACKNOWLEDGE|true");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM rule_row rr JOIN rule_set_version v"
                    + " ON v.id = rr.rule_set_version_id WHERE v.version = 3",
                Integer.class))
        .isEqualTo(
            jdbc.queryForObject(
                "SELECT count(*) FROM rule_row rr JOIN rule_set_version v"
                    + " ON v.id = rr.rule_set_version_id WHERE v.version = 2",
                Integer.class)
                + 1);
  }
}
