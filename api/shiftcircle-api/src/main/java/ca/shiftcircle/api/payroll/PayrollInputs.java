package ca.shiftcircle.api.payroll;

import java.time.Instant;
import java.util.UUID;

/** Request bodies for recording actuals and absences (docs/07 §4.5). */
public final class PayrollInputs {

  private PayrollInputs() {}

  /**
   * One of: worked as scheduled, adjusted times, or an absence. The screen sends exactly one, the
   * same way the record-actual panel does.
   */
  public record RecordActual(
      Boolean workedAsScheduled, Instant actualStart, Instant actualEnd, String absence) {}

  /**
   * An absence against a rostered shift. The shift names the employee, unit and times, so the
   * absence can never float free of the assignment it covers.
   */
  public record Absence(UUID assignmentId, String type) {}

  public record Unlock(String reason) {}
}
