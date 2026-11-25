package ca.shiftcircle.rules.facts;

import java.util.List;
import java.util.Set;

/**
 * Derived fact for the "Who can work a post" table (R-01, R-02): the position of the person on a
 * proposed shift, the kind of post the shift is on, and the qualifications the person holds that
 * day.
 *
 * <p>It is built beside the shift facts, not inside {@code ShiftFact}, so the other fact builders
 * are untouched (release v1.3).
 */
public class PostEligibilityFact {

  /** A post of a supervisor: a unit of kind {@code SUPERVISION}. */
  public static final String SUPERVISION = "SUPERVISION";

  /** Every other unit: an officer post. */
  public static final String LINE = "LINE";

  private final String employeeNo;
  private final String position;
  private final String postKind;
  private final String unitCode;
  private final Set<String> qualifications;
  private final String evidence;
  private final List<String> evidenceAssignmentIds;

  public PostEligibilityFact(
      String employeeNo,
      String position,
      String postKind,
      String unitCode,
      Set<String> qualifications,
      String evidence,
      String assignmentId) {
    this.employeeNo = employeeNo;
    this.position = position == null ? "" : position;
    this.postKind = postKind;
    this.unitCode = unitCode;
    this.qualifications = qualifications == null ? Set.of() : Set.copyOf(qualifications);
    this.evidence = evidence;
    this.evidenceAssignmentIds = List.of(assignmentId);
  }

  public String getEmployeeNo() {
    return employeeNo;
  }

  /** The position code ({@code CO}, {@code CS}); empty when it is not known. */
  public String getPosition() {
    return position;
  }

  /** {@link #SUPERVISION} or {@link #LINE}. */
  public String getPostKind() {
    return postKind;
  }

  public String getUnitCode() {
    return unitCode;
  }

  public Set<String> getQualifications() {
    return qualifications;
  }

  /** True when the person holds this qualification on the shift's date; false for a blank code. */
  public boolean holds(String qualification) {
    return qualification != null && !qualification.isBlank() && qualifications.contains(qualification);
  }

  public String getEvidence() {
    return evidence;
  }

  public List<String> getEvidenceAssignmentIds() {
    return evidenceAssignmentIds;
  }
}
