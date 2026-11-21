package ca.shiftcircle.rules;

import static ca.shiftcircle.rules.RuleTestSupport.evaluate;
import static ca.shiftcircle.rules.RuleTestSupport.schedule;
import static ca.shiftcircle.rules.RuleTestSupport.shift;
import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.build.ConsecutiveRunFactBuilder;
import ca.shiftcircle.rules.build.DaysOffFactBuilder;
import ca.shiftcircle.rules.build.LongShiftCountFactBuilder;
import ca.shiftcircle.rules.build.RollingHoursFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Boundary matrix for hours ceilings (U-05, U-14, U-15), consecutive work (U-08 to U-10), 16-hour
 * shift counts (U-11) and days off (U-12) — docs/10-testing.md §3. The D12/N12 cases prove the real
 * day/night 12 h crews are classified as 12 h and that N12 counts as an overnight across midnight.
 */
class HoursAndRunsRulesTest {

  private static List<RuleResult> results(String code, List<Object> facts) {
    return evaluate(facts.toArray()).stream()
        .filter(result -> result.ruleId().equals(code))
        .toList();
  }

  private static List<Object> cast(List<?> facts) {
    return new ArrayList<>(facts);
  }

  /** One shift on each consecutive day, starting at 07:00. */
  private static List<ShiftFact> daily(
      String employee, String template, String firstDate, int days, int minutes) {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < days; i++) {
      shifts.add(
          shift(employee, template, LocalDate.parse(firstDate).plusDays(i).toString(), "07:00", minutes));
    }
    return shifts;
  }

  // U-05: no more than 16 hours in any 24 hours ------------------------------------------------

  @Test
  void u05PassesForARosteredSixteenHourShift() {
    List<ShiftFact> shifts = schedule(shift("officer", "L16", "2026-11-19", "20:00", 960));

    assertThat(results("U-05", cast(new RollingHoursFactBuilder().build(shifts, 24)))).isEmpty();
  }

  @Test
  void u05BlocksWithAFifteenMinuteExtension() {
    List<ShiftFact> shifts = schedule(shift("officer", "L16", "2026-11-19", "20:00", 975));

    assertThat(results("U-05", cast(new RollingHoursFactBuilder().build(shifts, 24))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.actual()).isEqualTo(16.25);
              assertThat(result.required()).isEqualTo(16.0);
            });
  }

  // U-14: weekly ceiling, warn at 48 h, block at 60 h ------------------------------------------

  @Test
  void u14PassesAtExactlyFortyEightHours() {
    List<ShiftFact> shifts = daily("officer", "D8", "2026-11-16", 6, 480);

    assertThat(results("U-14", cast(new RollingHoursFactBuilder().build(shifts, 168)))).isEmpty();
  }

  @Test
  void u14WarnsAtFortyEightHoursFifteenMinutes() {
    List<ShiftFact> shifts = daily("officer", "D8", "2026-11-16", 5, 480);
    shifts.add(shift("officer", "D8", "2026-11-21", "07:00", 495));

    assertThat(results("U-14", cast(new RollingHoursFactBuilder().build(shifts, 168))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              // The warn branch reports the warn level, not the 60 h ceiling (review F6).
              assertThat(result.required()).isEqualTo(48.0);
              assertThat(result.actual()).isEqualTo(48.25);
            });
  }

  @Test
  void u14BlocksAtSixtyHoursFifteenMinutes() {
    List<ShiftFact> shifts = daily("officer", "D8", "2026-11-16", 6, 480);
    shifts.add(shift("officer", "D8", "2026-11-22", "07:00", 735));

    assertThat(results("U-14", cast(new RollingHoursFactBuilder().build(shifts, 168))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.actual()).isEqualTo(60.25);
            });
  }

  // U-08: at most 7 consecutive work days ------------------------------------------------------

  @Test
  void u08PassesAtSevenConsecutiveDays() {
    List<ShiftFact> shifts = daily("officer", "D8", "2026-11-16", 7, 480);

    assertThat(results("U-08", cast(new ConsecutiveRunFactBuilder().build(shifts)))).isEmpty();
  }

  @Test
  void u08BlocksAnEighthScheduledDay() {
    List<ShiftFact> shifts = daily("officer", "D8", "2026-11-16", 8, 480);

    assertThat(results("U-08", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.actual()).isEqualTo(8.0);
            });
  }

  @Test
  void u08WarnsWhenTheEighthDayIsPickedUpOvertime() {
    List<ShiftFact> shifts = daily("officer", "D8", "2026-11-16", 7, 480);
    shifts.add(
        shift("officer", "D8", "2026-11-23", "07:00", 480, ShiftKind.EXTRA, 0, true, true));

    assertThat(results("U-08", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN));
  }

  @Test
  void u08BlocksWhenAnOvertimeRunTiesAScheduledRun() {
    // Two eight-day runs: the first ends with a picked-up shift, the second is fully scheduled.
    // The scheduled run is the worse finding and must not be hidden by the tie (review F2).
    List<ShiftFact> shifts = new ArrayList<>(daily("officer", "D8", "2026-11-01", 7, 480));
    shifts.add(
        shift("officer", "D8", "2026-11-08", "07:00", 480, ShiftKind.EXTRA, 0, true, true));
    shifts.addAll(daily("officer", "D8", "2026-11-11", 8, 480));

    assertThat(results("U-08", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }

  // U-09: at most 4 consecutive 12-hour shifts ------------------------------------------------

  @Test
  void u09PassesAtFourConsecutiveTwelveHourShifts() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      shifts.add(
          shift("officer", "P12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "12:00", 720));
    }

    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(shifts)))).isEmpty();
  }

  @Test
  void u09BlocksAFifthScheduledTwelveHourShift() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      shifts.add(
          shift("officer", "P12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "12:00", 720));
    }

    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.actual()).isEqualTo(5.0);
            });
  }

  @Test
  void u09BlocksAFifthTwelveHourShiftEvenWhenItIsExtended() {
    // Kind comes from the pattern code: a P12 extended to 12 h 30 m is still a 12-hour shift (F5).
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      shifts.add(
          shift("officer", "P12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "12:00",
              i == 4 ? 750 : 720));
    }

    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.actual()).isEqualTo(5.0);
            });
  }

  @Test
  void u09BlocksWhenAFiveShiftScheduledRunTiesAnOvertimeRun() {
    List<ShiftFact> shifts = new ArrayList<>();
    // First run: five 12-hour shifts, the fifth picked up.
    for (int i = 0; i < 5; i++) {
      shifts.add(
          shift("officer", "P12", LocalDate.parse("2026-11-01").plusDays(i).toString(), "12:00", 720,
              i == 4 ? ShiftKind.EXTRA : ShiftKind.ROSTERED, 0, true, true));
    }
    // Second run, a week later: five scheduled 12-hour shifts — the worse finding.
    for (int i = 0; i < 5; i++) {
      shifts.add(
          shift("officer", "P12", LocalDate.parse("2026-11-11").plusDays(i).toString(), "12:00", 720));
    }

    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }

  @Test
  void u09WarnsWhenTheFifthShiftIsPickedUpOvertime() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      shifts.add(
          shift("officer", "P12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "12:00", 720));
    }
    shifts.add(
        shift("officer", "P12", "2026-11-20", "12:00", 720, ShiftKind.EXTRA, 0, true, true));

    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN));
  }

  // U-10: at most 4 consecutive overnight 12-hour shifts --------------------------------------

  @Test
  void u10PassesAtFourOvernightShiftsAndWarnsAtFive() {
    List<ShiftFact> four = new ArrayList<>();
    List<ShiftFact> five = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      ShiftFact nightShift =
          shift("officer", "A12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "00:00", 720);
      five.add(nightShift);
      if (i < 4) {
        four.add(nightShift);
      }
    }

    assertThat(results("U-10", cast(new ConsecutiveRunFactBuilder().build(four)))).isEmpty();
    assertThat(results("U-10", cast(new ConsecutiveRunFactBuilder().build(five))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.actual()).isEqualTo(5.0);
            });
  }

  // U-11: 3 sixteen-hour shifts in 7 days, 10 in 28 days --------------------------------------

  @Test
  void u11PassesAtThreeSixteenHourShiftsInSevenDays() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      shifts.add(
          shift("officer", "L16", LocalDate.parse("2026-11-16").plusDays(i).toString(), "20:00", 960));
    }

    assertThat(results("U-11", cast(new LongShiftCountFactBuilder().build(shifts)))).isEmpty();
  }

  @Test
  void u11WarnsAtAFourthSixteenHourShiftWithinSevenDays() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      shifts.add(
          shift("officer", "L16", LocalDate.parse("2026-11-16").plusDays(i).toString(), "20:00", 960));
    }

    assertThat(results("U-11", cast(new LongShiftCountFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.required()).isEqualTo(3.0);
              assertThat(result.actual()).isEqualTo(4.0);
            });
  }

  @Test
  void u11CountsAnExtendedSixteenHourShift() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      shifts.add(
          shift("officer", "L16", LocalDate.parse("2026-11-16").plusDays(i).toString(), "20:00",
              i == 3 ? 990 : 960));
    }

    assertThat(results("U-11", cast(new LongShiftCountFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN));
  }

  @Test
  void u11PassesWhenTheFourthShiftIsExactlySevenDaysAfterTheFirst() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int day : new int[] {0, 1, 2, 7}) {
      shifts.add(
          shift("officer", "L16", LocalDate.parse("2026-11-16").plusDays(day).toString(), "20:00", 960));
    }

    assertThat(results("U-11", cast(new LongShiftCountFactBuilder().build(shifts)))).isEmpty();
  }

  @Test
  void u11WarnsAtAnEleventhSixteenHourShiftWithinTwentyEightDays() {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int i = 0; i < 11; i++) {
      shifts.add(
          shift("officer", "L16", LocalDate.parse("2026-11-01").plusDays(2L * i).toString(), "20:00", 960));
    }

    assertThat(results("U-11", cast(new LongShiftCountFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              // Both limits can be breached at once; the evidence names both counts.
              assertThat(result.evidence()).contains("11 in 28 days");
            });
  }

  // U-12: two consecutive days off in seven ---------------------------------------------------

  @Test
  void u12PassesWithFortyEightHoursOff() {
    List<ShiftFact> shifts =
        schedule(
            shift("officer", "D8", "2026-11-16", "07:00", 480),
            shift("officer", "E8", "2026-11-18", "15:00", 480));

    assertThat(results("U-12", cast(new DaysOffFactBuilder().build(shifts)))).isEmpty();
  }

  @Test
  void u12CountsABreakOfTwentyFourHoursAsNoDayOff() {
    // A dense week with one 24 h break: that break is not even one day off.
    List<ShiftFact> shifts = new ArrayList<>(daily("officer", "D8", "2026-11-10", 7, 480));
    shifts.set(1, shift("officer", "D8", "2026-11-11", "15:00", 480));

    assertThat(new DaysOffFactBuilder().build(shifts))
        .singleElement()
        .satisfies(fact -> assertThat(fact.getCountedDaysOff()).isZero());
  }

  @Test
  void u12CountsABreakOfTwentyFourHoursOneMinuteAsOneDay() {
    List<ShiftFact> shifts = new ArrayList<>(daily("officer", "D8", "2026-11-10", 7, 480));
    shifts.set(1, shift("officer", "D8", "2026-11-11", "15:01", 480));

    assertThat(new DaysOffFactBuilder().build(shifts))
        .singleElement()
        .satisfies(fact -> assertThat(fact.getCountedDaysOff()).isEqualTo(1));
  }

  @Test
  void u12IgnoresALongBreakFromAnEarlierWeek() {
    // A 6-day break before the run cannot satisfy a window that is inside seven straight work days.
    List<ShiftFact> shifts = new ArrayList<>(schedule(shift("officer", "D8", "2026-11-01", "07:00", 480)));
    shifts.addAll(daily("officer", "D8", "2026-11-05", 7, 480));

    assertThat(results("U-12", cast(new DaysOffFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN));
  }

  @Test
  void u12CountsLeadingAndTrailingBreaksInTheWindow() {
    // One shift, with the rest of its 7-day window free: that is a real break, not zero.
    List<ShiftFact> shifts = schedule(shift("officer", "D8", "2026-11-10", "07:00", 480));

    assertThat(results("U-12", cast(new DaysOffFactBuilder().build(shifts)))).isEmpty();
  }

  @Test
  void u12WarnsWithFortySevenHoursFiftyNineMinutesOff() {
    List<ShiftFact> shifts = new ArrayList<>(daily("officer", "D8", "2026-11-10", 7, 480));
    shifts.add(shift("officer", "E8", "2026-11-18", "14:59", 480));

    assertThat(results("U-12", cast(new DaysOffFactBuilder().build(shifts))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN));
  }

  @Test
  void u12CountsDaysOffAtTheBreakBoundary() {
    assertThat(DaysOffFactBuilder.countedDaysOff(24.0)).isZero();
    assertThat(DaysOffFactBuilder.countedDaysOff(24.02)).isEqualTo(1);
    assertThat(DaysOffFactBuilder.countedDaysOff(47.98)).isEqualTo(1);
    assertThat(DaysOffFactBuilder.countedDaysOff(48.0)).isEqualTo(2);
  }

  // D12/N12: real day/night 12 h crews ---------------------------------------------------------

  @Test
  void d12AndN12AreTwelveHourKindsWithNominalSevenTwenty() {
    ShiftFact day = shift("officer", "D12", "2026-11-16", "07:00", 720);
    ShiftFact night = shift("officer", "N12", "2026-11-16", "19:00", 720);

    assertThat(day.isTwelveHour()).isTrue();
    assertThat(night.isTwelveHour()).isTrue();
    assertThat(day.nominalMinutes()).isEqualTo(720);
    assertThat(night.nominalMinutes()).isEqualTo(720);
    assertThat(day.isSixteenHour()).isFalse();
    assertThat(night.isSixteenHour()).isFalse();
  }

  @Test
  void u02WarnsAfterAnN12ThatEndsWhenTheD8Starts() {
    ShiftFact night = shift("officer", "N12", "2026-11-16", "19:00", 720);
    ShiftFact day = shift("officer", "D12", "2026-11-17", "07:00", 720);

    assertThat(results("U-02", cast(new ca.shiftcircle.rules.build.RestFactBuilder()
        .build(schedule(night, day)))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.evidence()).contains("N12").contains("D12");
            });
  }

  @Test
  void u09FourD12PassAndFiveBlock() {
    List<ShiftFact> four = new ArrayList<>();
    List<ShiftFact> five = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      ShiftFact shift =
          shift("officer", "D12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "07:00", 720);
      five.add(shift);
      if (i < 4) {
        four.add(shift);
      }
    }

    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(four)))).isEmpty();
    assertThat(results("U-09", cast(new ConsecutiveRunFactBuilder().build(five))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }

  @Test
  void u10FourN12PassAndFiveWarn() {
    List<ShiftFact> four = new ArrayList<>();
    List<ShiftFact> five = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      ShiftFact night =
          shift("officer", "N12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "19:00", 720);
      five.add(night);
      if (i < 4) {
        four.add(night);
      }
    }

    assertThat(results("U-10", cast(new ConsecutiveRunFactBuilder().build(four)))).isEmpty();
    assertThat(results("U-10", cast(new ConsecutiveRunFactBuilder().build(five))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.actual()).isEqualTo(5.0);
            });
  }

  @Test
  void u14CountsN12AcrossMidnightAndBlocksAboveSixtyHours() {
    List<ShiftFact> fourNights = new ArrayList<>();
    List<ShiftFact> fiveNights = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      ShiftFact night =
          shift("officer", "N12", LocalDate.parse("2026-11-16").plusDays(i).toString(), "19:00", 720);
      fiveNights.add(night);
      if (i < 4) {
        fourNights.add(night);
      }
    }
    // Four N12 = 48 h exactly: the warning level passes. Five = 60 h exactly: WARN, not yet Block.
    assertThat(results("U-14", cast(new RollingHoursFactBuilder().build(fourNights, 168)))).isEmpty();
    assertThat(results("U-14", cast(new RollingHoursFactBuilder().build(fiveNights, 168))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
              assertThat(result.actual()).isEqualTo(60.0);
            });

    fiveNights.add(shift("officer", "D8", "2026-11-21", "07:00", 480));
    assertThat(results("U-14", cast(new RollingHoursFactBuilder().build(fiveNights, 168))))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }

  @Test
  void u05PassesAtSixteenHoursForAD12ExtensionAndBlocksFifteenMinutesOver() {
    List<ShiftFact> sixteen =
        schedule(shift("officer", "D12", "2026-11-16", "07:00", 960));
    List<ShiftFact> over =
        schedule(shift("officer", "D12", "2026-11-16", "07:00", 975));

    assertThat(results("U-05", cast(new RollingHoursFactBuilder().build(sixteen, 24)))).isEmpty();
    assertThat(results("U-05", cast(new RollingHoursFactBuilder().build(over, 24))))
        .singleElement()
        .satisfies(
            result -> {
              assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
              assertThat(result.actual()).isEqualTo(16.25);
            });
  }
}
