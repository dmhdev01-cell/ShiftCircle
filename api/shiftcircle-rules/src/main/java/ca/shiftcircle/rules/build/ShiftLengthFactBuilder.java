package ca.shiftcircle.rules.build;

import ca.shiftcircle.rules.facts.ShiftLengthFact;
import java.util.ArrayList;
import java.util.List;

/**
 * Builds the shift-length facts (L-01, S-03): the shift's length, and whether the unit's local
 * agreement allows that pattern. A plain 8-hour shift is allowed everywhere.
 */
public final class ShiftLengthFactBuilder {

  public List<ShiftLengthFact> build(List<ShiftFact> shifts) {
    List<ShiftLengthFact> facts = new ArrayList<>();
    for (ShiftFact shift : shifts) {
      facts.add(fact(shift));
    }
    return facts;
  }

  private ShiftLengthFact fact(ShiftFact shift) {
    boolean allowed;
    if (shift.durationMinutes() == 480) {
      allowed = true;
    } else if (shift.isTwelveHour()) {
      allowed = shift.unitAllows12h();
    } else if (shift.isSixteenHour()) {
      allowed = shift.unitAllows16h();
    } else {
      allowed = false;
    }

    String evidence =
        String.format(
            "%s (%s) of %d min on unit %s%s",
            shift.templateCode(),
            shift.assignmentId(),
            shift.durationMinutes(),
            shift.unitCode(),
            allowed ? "" : " (no local agreement for that pattern)");
    return new ShiftLengthFact(shift.templateCode(), shift.durationMinutes(), allowed, evidence);
  }
}
