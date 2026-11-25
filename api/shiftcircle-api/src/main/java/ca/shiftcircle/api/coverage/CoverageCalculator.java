package ca.shiftcircle.api.coverage;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * ADR-013/ADR-017 hourly coverage: a block is covered only when every hour in it meets the
 * requirement, so the result carries the lowest count and the short hour ranges rather than one
 * block average.
 *
 * <p>A block spans absolute hours: the night block on date D runs from 23:00 D to 07:00 D+1. A shift
 * that crosses midnight is therefore counted in both days' blocks where it is actually present, which
 * a per-start-date count would miss.
 */
public final class CoverageCalculator {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  /**
   * A block's hours on its day: from {@code fromHour} to {@code toHour} (31 = 07:00 the next day).
   * The one place the block windows are defined; the board's "Supervisor on duty" line uses them too.
   */
  public record Window(String code, int fromHour, int toHour) {}

  public static final List<Window> BLOCKS =
      List.of(new Window("DAY", 7, 15), new Window("EVENING", 15, 23), new Window("NIGHT", 23, 31));

  /** One shift or actual entry, in absolute time. */
  public record Interval(Instant start, Instant end) {}

  public record ShortHour(String from, String to, int count) {}

  public record HourlyCoverage(int lowestHourly, List<ShortHour> shortHours, int maxHourly) {}

  public record BlockCoverage(
      String block, LocalDate date, int required, HourlyCoverage coverage, boolean covered) {}

  public List<BlockCoverage> forDay(
      LocalDate date, Map<String, Integer> required, List<Interval> intervals) {
    List<BlockCoverage> blocks = new ArrayList<>();
    for (Window window : BLOCKS) {
      blocks.add(
          block(window.code(), date, window.fromHour(), window.toHour(),
              required.getOrDefault(window.code(), 0), intervals));
    }
    return blocks;
  }

  private BlockCoverage block(
      String code,
      LocalDate date,
      int fromHour,
      int toHour,
      int required,
      List<Interval> intervals) {
    int lowest = Integer.MAX_VALUE;
    int highest = 0;
    List<ShortHour> shortHours = new ArrayList<>();
    int runStart = -1;
    int runCount = Integer.MAX_VALUE;

    for (int hour = fromHour; hour < toHour; hour++) {
      Instant hourStart = date.atStartOfDay(REGINA).plus(Duration.ofHours(hour)).toInstant();
      Instant hourEnd = hourStart.plus(Duration.ofHours(1));
      int count = 0;
      for (Interval interval : intervals) {
        if (interval.start().isBefore(hourEnd) && interval.end().isAfter(hourStart)) {
          count++;
        }
      }
      lowest = Math.min(lowest, count);
      highest = Math.max(highest, count);
      if (count < required) {
        if (runStart < 0) {
          runStart = hour;
          runCount = count;
        } else {
          runCount = Math.min(runCount, count);
        }
      } else if (runStart >= 0) {
        shortHours.add(shortHour(runStart, hour, runCount));
        runStart = -1;
        runCount = Integer.MAX_VALUE;
      }
    }
    if (runStart >= 0) {
      shortHours.add(shortHour(runStart, toHour, runCount));
    }

    HourlyCoverage coverage =
        new HourlyCoverage(lowest == Integer.MAX_VALUE ? 0 : lowest, shortHours, highest);
    return new BlockCoverage(code, date, required, coverage, shortHours.isEmpty());
  }

  private static ShortHour shortHour(int fromHour, int toHour, int count) {
    return new ShortHour(hourLabel(fromHour), hourLabel(toHour), count);
  }

  private static String hourLabel(int hour) {
    return String.format("%02d:00", hour % 24);
  }
}
