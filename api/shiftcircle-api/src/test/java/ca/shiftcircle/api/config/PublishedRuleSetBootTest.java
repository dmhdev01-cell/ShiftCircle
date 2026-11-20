package ca.shiftcircle.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.api.rulesets.RuleRowsRepository;
import ca.shiftcircle.rules.RuleSetCompiler;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The boot load is a second entry point for stored rule rows (docs/04 §6). A row edited directly in
 * PostgreSQL must stop the app with a plain message, not be served unvalidated or silently replaced
 * by the v1 fixture.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
@ExtendWith(OutputCaptureExtension.class)
class PublishedRuleSetBootTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private RuleSetCompiler compiler;
  @Autowired private RuleRowsRepository rows;

  @Test
  void aDirectEditToAPublishedRowRefusesToStartAndNamesTheProblem(CapturedOutput output) {
    UUID published =
        jdbc.queryForObject(
            "SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'"
                + " ORDER BY effective_from DESC LIMIT 1",
            UUID.class);
    String original = paramsOf(published);

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
          .hasMessageContaining("between 8 and 24");
      assertThat(output)
          .as("the refusal is in the log, not only in the exception")
          .contains("is not valid, so ShiftCircle will not start")
          .contains("U-01");
    } finally {
      restore(published, original);
    }

    PublishedRuleSet restarted = new PublishedRuleSet(compiler, rows);
    assertThat(restarted.version()).as("the restored rows boot normally").isPositive();
  }

  @Test
  void aPublishedRowWithNullParamsIsReportedAsInvalidInsteadOfServingV1(CapturedOutput output) {
    UUID published =
        jdbc.queryForObject(
            "SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'"
                + " ORDER BY effective_from DESC LIMIT 1",
            UUID.class);
    String original = paramsOf(published);

    try {
      jdbc.update(
          "UPDATE rule_row SET params = 'null'::jsonb"
              + " WHERE rule_set_version_id = ? AND code = 'U-01'",
          published);

      assertThatThrownBy(() -> new PublishedRuleSet(compiler, rows))
          .isInstanceOf(IllegalStateException.class)
          .hasMessageContaining("ShiftCircle will not start")
          .hasMessageContaining("U-01")
          .hasMessageContaining("Row values");
      assertThat(output)
          .as("the refusal is in the log, not only in the exception")
          .contains("is not valid, so ShiftCircle will not start")
          .contains("U-01");
    } finally {
      restore(published, original);
    }
  }

  private String paramsOf(UUID published) {
    return jdbc.queryForObject(
        "SELECT params::text FROM rule_row WHERE rule_set_version_id = ? AND code = 'U-01'",
        String.class,
        published);
  }

  private void restore(UUID published, String original) {
    jdbc.update(
        "UPDATE rule_row SET params = ?::jsonb WHERE rule_set_version_id = ? AND code = 'U-01'",
        original,
        published);
  }
}
