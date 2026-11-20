package ca.shiftcircle.api.rulesets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ca.shiftcircle.api.config.PublishedRuleSet;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.rules.RuleCompilationException;
import ca.shiftcircle.rules.RuleSetCompiler;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * A compile failure must leave the compiler's detail in the log and only plain words on the screen.
 *
 * <p>The compiler message names generated classes and source positions, which is a compile oracle if
 * it reaches an admin. It is deliberately kept server-side (review-r2 S1) and this test pins that
 * the server side really receives it: without the log the refusal would hide the cause from
 * everybody.
 */
@ExtendWith(OutputCaptureExtension.class)
class RuleSetServiceCompileFailureTest {

  @Test
  void aCompileFailureIsLoggedWithItsDetailAndRefusedInPlainWords(CapturedOutput output) {
    UUID versionId = UUID.randomUUID();
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(anyString(), any(Object[].class)))
        .thenReturn(
            List.of(
                Map.of(
                    "id", versionId,
                    "version", 2,
                    "status", "DRAFT",
                    "based_on_version", 1,
                    "effective_from", Timestamp.from(Instant.parse("2026-11-20T00:00:00Z")),
                    "build_report", "null",
                    "drl_sha256", "",
                    "created_by", UUID.randomUUID())));
    RuleRowsRepository rows = mock(RuleRowsRepository.class);
    when(rows.rows(versionId, null)).thenReturn(RuleRowsV1.ruleSet().rows());
    RuleSetCompiler compiler = mock(RuleSetCompiler.class);
    when(compiler.compile(any()))
        .thenThrow(
            new RuleCompilationException(
                "compile oracle: org.drools.generated.Rules42 line 7: bad column"));
    RuleSetService service =
        new RuleSetService(jdbc, compiler, mock(PublishedRuleSet.class), rows);

    Logger ruleSetLogger = (Logger) LoggerFactory.getLogger(RuleSetService.class);
    ListAppender<ILoggingEvent> events = new ListAppender<>();
    events.start();
    ruleSetLogger.addAppender(events);
    RuleSetService.BuildReportView report;
    try {
      report =
          service.build(
              2,
              new AuthPrincipal("t.nakamura", "T. Nakamura", List.of("ADMIN"), List.of(), null));
    } finally {
      ruleSetLogger.detachAppender(events);
    }

    assertThat(report.errors())
        .containsExactly(
            "The rules did not compile. Fix the values in the table and build again.");
    assertThat(report.toString())
        .as("the compile oracle stays out of what the admin screen receives")
        .doesNotContain("compile oracle")
        .doesNotContain("org.drools");
    assertThat(output)
        .as("the operator gets the compiler's detail")
        .contains("rule set v2 did not compile")
        .contains("compile oracle")
        .contains("org.drools.generated.Rules42");

    ILoggingEvent compileFailure =
        events.list.stream()
            .filter(event -> event.getFormattedMessage().contains("did not compile"))
            .findFirst()
            .orElseThrow(() -> new AssertionError("no compile-failure log event"));
    assertThat(compileFailure.getLevel())
        .as("the refusal is a WARN, as docs/07 says, not INFO")
        .isEqualTo(Level.WARN);
    assertThat(compileFailure.getThrowableProxy().getMessage())
        .as("the level comes with the compiler's detail")
        .contains("compile oracle")
        .contains("org.drools.generated.Rules42");
  }
}
