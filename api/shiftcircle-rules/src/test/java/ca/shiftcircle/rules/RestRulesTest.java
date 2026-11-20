package ca.shiftcircle.rules;

import static ca.shiftcircle.rules.RuleTestSupport.schedule;
import static ca.shiftcircle.rules.RuleTestSupport.shift;
import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.build.BusinessTime;
import ca.shiftcircle.rules.build.RestFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.model.OverridePolicy;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Boundary matrix for the rest table (docs/10-testing.md §3): U-01, U-02, U-03 and U-04, each just
 * under, exactly at, and (where a limit is one-sided) just over.
 */
class RestRulesTest {

  private static List<RuleResult> restResults(ShiftFact... shifts) {
    return new RestFactBuilder().build(schedule(shifts)).stream()
        .flatMap(fact -> RuleTestSupport.evaluate(fact).stream())
        .toList();
  }

  private static List<RuleResult> results(String code, ShiftFact... shifts) {
    return restResults(shifts).stream().filter(result -> result.ruleId().equals(code)).toList();
  }

  // U-01: at least 8 hours of rest in any 24 hours ---------------------------------------------

  @Test
  void u01BlocksWithSevenHoursFiftyNineMinutesRest() {
    ShiftFact day = shift("officer", "D8", "2026-11-19", "07:00", 480);
    ShiftFact next = shift("officer", "N8", "2026-11-19", "22:59", 480);

    assertThat(results("U-01", day, next))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.required()).isEqualTo(8.0);
              assertThat(result.actual()).isCloseTo(7.98, org.assertj.core.data.Offset.offset(0.01));
              assertThat(result.overridePolicy()).isEqualTo(OverridePolicy.EMERGENCY);
              assertThat(result.ruleSetVersion()).isEqualTo("v1");
              assertThat(result.evidence())
                  .contains("D8 ending")
                  .contains("next shift N8 starts")
                  .doesNotContainPattern(
                      "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
            });
  }

  @Test
  void u01PassesAtExactlyEightHours() {
    ShiftFact day = shift("officer", "D8", "2026-11-19", "07:00", 480);
    ShiftFact evening = shift("officer", "E8", "2026-11-19", "23:00", 480);

    assertThat(results("U-01", day, evening)).isEmpty();
  }

  @Test
  void u01PassesJustOverEightHours() {
    ShiftFact day = shift("officer", "D8", "2026-11-19", "07:00", 480);
    ShiftFact evening = shift("officer", "N8", "2026-11-19", "23:01", 480);

    assertThat(results("U-01", day, evening)).isEmpty();
  }

  // U-02: target 12 hours between regular shifts -----------------------------------------------

  @Test
  void u02WarnsAtElevenHoursFiftyNineMinutesAfterARegularShift() {
    ShiftFact day = shift("officer", "D8", "2026-11-19", "07:00", 480);
    ShiftFact night = shift("officer", "N8", "2026-11-20", "02:59", 480);

    assertThat(results("U-02", day, night))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.required()).isEqualTo(12.0);
            });
  }

  @Test
  void u02PassesAtExactlyTwelveHours() {
    ShiftFact day = shift("officer", "D8", "2026-11-19", "07:00", 480);
    ShiftFact night = shift("officer", "N8", "2026-11-20", "03:00", 480);

    assertThat(results("U-02", day, night)).isEmpty();
  }

  @Test
  void u02DoesNotApplyAfterSixteenHourShifts() {
    ShiftFact longShift =
        shift("officer", "L16", "2026-11-19", "20:00", 960, ShiftKind.ROSTERED, 0, true, true);
    ShiftFact next = shift("officer", "D8", "2026-11-21", "00:00", 480);

    assertThat(results("U-02", longShift, next)).isEmpty();
  }

  // U-03: 12 hours after a 16-hour shift -------------------------------------------------------

  @Test
  void u03BlocksAtElevenHoursFiftyNineMinutesAfterASixteenHourShift() {
    ShiftFact longShift =
        shift("officer", "L16", "2026-11-19", "20:00", 960, ShiftKind.ROSTERED, 0, true, true);
    ShiftFact next = shift("officer", "D8", "2026-11-20", "23:59", 480);

    assertThat(results("U-03", longShift, next))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.required()).isEqualTo(12.0);
              assertThat(result.overridePolicy()).isEqualTo(OverridePolicy.EMERGENCY);
            });
  }

  @Test
  void u03PassesAtExactlyTwelveHours() {
    ShiftFact longShift =
        shift("officer", "L16", "2026-11-19", "20:00", 960, ShiftKind.ROSTERED, 0, true, true);
    ShiftFact next = shift("officer", "D8", "2026-11-21", "00:00", 480);

    assertThat(results("U-03", longShift, next)).isEmpty();
  }

  // U-04: 10 hours after an overtime extension of 4 hours or more ------------------------------

  @Test
  void u04WarnsAfterAFourHourExtensionWithNineHoursFiftyNineMinutesRest() {
    ShiftFact extended =
        shift("officer", "D8", "2026-11-19", "07:00", 720, ShiftKind.EXTRA, 240, true, true);
    ShiftFact next = shift("officer", "E8", "2026-11-20", "04:59", 480);

    assertThat(results("U-04", extended, next))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.required()).isEqualTo(10.0);
            });
  }

  @Test
  void u04PassesAtExactlyTenHours() {
    ShiftFact extended =
        shift("officer", "D8", "2026-11-19", "07:00", 720, ShiftKind.EXTRA, 240, true, true);
    ShiftFact next = shift("officer", "E8", "2026-11-20", "05:00", 480);

    assertThat(results("U-04", extended, next)).isEmpty();
  }

  @Test
  void u04DoesNotTriggerForAnExtensionOfThreeHoursFiftyNineMinutes() {
    ShiftFact extended =
        shift("officer", "D8", "2026-11-19", "07:00", 719, ShiftKind.EXTRA, 239, true, true);
    ShiftFact next = shift("officer", "E8", "2026-11-20", "02:59", 480);

    // 8 hours of rest: U-01 passes at its exact floor, U-02 warns, and U-04 does not trigger.
    assertThat(results("U-04", extended, next)).isEmpty();
    assertThat(results("U-01", extended, next)).isEmpty();
  }

  // Time zones and date boundaries --------------------------------------------------------------

  @Test
  void restMathsCrossesMonthEndAndMidnight() {
    ShiftFact night = shift("officer", "N8", "2026-10-31", "23:00", 480);
    ShiftFact next = shift("officer", "E8", "2026-11-01", "19:00", 480);

    assertThat(restResults(night, next)).isEmpty();
  }

  @Test
  void aTwelveHourShiftEndsAtMidnightNotOneMinuteBefore() {
    ShiftFact daytime = shift("officer", "P12", "2026-11-19", "12:00", 720);
    ShiftFact nextDay = shift("officer", "N8", "2026-11-20", "23:00", 480);

    // 12:00 + 12 h is exactly 00:00 the next day; the next shift is 23 h later.
    assertThat(daytime.end()).isEqualTo(BusinessTime.at("2026-11-19", "12:00").plusSeconds(43_200));
    assertThat(daytime.end().atZone(BusinessTime.REGINA).toLocalDate()).isEqualTo(LocalDate.of(2026, 11, 20));
    assertThat(restResults(daytime, nextDay)).isEmpty();
  }
}
