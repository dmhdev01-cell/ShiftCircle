package ca.shiftcircle.api.payroll;

/** Adjusted times outside a day either side of the rostered shift are a typo, not an actual. */
public class InvalidActualWindowException extends RuntimeException {

  public InvalidActualWindowException(String message) {
    super(message);
  }
}
