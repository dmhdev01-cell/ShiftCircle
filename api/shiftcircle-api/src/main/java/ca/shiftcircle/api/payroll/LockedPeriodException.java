package ca.shiftcircle.api.payroll;

/** A locked period is read-only until a supervisor unlocks it with a reason (ADR-017). */
public class LockedPeriodException extends RuntimeException {

  public LockedPeriodException() {
    super("This pay period is locked");
  }
}
