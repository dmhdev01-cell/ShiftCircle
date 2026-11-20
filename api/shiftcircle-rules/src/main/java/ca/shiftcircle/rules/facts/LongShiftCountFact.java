package ca.shiftcircle.rules.facts;

/** Derived fact for rule U-11: how many 16-hour shifts fall in the rolling 7- and 28-day windows. */
public class LongShiftCountFact {

  private final int countIn7Days;
  private final int countIn28Days;
  private final String evidence;

  public LongShiftCountFact(int countIn7Days, int countIn28Days, String evidence) {
    this.countIn7Days = countIn7Days;
    this.countIn28Days = countIn28Days;
    this.evidence = evidence;
  }

  public int getCountIn7Days() {
    return countIn7Days;
  }

  public int getCountIn28Days() {
    return countIn28Days;
  }

  public String getEvidence() {
    return evidence;
  }

  @Override
  public String toString() {
    return "LongShiftCountFact[countIn7Days="
        + countIn7Days
        + ", countIn28Days="
        + countIn28Days
        + "]";
  }
}
