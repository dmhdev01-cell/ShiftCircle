package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.units.UnitsViews;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The plan inputs' staffing floor: the stretch that needs the most officers, earliest on a tie. */
class PlanInputsNeededTest {

  private static UnitsViews.StaffingPeriod period(String from, String to, int needed) {
    return new UnitsViews.StaffingPeriod(
        LocalDate.parse(from), LocalDate.parse(to), List.of(),
        new UnitsViews.StaffingTotals(0, 0, needed, 0));
  }

  @Test
  void picksTheStretchThatNeedsTheMost() {
    PlanInputs.Needed needed =
        PlanInputs.needed(
            List.of(period("2027-01-04", "2027-02-14", 104), period("2027-02-15", "2027-04-11", 127)));
    assertThat(needed).isEqualTo(
        new PlanInputs.Needed(127, LocalDate.parse("2027-02-15"), LocalDate.parse("2027-04-11"), 2));
  }

  @Test
  void keepsTheEarliestStretchOnATieWhateverTheOrder() {
    List<UnitsViews.StaffingPeriod> periods =
        List.of(
            period("2027-03-01", "2027-04-11", 127),
            period("2027-01-04", "2027-02-14", 127),
            period("2027-02-15", "2027-02-28", 90));
    assertThat(PlanInputs.needed(periods).from()).isEqualTo(LocalDate.parse("2027-01-04"));
    assertThat(PlanInputs.needed(periods).periods()).isEqualTo(3);
  }

  @Test
  void noPeriodsMeansNoFloor() {
    assertThat(PlanInputs.needed(List.of())).isNull();
  }
}
