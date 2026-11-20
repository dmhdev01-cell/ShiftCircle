package ca.shiftcircle.rules.build;

import java.time.Duration;
import java.time.Instant;

/**
 * One shift as the rule engine sees it: enough to compute rest, hours, runs and shift-length
 * eligibility without touching the database or Spring.
 *
 * @param assignmentId assignment identifier, echoed in evidence
 * @param employeeId employee the shift belongs to
 * @param unitCode unit the shift is on
 * @param templateCode shift template code (D8, E8, N8, A12, P12, L16)
 * @param start start instant
 * @param end end instant
 * @param kind rostered or extra
 * @param extensionMinutes minutes added beyond the template length (0 for a plain shift)
 * @param unitAllows12h unit has a local agreement for 12-hour patterns (rule S-03)
 * @param unitAllows16h unit has a local agreement for 16-hour patterns (rule S-03)
 */
public record ShiftFact(
    String assignmentId,
    String employeeId,
    String unitCode,
    String templateCode,
    Instant start,
    Instant end,
    ShiftKind kind,
    int extensionMinutes,
    boolean unitAllows12h,
    boolean unitAllows16h) {

  public ShiftFact {
    if (!end.isAfter(start)) {
      throw new IllegalArgumentException("Shift " + assignmentId + " must end after it starts");
    }
  }

  public double hours() {
    return Duration.between(start, end).toMinutes() / 60.0;
  }

  public int durationMinutes() {
    return (int) Duration.between(start, end).toMinutes();
  }

  public boolean isTwelveHour() {
    return durationMinutes() == 720;
  }

  public boolean isSixteenHour() {
    return durationMinutes() == 960;
  }
}
