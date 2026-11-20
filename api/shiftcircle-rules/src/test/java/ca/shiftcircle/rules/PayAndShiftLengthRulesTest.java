package ca.shiftcircle.rules;

import static ca.shiftcircle.rules.RuleTestSupport.evaluate;
import static ca.shiftcircle.rules.RuleTestSupport.schedule;
import static ca.shiftcircle.rules.RuleTestSupport.shift;
import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.build.PayFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftLengthFactBuilder;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.pay.PayClassification;
import ca.shiftcircle.rules.pay.PayClassifier;
import ca.shiftcircle.rules.pay.PayPolicy;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Boundary matrix for pay classification (P-01, P-01b, P-04) and shift lengths (L-01, S-03) —
 * docs/10-testing.md §3.
 */
class PayAndShiftLengthRulesTest {

  private final PayClassifier classifier = new PayClassifier();
  private final PayPolicy policy = new PayClassifier().policyFrom(RuleRowsV1.ruleSet());

  // P-01: overtime is hours beyond 80 in a two-week pay period --------------------------------

  @Test
  void p01TreatsEightyHoursAsRegular() {
    PayClassification classification = classifier.classify(80.0, policy);

    assertThat(classification.regularHours()).isEqualTo(80.0);
    assertThat(classification.overtimeHours()).isZero();
  }

  @Test
  void p01ClassifiesHalfAnHourBeyondTheThreshold() {
    PayClassification classification = classifier.classify(80.5, policy);

    assertThat(classification.regularHours()).isEqualTo(80.0);
    assertThat(classification.overtimeHours()).isEqualTo(0.5);
    assertThat(classification.rate()).isEqualTo(1.5);
  }

  @Test
  void p01TreatsRosteredHoursAndAPickedUpSixteenHourShiftAsDesigned() {
    // 96 h in the period: 80 regular, the remaining 16 (a picked-up 16 h shift) at 1.5x.
    PayClassification classification = classifier.classify(96.0, policy);

    assertThat(classification.regularHours()).isEqualTo(80.0);
    assertThat(classification.overtimeHours()).isEqualTo(16.0);

    // A period of 80 h that includes rostered 16 h shifts is all regular time.
    PayClassification rosteredOnly = classifier.classify(80.0, policy);
    assertThat(rosteredOnly.overtimeHours()).isZero();
  }

  // P-04: overtime under 30 minutes is unpaid -------------------------------------------------

  @Test
  void p04DoesNotPayTwentyNineMinutesOfOvertime() {
    PayClassification classification = classifier.classify(80 + 29.0 / 60.0, policy);

    assertThat(classification.overtimeMinutes()).isCloseTo(29.0, org.assertj.core.data.Offset.offset(0.01));
    assertThat(classification.overtimeHours()).isZero();
    assertThat(classification.regularHours()).isEqualTo(80.0);
  }

  @Test
  void p04PaysThirtyMinutesOfOvertime() {
    PayClassification classification = classifier.classify(80.5, policy);

    assertThat(classification.overtimeHours()).isEqualTo(0.5);
  }

  // The PAY rule reports the classification it applied ----------------------------------------

  @Test
  void payRuleReportsOneInfoResultForAPeriodWithOvertime() {
    PayClassification classification = classifier.classify(80.5, policy);
    var fact = new PayFactBuilder().build("Nia Thompson", classification, policy);

    List<RuleResult> results = evaluate(fact);

    assertThat(results)
        .filteredOn(result -> result.ruleId().equals("P-01"))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.INFO);
              assertThat(result.actual()).isEqualTo(80.5);
              assertThat(result.required()).isEqualTo(80.0);
              assertThat(result.overridePolicy())
                  .isEqualTo(ca.shiftcircle.rules.model.OverridePolicy.NONE);
            });
    // P-01b and P-04 are configuration rows: they produce no rules of their own.
    assertThat(results).noneMatch(result -> result.ruleId().equals("P-01b"));
    assertThat(results).noneMatch(result -> result.ruleId().equals("P-04"));
  }

  @Test
  void payRuleStaysSilentWhenThereIsNoOvertime() {
    var fact =
        new PayFactBuilder().build("Nia Thompson", classifier.classify(72.0, policy), policy);

    assertThat(evaluate(fact)).isEmpty();
  }

  // L-01 / S-03: shift lengths and unit eligibility -------------------------------------------

  @Test
  void l01AcceptsEightTwelveAndSixteenHourShifts() {
    List<ShiftFact> shifts =
        schedule(
            shift("officer", "D8", "2026-11-19", "07:00", 480),
            shift("officer", "P12", "2026-11-20", "12:00", 720),
            shift("officer", "L16", "2026-11-22", "20:00", 960));

    assertThat(evaluate(new ShiftLengthFactBuilder().build(shifts).toArray())).isEmpty();
  }

  @Test
  void l01BlocksAnUnexpectedShiftLength() {
    List<ShiftFact> shifts = schedule(shift("officer", "D10", "2026-11-19", "07:00", 600));

    assertThat(evaluate(new ShiftLengthFactBuilder().build(shifts).toArray()))
        .filteredOn(result -> result.ruleId().equals("L-01"))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }

  @Test
  void l01DoesNotBlockAnExtendedSixteenHourShift() {
    // The allowed length is the template's, not the worked duration (F5).
    List<ShiftFact> shifts =
        schedule(
            shift("officer", "L16", "2026-11-19", "20:00", 990,
                ca.shiftcircle.rules.build.ShiftKind.ROSTERED, 30, true, true));

    assertThat(evaluate(new ShiftLengthFactBuilder().build(shifts).toArray())).isEmpty();
  }

  @Test
  void s03BlocksASixteenHourShiftOnAUnitWithoutTheAgreement() {
    List<ShiftFact> shifts =
        schedule(
            shift(
                "officer", "L16", "2026-11-19", "20:00", 960, ca.shiftcircle.rules.build.ShiftKind.ROSTERED,
                0, true, false));

    assertThat(evaluate(new ShiftLengthFactBuilder().build(shifts).toArray()))
        .filteredOn(result -> result.ruleId().equals("S-03"))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.evidence()).contains("no local agreement");
            });
  }

  @Test
  void s03AllowsATwelveHourShiftWhereTheUnitHasTheAgreement() {
    List<ShiftFact> shifts =
        schedule(
            shift(
                "officer", "P12", "2026-11-19", "12:00", 720,
                ca.shiftcircle.rules.build.ShiftKind.ROSTERED, 0, true, false));

    assertThat(evaluate(new ShiftLengthFactBuilder().build(shifts).toArray())).isEmpty();
  }

  @Test
  void s03BlocksATwelveHourShiftWhereTheUnitHasNoAgreement() {
    List<ShiftFact> shifts =
        schedule(
            shift(
                "officer", "P12", "2026-11-19", "12:00", 720,
                ca.shiftcircle.rules.build.ShiftKind.ROSTERED, 0, false, false));

    assertThat(evaluate(new ShiftLengthFactBuilder().build(shifts).toArray()))
        .filteredOn(result -> result.ruleId().equals("S-03"))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }
}
