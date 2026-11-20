package ca.shiftcircle.api.payroll;

import java.util.List;

/** The period has ended shifts with no actual (ADR-017): the api names them and refuses. */
public class MissingActualsException extends RuntimeException {

  private final transient List<PayrollViews.MissingActual> missing;

  public MissingActualsException(List<PayrollViews.MissingActual> missing) {
    super(missing.size() + " shifts have no actual recorded");
    this.missing = List.copyOf(missing);
  }

  public List<PayrollViews.MissingActual> missing() {
    return missing;
  }
}
