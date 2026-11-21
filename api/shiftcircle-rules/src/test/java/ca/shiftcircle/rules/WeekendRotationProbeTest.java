package ca.shiftcircle.rules;

import static ca.shiftcircle.rules.RuleTestSupport.schedule;
import static ca.shiftcircle.rules.RuleTestSupport.shift;
import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.build.DaysOffFactBuilder;
import ca.shiftcircle.rules.build.RollingHoursFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.facts.RuleResult;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Weekend fairness (P3 amendment 9) against the real engine: an 8 h 5-on/2-off rota whose two days
 * off advance by {@code stride} weekdays each week. The probe records which rule warnings such a
 * rotation produces, so the generator design is chosen from evidence, not arithmetic.
 */
class WeekendRotationProbeTest {

  private static final LocalDate START = LocalDate.of(2027, 1, 4); // Monday

  @Test
  void aFixedDaysOffPairIsClean() {
    assertThat(warnings(0)).isEmpty();
  }

  @Test
  void advancingThePairCreatesRestDayWarnings() {
    for (int stride : new int[] {1, 2}) {
      List<RuleResult> warnings = warnings(stride);
      System.out.println(
          "stride "
              + stride
              + " -> "
              + warnings.stream()
                  .map(r -> r.ruleId() + " " + r.outcome() + ": " + r.evidence())
                  .toList());
      assertThat(warnings).as("stride %s", stride).isNotEmpty();
    }
  }

  @Test
  void aPairMovingEarlierOncePerPayPeriodIsCleanAtEightyHours() {
    List<ShiftFact> shifts = rotaEarlier(2);
    assertThat(warningsOf(shifts)).isEmpty();
    assertThat(periodHours(shifts)).containsOnly(80.0);
  }

  @Test
  void everyPhaseOfTheDefaultRotationIsClean() {
    for (int phase = 0; phase < 7; phase++) {
      List<ShiftFact> shifts = new ArrayList<>();
      for (int day = 0; day < 7 * 14; day++) {
        LocalDate date = START.plusDays(day);
        int period = day / 14;
        int pairStart = Math.floorMod(phase - period, 7);
        int weekDay = date.getDayOfWeek().getValue() - 1;
        if (weekDay == pairStart || weekDay == (pairStart + 1) % 7) {
          continue;
        }
        shifts.add(shift("officer", "D8", date.toString(), "07:00", 480));
      }
      assertThat(warningsOf(shifts)).as("phase %s", phase).isEmpty();
    }
  }

  @Test
  void movingThePairEarlierEveryWeekWarns() {
    assertThat(warningsOf(rotaEarlier(1))).isNotEmpty();
  }

  private List<Double> periodHours(List<ShiftFact> shifts) {
    List<Double> hours = new ArrayList<>();
    for (int week = 0; week < 8; week += 2) {
      LocalDate from = START.plusWeeks(week);
      LocalDate to = from.plusDays(13);
      hours.add(
          shifts.stream()
              .filter(
                  shift -> {
                    LocalDate date =
                        shift
                            .start()
                            .atZone(ca.shiftcircle.rules.build.BusinessTime.REGINA)
                            .toLocalDate();
                    return !date.isBefore(from) && !date.isAfter(to);
                  })
              .mapToDouble(shift -> 8.0)
              .sum());
    }
    return hours;
  }

  private List<ShiftFact> rotaEarlier(int cadenceWeeks) {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int week = 0; week < 8; week++) {
      int pairStart = Math.floorMod(5 - week / cadenceWeeks, 7); // starts Sat-Sun, retreats
      LocalDate monday = START.plusWeeks(week);
      for (int day = 0; day < 7; day++) {
        if (day == pairStart || day == (pairStart + 1) % 7) {
          continue;
        }
        shifts.add(
            shift("officer", "D8", monday.plusDays(day).toString(), "07:00", 480));
      }
    }
    return shifts;
  }

  private List<RuleResult> warningsOf(List<ShiftFact> shifts) {
    List<Object> facts = new ArrayList<>();
    facts.addAll(new DaysOffFactBuilder().build(schedule(shifts.toArray(ShiftFact[]::new))));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    return RuleTestSupport.evaluate(facts.toArray()).stream()
        .filter(result -> "U-12".equals(result.ruleId()) || "U-14".equals(result.ruleId()))
        .toList();
  }

  private List<RuleResult> warnings(int stride) {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int week = 0; week < 8; week++) {
      int pairStart = (week * stride) % 7;
      LocalDate monday = START.plusWeeks(week);
      for (int day = 0; day < 7; day++) {
        if (day == pairStart || day == (pairStart + 1) % 7) {
          continue;
        }
        LocalDate date = monday.plusDays(day);
        shifts.add(shift("officer", "D8", date.toString(), "07:00", 480));
      }
    }

    List<Object> facts = new ArrayList<>();
    facts.addAll(new DaysOffFactBuilder().build(schedule(shifts.toArray(ShiftFact[]::new))));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    return RuleTestSupport.evaluate(facts.toArray()).stream()
        .filter(result -> "U-12".equals(result.ruleId()) || "U-14".equals(result.ruleId()))
        .toList();
  }
}
