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

  /**
   * The shift KIND is the pattern code, not the worked duration (review F5): a P12 extended by
   * 30 minutes is still a 12-hour shift for the consecutive and long-shift rules.
   */
  public boolean isTwelveHour() {
    return "A12".equals(templateCode) || "P12".equals(templateCode);
  }

  public boolean isSixteenHour() {
    return "L16".equals(templateCode);
  }

  /** Template length in minutes: 480, 720 or 960, before any extension. */
  public int nominalMinutes() {
    return switch (templateCode) {
      case "D8", "E8", "N8" -> 480;
      case "A12", "P12" -> 720;
      case "L16" -> 960;
      // An unknown code has no nominal length; reporting the worked duration lets L-01 reject it.
      default -> durationMinutes();
    };
  }

  /** Minutes worked beyond the template length, derived from the times. */
  public int workedExtensionMinutes() {
    return Math.max(extensionMinutes, durationMinutes() - nominalMinutes());
  }
}
