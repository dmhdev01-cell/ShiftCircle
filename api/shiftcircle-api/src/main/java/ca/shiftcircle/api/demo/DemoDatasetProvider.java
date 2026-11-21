package ca.shiftcircle.api.demo;

/**
 * A selectable demo dataset. The reset clean-migrates the schema first, then asks the selected
 * provider to seed the dataset and return its checksum. The 100 provider wraps today's
 * {@code DemoDataGenerator}; a 120 provider (dev-build2) is a second bean that sets the unit
 * agreements it needs, seeds its crews, and returns the same checksum shape.
 */
public interface DemoDatasetProvider {

  /** Stable selector used in {@code POST /demo/reset {"dataset":"..."}}. */
  String dataset();

  /** Seed label recorded in the demo_reset audit row (the generator seed for the 100 dataset). */
  String seed();

  /** Runs after Flyway clean+migrate, before the rule base is reloaded and the checksum is read. */
  void seedData();

  /** Checksum of the assignment roster and schedule periods the reset produced. */
  String checksum();
}
