package ca.shiftcircle.api.planner;

import java.time.LocalTime;

/**
 * The one place that turns a shift template row into the two preference dimensions: nominal length
 * and time of day. D12 is 12 h DAY and N12 is 12 h NIGHT because their template start/duration say
 * so, not because of a code list that forgot them. Used by the generator's scorecard, the compare
 * stats and the preferences endpoint.
 */
public final class ShiftKinds {

  private ShiftKinds() {}

  public static int lengthHours(int durationMinutes) {
    return durationMinutes / 60;
  }

  /**
   * DAY starts at 07:00, EVENING at 12:00 or 15:00, everything else is NIGHT. This keeps A12 00-12
   * and L16 20-12 as NIGHT, P12 12-24 as EVENING, D12 07-19 as DAY and N12 19-07 as NIGHT.
   */
  public static String timeOfDay(LocalTime start) {
    int hour = start.getHour();
    if (hour == 7) {
      return "DAY";
    }
    if (hour == 12 || hour == 15) {
      return "EVENING";
    }
    return "NIGHT";
  }

  public static String timeOfDay(java.sql.Time start) {
    return timeOfDay(start.toLocalTime());
  }

  public static boolean isNight(PlanGenerator.Template template) {
    return template != null && "NIGHT".equals(timeOfDay(template.start()));
  }
}
