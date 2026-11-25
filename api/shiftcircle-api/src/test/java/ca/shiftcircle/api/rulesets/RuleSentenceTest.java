package ca.shiftcircle.api.rulesets;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The rules-admin/supervisor read-model (D6, found by the Playwright UI test): the plain-language
 * sentence must not leak the stored regex or the raw severity enum, and must read as a sentence.
 */
class RuleSentenceTest {

  private final List<RuleRow> rows = RuleRowsV1.ruleSet().rows();

  @Test
  void everyShippedRowReadsAsPlainLanguage() {
    assertThat(rows).isNotEmpty();
    for (RuleRow row : rows) {
      String sentence = RuleSentence.of(row);
      assertThat(sentence).as(row.code()).isNotBlank().endsWith(".");
      assertThat(Character.isLowerCase(sentence.charAt(0))).as(row.code()).isFalse();
      assertThat(sentence).as(row.code()).doesNotContain(".*");
      assertThat(sentence)
          .as(row.code())
          .doesNotContainPattern("\\b(is|are) (block|warn|info)\\b")
          .doesNotContainPattern("\\b(DAYS|SHIFTS_12H|SHIFTS_NIGHT_12H)\\b")
          .doesNotContain("  ")
          .doesNotContain("..");
      assertThat(sentence.toLowerCase())
          .as(row.code())
          .doesNotContainPattern("\\b(he|she|his|her)\\b");
    }
  }

  @Test
  void anAcknowledgeBlockSaysItCannotBeSaved() {
    for (String code : List.of("U-08", "U-09", "U-14")) {
      RuleRow row = rows.stream().filter(candidate -> code.equals(candidate.code())).findFirst().orElseThrow();
      assertThat(RuleSentence.of(row))
          .as(code)
          .contains("cannot be saved")
          .contains("no override")
          .doesNotContain("acknowledge");
    }
    RuleRow acknowledgeWarn =
        rows.stream()
            .filter(row -> row.overridePolicy() == ca.shiftcircle.rules.model.OverridePolicy.ACKNOWLEDGE)
            .filter(row -> row.severity() == ca.shiftcircle.rules.facts.RuleOutcome.WARN)
            .findFirst()
            .orElseThrow();
    assertThat(RuleSentence.of(acknowledgeWarn))
        .as(acknowledgeWarn.code())
        .contains("acknowledge");
  }

  /**
   * Release 4 #20: release 3 already fixed the wording, so this pins the three shipped Block +
   * ACKNOWLEDGE rows rather than re-fixing it. An acknowledgement cannot override a Block.
   */
  @Test
  void everyBlockThatAsksForAcknowledgementSaysItCannotBeSaved() {
    List<RuleRow> acknowledgeBlocks =
        rows.stream()
            .filter(row -> row.severity() == ca.shiftcircle.rules.facts.RuleOutcome.BLOCK)
            .filter(row -> row.overridePolicy() == ca.shiftcircle.rules.model.OverridePolicy.ACKNOWLEDGE)
            .toList();
    assertThat(acknowledgeBlocks)
        .extracting(RuleRow::code)
        .containsExactlyInAnyOrder("U-08", "U-09", "U-14");
    for (RuleRow row : acknowledgeBlocks) {
      assertThat(RuleSentence.of(row))
          .as(row.code())
          .contains("cannot be saved")
          .contains("no override")
          .doesNotContain("acknowledge");
    }
  }

  @Test
  void theRestSentenceNamesTheShiftAndTheOutcomeInWords() {
    RuleRow u01 = rows.stream().filter(row -> "U-01".equals(row.code())).findFirst().orElseThrow();

    assertThat(RuleSentence.of(u01))
        .startsWith(
            "After any shift, an officer needs at least 8 hours off within 24 hours; otherwise"
                + " the change is blocked.");
  }

  @Test
  void thePostRulesReadInPlainWords() {
    RuleRow r01 = rows.stream().filter(row -> "R-01".equals(row.code())).findFirst().orElseThrow();
    RuleRow r02 = rows.stream().filter(row -> "R-02".equals(row.code())).findFirst().orElseThrow();
    assertThat(RuleSentence.of(r01))
        .isEqualTo(
            "Only supervisors can work a supervisor post; anyone else is blocked. It cannot be"
                + " overridden. Someone with the Acting supervisor qualification is warned"
                + " instead, and a supervisor must acknowledge it.");
    assertThat(RuleSentence.of(r02))
        .isEqualTo(
            "Only officers can work an officer post; anyone else is warned. A supervisor must"
                + " acknowledge it before the change is saved.");
    // No stored code leaks into the words.
    assertThat(RuleSentence.of(r01) + RuleSentence.of(r02))
        .doesNotContain("SUPERVISION")
        .doesNotContain("LINE")
        .doesNotContain("ACTING_SUP")
        .doesNotContain("[");
  }
}
