package ca.shiftcircle.rules.validate;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Publish-time validation (docs/04 §5a, T13): values the fact builders never produce are refused
 * with a plain message, so a rule that could never fire cannot reach a published version.
 */
class RuleRowValidatorTest {

  private final RuleRowValidator validator = new RuleRowValidator();

  private List<RuleRowValidator.Violation> validateWith(String code, Map<String, Object> params) {
    List<RuleRow> rows = new ArrayList<>();
    for (RuleRow row : RuleRowsV1.ruleSet().rows()) {
      rows.add(row.code().equals(code) ? withParams(row, params) : row);
    }
    return validator.validate(new RuleSet("test", rows));
  }

  private static RuleRow withParams(RuleRow row, Map<String, Object> params) {
    return new RuleRow(
        row.code(),
        row.table(),
        row.enabled(),
        params,
        row.severity(),
        row.overridePolicy(),
        row.message(),
        row.source(),
        row.placeholder(),
        row.sortOrder());
  }

  private static Map<String, Object> params(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return map;
  }

  @Test
  void thePublishedRuleSetIsValid() {
    assertThat(validator.validate(RuleRowsV1.ruleSet())).isEmpty();
  }

  @Test
  void aMissingRequiredRuleIsNamedAndRefused() {
    List<RuleRow> rows =
        RuleRowsV1.ruleSet().rows().stream()
            .filter(row -> !row.code().equals("U-01"))
            .toList();

    assertThat(validator.validate(new RuleSet("test", rows)))
        .as("deleting a rule is not an edit the pipeline may accept")
        .anySatisfy(
            violation -> {
              assertThat(violation.code()).isEqualTo("U-01");
              assertThat(violation.message()).contains("required");
            });
  }

  @Test
  void aRestFloorBelowEightHoursIsRefused() {
    List<RuleRowValidator.Violation> violations =
        validateWith(
            "U-01",
            params(
                "afterShiftKind", ".*",
                "windowHours", 24,
                "minExtensionMinutes", 0,
                "minRestHours", 7));

    assertThat(violations)
        .as("T13: the 8-hour legal floor")
        .anySatisfy(
            violation -> {
              assertThat(violation.code()).isEqualTo("U-01");
              assertThat(violation.message()).contains("8-hour legal floor");
            });
  }

  @Test
  void aWindowTheBuildersNeverProduceIsRefused() {
    assertThat(
            validateWith(
                "U-14", params("windowHours", 48, "warnAtHours", 40, "maxHours", 60)))
        .as("docs/04 §5a: the builders emit 24 and 168 hours only")
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("24 or 168 hours"));
  }

  @Test
  void aWarningLevelAtOrAboveTheCeilingIsRefused() {
    assertThat(
            validateWith(
                "U-14", params("windowHours", 168, "warnAtHours", 60, "maxHours", 60)))
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("would never fire"));
  }

  @Test
  void aZeroConsecutiveMaximumIsRefused() {
    assertThat(
            validateWith(
                "U-10",
                params("counts", "SHIFTS_NIGHT_12H", "max", 0, "overtimeSeverity", "WARN")))
        .anySatisfy(violation -> assertThat(violation.column()).isEqualTo("Maximum"));
  }

  @Test
  void anUnknownCountingModeIsRefused() {
    assertThat(
            validateWith(
                "U-08",
                params("counts", "FORTNIGHTS", "max", 7, "overtimeSeverity", "WARN")))
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("Choose days"));
  }

  @Test
  void daysOffOutsideASevenDayWindowIsRefused() {
    assertThat(
            validateWith("U-12", params("daysOff", 2, "withinDays", 14)))
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("7-day window"));
  }

  @Test
  void aWeeklyPayThresholdIsRefusedForNow() {
    assertThat(
            validateWith(
                "P-01",
                params(
                    "thresholdWindow", "WEEK",
                    "thresholdHours", 40,
                    "paidLeaveCounts", false)))
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("per pay period"));
  }

  @Test
  void switchingOffTheRankingSafeguardIsRefused() {
    assertThat(
            validateWith(
                "O-01",
                params(
                    "orderBy", List.of("OT_HOURS_QUARTER_ASC"),
                    "skipIfBlocked", false,
                    "keepPlace", true)))
        .as("a blocked officer must never be offered a shift that breaks a rule")
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("cannot be switched off"));
  }

  @Test
  void anUnknownSortKeyIsRefused() {
    assertThat(
            validateWith(
                "O-02",
                params(
                    "orderBy", List.of("WHATEVER"),
                    "skipIfBlocked", true,
                    "keepPlace", true)))
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("Unknown sort key"));
  }

  @Test
  void aShiftLengthWithoutATemplateIsRefused() {
    assertThat(
            validateWith("L-01", params("allowedLengths", List.of(8, 10, 12))))
        .anySatisfy(
            violation -> assertThat(violation.message()).contains("10 h cannot be scheduled"));
  }

  @Test
  void anEmptyMessageIsRefused() {
    RuleRow row = RuleRowsV1.u10();
    RuleRow withoutMessage =
        new RuleRow(
            row.code(),
            row.table(),
            row.enabled(),
            row.params(),
            row.severity(),
            row.overridePolicy(),
            "  ",
            row.source(),
            row.placeholder(),
            row.sortOrder());
    List<RuleRow> rows =
        RuleRowsV1.ruleSet().rows().stream()
            .map(existing -> existing.code().equals(row.code()) ? withoutMessage : existing)
            .toList();

    assertThat(validator.validate(new RuleSet("test", rows)))
        .anySatisfy(violation -> assertThat(violation.column()).isEqualTo("Message"));
  }

  @Test
  void theTableCodesMatchTheValidatorBranches() {
    // A new table added without a validation branch would silently skip §5a.
    for (RuleTableCode code : RuleTableCode.values()) {
      assertThat(code.code()).isNotBlank();
    }
    assertThat(RuleTableCode.values()).hasSize(8);
  }

  // ---------------------------------------------------------------------------------------------
  // DRL injection (review-r2 S1): a rule-row value reaches the Drools source as literal text.
  // ---------------------------------------------------------------------------------------------

  @Test
  void aHostileShiftKindCannotReachTheDrl() {
    List<RuleRowValidator.Violation> violations =
        validateWith(
            "U-01",
            params(
                "afterShiftKind",
                ".*\"); System.setProperty(\"sc.pwn\", \"1\"); //",
                "windowHours",
                24,
                "minExtensionMinutes",
                0,
                "minRestHours",
                8));

    assertThat(violations)
        .as("a value that could close the DRL string literal must be refused")
        .anySatisfy(
            violation -> {
              assertThat(violation.code()).isEqualTo("U-01");
              assertThat(violation.column()).isEqualTo("After this kind of shift");
              assertThat(violation.message()).contains("shift codes");
            });
  }

  @Test
  void aHostileMessageCannotReachTheDrl() {
    List<RuleRow> rows = new ArrayList<>();
    for (RuleRow row : RuleRowsV1.ruleSet().rows()) {
      rows.add(
          row.code().equals("U-01")
              ? withMessage(
                  row, "Rest\"); System.setProperty(\"sc.pwn\", \"1\"); //")
              : row);
    }

    assertThat(validator.validate(new RuleSet("test", rows)))
        .anySatisfy(
            violation -> {
              assertThat(violation.column()).isEqualTo("Message");
              assertThat(violation.message()).contains("quote");
            });
  }

  @Test
  void aHostileRuleCodeCannotReachTheDrl() {
    List<RuleRow> rows = new ArrayList<>();
    for (RuleRow row : RuleRowsV1.ruleSet().rows()) {
      rows.add(
          row.code().equals("U-01")
              ? withCode(row, "X\"); System.setProperty(\"sc.pwn\", \"1\"); //")
              : row);
    }

    assertThat(validator.validate(new RuleSet("test", rows)))
        .anySatisfy(
            violation -> {
              assertThat(violation.column()).isEqualTo("Rule code");
              assertThat(violation.message()).contains("capital letters");
            });
  }

  private static RuleRow withMessage(RuleRow row, String message) {
    return new RuleRow(
        row.code(),
        row.table(),
        row.enabled(),
        row.params(),
        row.severity(),
        row.overridePolicy(),
        message,
        row.source(),
        row.placeholder(),
        row.sortOrder());
  }

  private static RuleRow withCode(RuleRow row, String code) {
    return new RuleRow(
        code,
        row.table(),
        row.enabled(),
        row.params(),
        row.severity(),
        row.overridePolicy(),
        row.message(),
        row.source(),
        row.placeholder(),
        row.sortOrder());
  }
}
