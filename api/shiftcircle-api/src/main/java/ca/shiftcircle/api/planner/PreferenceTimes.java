package ca.shiftcircle.api.planner;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * One place for the preference time-of-day set. The planner and the preference endpoints must agree
 * on what "asked", "met" and "night volunteer" mean, so the matching logic lives here, not in copies.
 *
 * <p>The stored set is canonical: DAY, EVENING, NIGHT in that order, no duplicates, empty = no
 * preference. The old single value maps to a one-element set (NONE or null to the empty set).
 */
public final class PreferenceTimes {

  public static final List<String> VALUES = List.of("DAY", "EVENING", "NIGHT");

  private PreferenceTimes() {}

  /** Uppercase, trim, drop duplicates and return canonical order; unknown or null values are refused. */
  public static List<String> normalize(List<String> input) {
    if (input == null) {
      return List.of();
    }
    Set<String> chosen = new LinkedHashSet<>();
    for (String value : input) {
      if (value == null) {
        throw new IllegalArgumentException("timesOfDay cannot contain null");
      }
      String normalized = value.trim().toUpperCase(Locale.ROOT);
      if (!VALUES.contains(normalized)) {
        throw new IllegalArgumentException(
            "timesOfDay must contain only DAY, EVENING or NIGHT");
      }
      chosen.add(normalized);
    }
    return VALUES.stream().filter(chosen::contains).toList();
  }

  /** The one-release compatibility input: DAY/EVENING/NIGHT to a singleton, NONE/null to empty. */
  public static List<String> fromLegacy(String timeOfDay) {
    if (timeOfDay == null || timeOfDay.isBlank() || "NONE".equalsIgnoreCase(timeOfDay.trim())) {
      return List.of();
    }
    return normalize(List.of(timeOfDay));
  }

  public static boolean asked(List<String> times) {
    return times != null && !times.isEmpty();
  }

  /** A shift is time-met when its start's time of day is any chosen part. */
  public static boolean matches(List<String> times, String shiftTime) {
    return asked(times) && times.contains(shiftTime);
  }

  /** Night volunteers are officers whose set contains NIGHT; the generator orders them first. */
  public static boolean nightVolunteer(List<String> times) {
    return asked(times) && times.contains("NIGHT");
  }

  /** An officer who asked for days or evenings (and not nights) is counted against a night wish. */
  public static boolean avoidsNights(List<String> times) {
    return asked(times) && !times.contains("NIGHT");
  }

  /** Day-vs-evening ranking: DAY first, then EVENING, then NIGHT or no preference. */
  public static int rank(List<String> times) {
    if (times == null) {
      return 2;
    }
    if (times.contains("DAY")) {
      return 0;
    }
    if (times.contains("EVENING")) {
      return 1;
    }
    return 2;
  }

  /**
   * The 8 h block preference. A day or evening part picks that block; a night-only or empty set
   * keeps the old default (NIGHT-only never matches DAY/EVENING, empty defaults to DAY).
   */
  public static String preferredBlock(List<String> times) {
    if (times == null || times.isEmpty()) {
      return "DAY";
    }
    if (times.contains("DAY")) {
      return "DAY";
    }
    if (times.contains("EVENING")) {
      return "EVENING";
    }
    return "NIGHT";
  }
}
