package ca.shiftcircle.infrastructure.demo;

/**
 * Seeding that needs more than this module has (the live rule engine), run on the fresh-boot path
 * right after {@link DemoDataGenerator} has generated Dataset 100 and before readiness flips. The
 * demo reset calls the same seeding itself, after it has reloaded the rules. v1.3 P5: the planted
 * demo proposals.
 */
public interface DemoSeedFollowUp {

  /** Called once after a fresh generation, with the generator seed. */
  void afterGenerate(long seed);
}
