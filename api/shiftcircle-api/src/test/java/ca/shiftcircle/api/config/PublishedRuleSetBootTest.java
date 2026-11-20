package ca.shiftcircle.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.api.rulesets.RuleRowsRepository;
import ca.shiftcircle.rules.RuleSetCompiler;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The boot load is a second entry point for stored rule rows (docs/04 §6). A row edited directly in
 * PostgreSQL must stop the app with a plain message, not be served unvalidated.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class PublishedRuleSetBootTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private RuleSetCompiler compiler;
  @Autowired private RuleRowsRepository rows;

  @Test
  void aDirectEditToAPublishedRowRefusesToStartAndNamesTheProblem() {
    UUID published =
        jdbc.queryForObject(
            "SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'"
                + " ORDER BY effective_from DESC LIMIT 1",
            UUID.class);
    String original =
        jdbc.queryForObject(
            "SELECT params::text FROM rule_row WHERE rule_set_version_id = ? AND code = 'U-01'",
            String.class,
            published);

    try {
      jdbc.update(
          "UPDATE rule_row SET params = '{\"afterShiftKind\":\".*\",\"windowHours\":24,"
              + "\"minExtensionMinutes\":0,\"minRestHours\":7}'::jsonb"
              + " WHERE rule_set_version_id = ? AND code = 'U-01'",
          published);

      assertThatThrownBy(() -> new PublishedRuleSet(compiler, rows))
          .isInstanceOf(IllegalStateException.class)
          .hasMessageContaining("ShiftCircle will not start")
          .hasMessageContaining("U-01")
          .hasMessageContaining("8-hour");
    } finally {
      jdbc.update(
          "UPDATE rule_row SET params = ?::jsonb WHERE rule_set_version_id = ? AND code = 'U-01'",
          original,
          published);
    }

    PublishedRuleSet restarted = new PublishedRuleSet(compiler, rows);
    assertThat(restarted.version()).as("the restored rows boot normally").isPositive();
  }
}
