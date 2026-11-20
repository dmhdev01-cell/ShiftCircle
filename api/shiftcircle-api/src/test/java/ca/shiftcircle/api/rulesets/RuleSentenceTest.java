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
  void theRestSentenceNamesTheShiftAndTheOutcomeInWords() {
    RuleRow u01 = rows.stream().filter(row -> "U-01".equals(row.code())).findFirst().orElseThrow();

    assertThat(RuleSentence.of(u01))
        .startsWith(
            "After any shift, an officer needs at least 8 hours off within 24 hours; otherwise"
                + " the change is blocked.");
  }
}
