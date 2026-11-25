package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.PostEligibilityFact;
import java.util.Set;

/**
 * Builds the post-eligibility fact (R-01, R-02) for one proposed shift: who is on it (their
 * position and qualifications) and what kind of post it is.
 *
 * <p>Only the proposed shift gets one. A person's existing shifts were checked when they were
 * made, and the other rules need nothing about posts.
 */
public final class PostEligibilityFactBuilder {

  /**
   * @param shift the proposed shift (its employee number, unit code and id are reused)
   * @param position the person's position code, {@code CO} or {@code CS}
   * @param qualifications the qualification codes the person holds on the shift's date
   * @param unitKind the unit's kind; {@code SUPERVISION} is a supervisor post, every other kind is
   *     an officer post
   */
  public PostEligibilityFact build(
      ShiftFact shift, String position, Set<String> qualifications, String unitKind) {
    String postKind =
        PostEligibilityFact.SUPERVISION.equals(unitKind)
            ? PostEligibilityFact.SUPERVISION
            : PostEligibilityFact.LINE;
    Set<String> held = qualifications == null ? Set.of() : qualifications;
    String evidence =
        String.format(
            "%s is %s, on %s (%s)%s",
            shift.employeeId(),
            who(position),
            shift.unitCode(),
            PostEligibilityFact.SUPERVISION.equals(postKind)
                ? "a supervisor post"
                : "an officer post",
            held.contains("ACTING_SUP") ? "; holds Acting supervisor" : "");
    return new PostEligibilityFact(
        shift.employeeId(),
        position,
        postKind,
        shift.unitCode(),
        held,
        evidence,
        shift.assignmentId());
  }

  private static String who(String position) {
    if ("CS".equals(position)) {
      return "a supervisor";
    }
    if ("CO".equals(position)) {
      return "an officer";
    }
    return position == null || position.isBlank() ? "of no known position" : "a " + position;
  }
}
