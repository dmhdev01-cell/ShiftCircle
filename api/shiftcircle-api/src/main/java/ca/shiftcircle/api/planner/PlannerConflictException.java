package ca.shiftcircle.api.planner;

/** A planner conflict with a machine reason and a person-readable sentence. */
public class PlannerConflictException extends RuntimeException {

  private final String reason;

  public PlannerConflictException(String reason, String message) {
    super(message);
    this.reason = reason;
  }

  public String reason() {
    return reason;
  }
}
