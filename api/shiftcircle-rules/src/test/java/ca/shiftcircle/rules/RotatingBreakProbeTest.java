package ca.shiftcircle.rules;

import static ca.shiftcircle.rules.RuleTestSupport.shift;
import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.build.DaysOffFactBuilder;
import ca.shiftcircle.rules.build.RollingHoursFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.facts.RuleResult;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The wrap with a 3-day break (P3 amendments item 10): instead of the Sun-Mon pair that warns U-12,
 * the transition period takes Sunday-Monday-Tuesday off. Variant A keeps the other week's Sunday off
 * (80 h); variant B also takes the Saturday before (72 h). The probe reports warnings, hours per
 * period and weekends worked for all seven phases over the seven-period quarter.
 */
class RotatingBreakProbeTest {

  private static final LocalDate START = LocalDate.of(2027, 1, 4);
  private static final int DAYS = 7 * 14;

  @Test
  void variantAEightyHours() {
    report("A (80 h transition, break after six days)", 0);
  }

  @Test
  void variantBSeventyTwoHours() {
    report("B (72 h transition, break after six days)", 1);
  }

  @Test
  void variantCEightyHoursBreakAtStart() {
    report("C (80 h transition, break at start)", 2);
  }

  @Test
  void variantDSeventyTwoHoursBreakAtStart() {
    report("D (72 h transition, break at start)", 3);
  }

  @Test
  void variantESeventyTwoHoursSplitBreak() {
    report("E (72 h transition, 3-day then 2-day)", 4);
  }

  @Test
  void variantFSeventyTwoHoursSplitBreak() {
    report("F (72 h transition, 3-day then 2-day earlier)", 5);
  }

  @Test
  void fixedPairsForComparison() {
    List<Integer> weekends = new ArrayList<>();
    List<Double> averages = new ArrayList<>();
    for (int phase = 0; phase < 7; phase++) {
      List<ShiftFact> shifts = new ArrayList<>();
      for (int day = 0; day < DAYS; day++) {
        LocalDate date = START.plusDays(day);
        int weekDay = date.getDayOfWeek().getValue() - 1;
        if (weekDay == phase || weekDay == (phase + 1) % 7) {
          continue;
        }
        shifts.add(shift("officer", "D8", date.toString(), "07:00", 480));
      }
      weekends.add(weekends(shifts));
      averages.add(quarterAverage(shifts));
    }
    System.out.println(
        "fixed pairs: weekends "
            + weekends
            + " min/avg/max "
            + stats(weekends)
            + " quarter hours avg "
            + stats(averages));
    assertThat(averages).allMatch(hours -> hours == 80.0);
  }

  private void report(String label, int extraOffDay) {
    List<Integer> weekends = new ArrayList<>();
    List<Double> averages = new ArrayList<>();
    List<Double> allPeriodHours = new ArrayList<>();
    for (int phase = 0; phase < 7; phase++) {
      List<ShiftFact> shifts = new ArrayList<>();
      for (int day = 0; day < DAYS; day++) {
        LocalDate date = START.plusDays(day);
        int period = day / 14;
        int dayInPeriod = day % 14;
        int pair = Math.floorMod(phase - period, 7);
        if (pair == 6) {
          switch (extraOffDay) {
            case 0 -> {
              if (dayInPeriod == 6 || dayInPeriod == 7 || dayInPeriod == 8
                  || dayInPeriod == 13) {
                continue;
              }
            }
            case 1 -> {
              if (dayInPeriod == 6 || dayInPeriod == 7 || dayInPeriod == 8
                  || dayInPeriod == 12 || dayInPeriod == 13) {
                continue;
              }
            }
            case 2 -> {
              if (dayInPeriod == 0 || dayInPeriod == 1 || dayInPeriod == 2
                  || dayInPeriod == 13) {
                continue;
              }
            }
            case 3 -> {
              if (dayInPeriod == 0 || dayInPeriod == 1 || dayInPeriod == 2
                  || dayInPeriod == 12 || dayInPeriod == 13) {
                continue;
              }
            }
            case 4 -> {
              if (dayInPeriod == 0 || dayInPeriod == 1 || dayInPeriod == 2
                  || dayInPeriod == 9 || dayInPeriod == 10) {
                continue;
              }
            }
            default -> {
              if (dayInPeriod == 0 || dayInPeriod == 1 || dayInPeriod == 2
                  || dayInPeriod == 7 || dayInPeriod == 8) {
                continue;
              }
            }
          }
        } else {
          int weekDay = date.getDayOfWeek().getValue() - 1;
          if (weekDay == pair || weekDay == (pair + 1) % 7) {
            continue;
          }
        }
        shifts.add(shift("officer", "D8", date.toString(), "07:00", 480));
      }
      List<Double> periodHours = periodHours(shifts);
      allPeriodHours.addAll(periodHours);
      weekends.add(weekends(shifts));
      averages.add(quarterAverage(shifts));
      System.out.println(
          label
              + " phase "
              + phase
              + " period hours "
              + periodHours
              + " quarter "
              + quarterAverage(shifts)
              + " weekends "
              + weekends(shifts)
              + " warnings "
              + warnings(shifts));
    }
    System.out.println(
        label
            + " SUMMARY period hours min/avg/max "
            + stats(allPeriodHours)
            + " quarter avg min/avg/max "
            + stats(averages)
            + " weekends min/avg/max "
            + stats(weekends));
  }


  @Test
  void variantGNormalCycle() {
    reportG("G0 (6-state, no adjustment)", 0);
  }

  @Test
  void variantGThreeDayWrap() {
    reportG("G1 (6-state, 3-day wrap -> 72 h)", 1);
  }

  @Test
  void variantGFourDayWrap() {
    reportG("G2 (6-state, 4-day wrap -> 64 h)", 2);
  }

  @Test
  void decisionTable() {
    for (String option : new String[] {"F", "7_ON_3_OFF", "FIXED"}) {
      List<Integer> u12 = new ArrayList<>();
      List<Integer> u14 = new ArrayList<>();
      List<Double> allPeriods = new ArrayList<>();
      List<Double> quarters = new ArrayList<>();
      List<Integer> weekends = new ArrayList<>();
      for (int phase = 0; phase < 7; phase++) {
        List<ShiftFact> shifts =
            switch (option) {
              case "F" -> rotaF(phase);
              case "7_ON_3_OFF" -> rotaSevenThree(phase);
              default -> rotaFixed(phase);
            };
        List<RuleResult> warnings = warnings(shifts);
        u12.add((int) warnings.stream().filter(w -> w.ruleId().equals("U-12")).count());
        u14.add((int) warnings.stream().filter(w -> w.ruleId().equals("U-14")).count());
        allPeriods.addAll(periodHours(shifts));
        quarters.add(quarterAverage(shifts));
        weekends.add(weekends(shifts));
      }
      System.out.println(
          "TABLE "
              + option
              + " U-12 per officer "
              + stats(u12)
              + " U-14 per officer "
              + stats(u14)
              + " period hours "
              + stats(allPeriods)
              + " quarter avg "
              + stats(quarters)
              + " weekends "
              + stats(weekends));
    }
  }

  private List<ShiftFact> rotaG(int phase, int wrapMode) {
    List<ShiftFact> shifts = new ArrayList<>();
    int start = phase % 6;
    for (int day = 0; day < DAYS; day++) {
      int period = day / 14;
      int dayInPeriod = day % 14;
      int c = Math.floorMod(start - period, 6);
      int previous = Math.floorMod(start - (period - 1), 6);
      boolean wrap = period > 0 && c == 5 && previous == 0;
      boolean off;
      if (wrap && wrapMode > 0) {
        if (wrapMode == 1) {
          off = dayInPeriod == 5 || dayInPeriod == 6 || dayInPeriod == 7
              || dayInPeriod == 12 || dayInPeriod == 13;
        } else {
          off = dayInPeriod == 5 || dayInPeriod == 6 || dayInPeriod == 7
              || dayInPeriod == 11 || dayInPeriod == 12 || dayInPeriod == 13;
        }
      } else {
        int weekDay = START.plusDays(day).getDayOfWeek().getValue() - 1;
        off = weekDay == c || weekDay == (c + 1) % 7;
      }
      if (off) {
        continue;
      }
      shifts.add(shift("officer", "D8", START.plusDays(day).toString(), "07:00", 480));
    }
    return shifts;
  }

  private List<ShiftFact> rotaF(int phase) {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int day = 0; day < DAYS; day++) {
      int period = day / 14;
      int dayInPeriod = day % 14;
      int pair = Math.floorMod(phase - period, 7);
      if (pair == 6) {
        if (dayInPeriod == 0 || dayInPeriod == 1 || dayInPeriod == 2
            || dayInPeriod == 7 || dayInPeriod == 8) {
          continue;
        }
      } else {
        int weekDay = START.plusDays(day).getDayOfWeek().getValue() - 1;
        if (weekDay == pair || weekDay == (pair + 1) % 7) {
          continue;
        }
      }
      shifts.add(shift("officer", "D8", START.plusDays(day).toString(), "07:00", 480));
    }
    return shifts;
  }

  private List<ShiftFact> rotaSevenThree(int phase) {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int day = 0; day < DAYS; day++) {
      if (Math.floorMod(day + phase, 10) < 7) {
        shifts.add(shift("officer", "D8", START.plusDays(day).toString(), "07:00", 480));
      }
    }
    return shifts;
  }

  private List<ShiftFact> rotaFixed(int phase) {
    List<ShiftFact> shifts = new ArrayList<>();
    for (int day = 0; day < DAYS; day++) {
      int weekDay = START.plusDays(day).getDayOfWeek().getValue() - 1;
      if (weekDay == phase || weekDay == (phase + 1) % 7) {
        continue;
      }
      shifts.add(shift("officer", "D8", START.plusDays(day).toString(), "07:00", 480));
    }
    return shifts;
  }

  private void reportG(String label, int wrapMode) {
    List<Integer> weekends = new ArrayList<>();
    List<Double> averages = new ArrayList<>();
    List<Double> allPeriods = new ArrayList<>();
    List<Integer> u12 = new ArrayList<>();
    List<Integer> u14 = new ArrayList<>();
    for (int phase = 0; phase < 7; phase++) {
      List<ShiftFact> shifts = rotaG(phase, wrapMode);
      List<Double> hours = periodHours(shifts);
      allPeriods.addAll(hours);
      weekends.add(weekends(shifts));
      averages.add(quarterAverage(shifts));
      List<RuleResult> warnings = warnings(shifts);
      u12.add((int) warnings.stream().filter(w -> w.ruleId().equals("U-12")).count());
      u14.add((int) warnings.stream().filter(w -> w.ruleId().equals("U-14")).count());
      System.out.println(
          label + " phase " + phase + " hours " + hours + " quarter "
              + quarterAverage(shifts) + " weekends " + weekends(shifts)
              + " U-12 " + u12.get(u12.size() - 1) + " U-14 " + u14.get(u14.size() - 1));
    }
    System.out.println(
        label + " SUMMARY period " + stats(allPeriods)
            + " quarter " + stats(averages)
            + " weekends " + stats(weekends)
            + " U-12 " + stats(u12) + " U-14 " + stats(u14));
  }

  private static List<Double> stats(List<? extends Number> values) {
    double min = values.stream().mapToDouble(Number::doubleValue).min().orElse(0);
    double max = values.stream().mapToDouble(Number::doubleValue).max().orElse(0);
    double avg = values.stream().mapToDouble(Number::doubleValue).average().orElse(0);
    return List.of(min, Math.round(avg * 100.0) / 100.0, max);
  }

  private static List<Double> periodHours(List<ShiftFact> shifts) {
    List<Double> hours = new ArrayList<>();
    for (int period = 0; period < 7; period++) {
      LocalDate from = START.plusDays(period * 14L);
      LocalDate to = from.plusDays(13);
      hours.add(
          shifts.stream()
              .filter(
                  shift -> {
                    LocalDate date =
                        shift.start().atZone(ca.shiftcircle.rules.build.BusinessTime.REGINA)
                            .toLocalDate();
                    return !date.isBefore(from) && !date.isAfter(to);
                  })
              .mapToDouble(shift -> 8.0)
              .sum());
    }
    return hours;
  }

  private static double quarterAverage(List<ShiftFact> shifts) {
    return Math.round(shifts.size() * 8.0 / 7.0 * 100.0) / 100.0;
  }

  private static int weekends(List<ShiftFact> shifts) {
    return (int)
        shifts.stream()
            .filter(
                shift -> {
                  DayOfWeek day =
                      shift.start()
                          .atZone(ca.shiftcircle.rules.build.BusinessTime.REGINA)
                          .getDayOfWeek();
                  return day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY;
                })
            .count();
  }

  private static List<RuleResult> warnings(List<ShiftFact> shifts) {
    List<Object> facts = new ArrayList<>();
    facts.addAll(new DaysOffFactBuilder().build(new ArrayList<>(shifts)));
    facts.addAll(new RollingHoursFactBuilder().build(shifts, 168));
    facts.addAll(
        new ca.shiftcircle.rules.build.ConsecutiveRunFactBuilder().build(shifts));
    return RuleTestSupport.evaluate(facts.toArray()).stream()
        .filter(result -> "WARN".equals(result.outcome().name()))
        .toList();
  }
}
