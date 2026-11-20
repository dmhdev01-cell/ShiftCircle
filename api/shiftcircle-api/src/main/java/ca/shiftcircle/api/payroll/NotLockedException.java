package ca.shiftcircle.api.payroll;

/** The payroll export is only for a locked period, so its figures are frozen (ADR-016). */
public class NotLockedException extends RuntimeException {

  public NotLockedException(String message) {
    super(message);
  }
}
