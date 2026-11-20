package ca.shiftcircle.api.overtime;

/**
 * The officer cannot take this shift at all: unqualified for the unit or already scheduled over it.
 *
 * <p>The ranked list shows this as {@code UNAVAILABLE}; the same gate must run on offer, confirm and
 * direct assign, or the list would be display-only (review-r1 F1).
 */
public class CandidateUnavailableException extends RuntimeException {

  public CandidateUnavailableException(String reason) {
    super(reason);
  }
}
