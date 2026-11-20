package ca.shiftcircle.rules;

/** Raised when a rule template and its data rows do not compile into a usable rule base. */
public class RuleCompilationException extends RuntimeException {

  public RuleCompilationException(String message) {
    super(message);
  }
}
