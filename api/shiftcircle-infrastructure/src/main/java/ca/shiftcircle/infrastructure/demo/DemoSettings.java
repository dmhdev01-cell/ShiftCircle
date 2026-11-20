package ca.shiftcircle.infrastructure.demo;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Fixed parameters of the demo dataset (docs/10-testing.md §6.1): the seed, the "today" the demo
 * pretends it is, and the 90-day window. Everything the generator produces derives from these, so
 * the same settings always produce the same dataset.
 */
public record DemoSettings(long seed, LocalDate today, LocalDate windowStart, LocalDate windowEnd) {

  public static final ZoneId REGINA = ZoneId.of("America/Regina");

  public static DemoSettings defaults() {
    return new DemoSettings(20261001L, LocalDate.of(2026, 11, 19), LocalDate.of(2026, 10, 1),
        LocalDate.of(2026, 12, 29));
  }

  public static DemoSettings of(String seed, String today, String windowStart, String windowEnd) {
    return new DemoSettings(
        Long.parseLong(seed), LocalDate.parse(today), LocalDate.parse(windowStart),
        LocalDate.parse(windowEnd));
  }

  public int days() {
    return (int) (windowEnd.toEpochDay() - windowStart.toEpochDay()) + 1;
  }
}
