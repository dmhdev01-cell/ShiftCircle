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

/**
 * Release v1.3 S2: the posts migration publishes v4 = v3 plus R-01 and R-02 in the new "Who can
 * work a post" table, and keeps v3 as history. ReferenceDataMatchesRuleRowsTest proves the
 * published rows equal the code rows.
 */
@SpringBootTest
@ActiveProfiles("demo")
class RuleSetV4SeedTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;

  @Test
  void v4IsPublishedWithThePostRulesAndV3IsRetained() {
    assertThat(
            jdbc.queryForObject(
                "SELECT version FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class))
        .isEqualTo(4);
    assertThat(
            jdbc.queryForObject(
                "SELECT based_on_version FROM rule_set_version WHERE version = 4", Integer.class))
        .isEqualTo(3);
    List<String> rows =
        jdbc.queryForList(
            "SELECT rr.code || '|' || t.code || '|' || rr.severity || '|' || rr.override_policy"
                + " || '|' || (rr.params->>'postKind') || '|' || (rr.params->>'allowedPositions')"
                + " || '|' || coalesce(rr.params->>'actingQualification', '-')"
                + " FROM rule_row rr JOIN rule_set_version v ON v.id = rr.rule_set_version_id"
                + " JOIN rule_table t ON t.id = rr.rule_table_id"
                + " WHERE v.version = 4 AND t.code = 'POSTS' ORDER BY rr.sort_order",
            String.class);
    assertThat(rows)
        .containsExactly(
            "R-01|POSTS|BLOCK|NONE|SUPERVISION|[\"CS\"]|ACTING_SUP",
            "R-02|POSTS|WARN|ACKNOWLEDGE|LINE|[\"CO\"]|-");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM rule_row rr JOIN rule_set_version v"
                    + " ON v.id = rr.rule_set_version_id WHERE v.version = 4",
                Integer.class))
        .isEqualTo(
            jdbc.queryForObject(
                    "SELECT count(*) FROM rule_row rr JOIN rule_set_version v"
                        + " ON v.id = rr.rule_set_version_id WHERE v.version = 3",
                    Integer.class)
                + 2);
    // Every v3 row is carried into v4 unchanged.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM rule_row r3 JOIN rule_set_version v3"
                    + " ON v3.id = r3.rule_set_version_id AND v3.version = 3"
                    + " WHERE NOT EXISTS (SELECT 1 FROM rule_row r4 JOIN rule_set_version v4"
                    + " ON v4.id = r4.rule_set_version_id AND v4.version = 4"
                    + " WHERE r4.code = r3.code AND r4.params = r3.params"
                    + " AND r4.severity = r3.severity AND r4.override_policy = r3.override_policy"
                    + " AND r4.message = r3.message AND r4.enabled = r3.enabled)",
                Integer.class))
        .isZero();
  }
}
