package ca.shiftcircle.rules.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.shiftcircle.rules.RuleCompilationException;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The translation from an admin-editable row to the template's columns. */
class TemplateColumnsTest {

  @Test
  void warnLevelAtOrAboveTheCeilingIsRefused() {
    RuleRow row =
        new RuleRow(
            "U-14",
            RuleTableCode.MAX_HOURS,
            true,
            Map.of("windowHours", 168, "warnAtHours", 60, "maxHours", 60),
            RuleOutcome.BLOCK,
            OverridePolicy.ACKNOWLEDGE,
            "Weekly ceiling",
            "MOCK",
            true,
            60);

    assertThatThrownBy(() -> TemplateColumns.of(row))
        .isInstanceOf(RuleCompilationException.class)
        .hasMessageContaining("warnAtHours")
        .hasMessageContaining("must be below maxHours");
  }

  @Test
  void theDefenceLayerRefusesHostileStringsAsACompileFailure() {
    RuleRow hostileCode =
        new RuleRow(
            "X\"); System.setProperty(\"sc.pwn\", \"1\"); //",
            RuleTableCode.REST,
            true,
            Map.of("afterShiftKind", ".*", "windowHours", 24, "minExtensionMinutes", 0,
                "minRestHours", 8),
            RuleOutcome.BLOCK,
            OverridePolicy.ACKNOWLEDGE,
            "Rest",
            "MOCK",
            false,
            10);
    assertThatThrownBy(() -> TemplateColumns.of(hostileCode))
        .as("a bypassed validator must still answer the pipeline's plain refusal")
        .isInstanceOf(RuleCompilationException.class);

    RuleRow hostileRegex =
        new RuleRow(
            "U-01",
            RuleTableCode.REST,
            true,
            Map.of("afterShiftKind", "(a+)+", "windowHours", 24, "minExtensionMinutes", 0,
                "minRestHours", 8),
            RuleOutcome.BLOCK,
            OverridePolicy.EMERGENCY,
            "Rest",
            "MOCK",
            true,
            10);
    assertThatThrownBy(() -> TemplateColumns.of(hostileRegex))
        .isInstanceOf(RuleCompilationException.class);
  }

  @Test
  void theShippedWarnLevelIsBelowTheCeiling() {
    Map<String, Object> columns = TemplateColumns.of(RuleRowsV1.u14());

    assertThat(columns).containsEntry("firstThreshold", 48.0).containsEntry("maxHours", 60.0);
  }
}
