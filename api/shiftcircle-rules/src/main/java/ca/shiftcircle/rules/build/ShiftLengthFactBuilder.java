package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.ShiftLengthFact;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Builds the shift-length facts (L-01, S-03): the shift's length, and whether the unit's local
 * agreement allows that pattern. A plain 8-hour shift is allowed everywhere.
 */
public final class ShiftLengthFactBuilder {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  public List<ShiftLengthFact> build(List<ShiftFact> shifts) {
    List<ShiftLengthFact> facts = new ArrayList<>();
    for (ShiftFact shift : shifts) {
      facts.add(fact(shift));
    }
    return facts;
  }

  private ShiftLengthFact fact(ShiftFact shift) {
    int nominal = shift.nominalMinutes();
    boolean allowed;
    if (nominal == 480) {
      allowed = true;
    } else if (nominal == 720) {
      allowed = shift.unitAllows12h();
    } else if (nominal == 960) {
      allowed = shift.unitAllows16h();
    } else {
      allowed = false;
    }

    String evidence =
        String.format(
            "%s of %d min%s on unit %s%s",
            shift.templateCode(),
            nominal,
            shift.workedExtensionMinutes() > 0
                ? " plus " + shift.workedExtensionMinutes() + " min"
                : "",
            shift.unitCode(),
            allowed ? "" : " (no local agreement for that pattern)");
    int hour = shift.start().atZone(REGINA).getHour();
    boolean night = hour >= 23 || hour < 7;
    return new ShiftLengthFact(
        shift.templateCode(),
        shift.durationMinutes(),
        nominal,
        allowed,
        night,
        evidence,
        shift.assignmentId());
  }
}
