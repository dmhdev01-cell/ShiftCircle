package ca.shiftcircle.api.rules;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A proposed schedule change (docs/07 §3) shared by preview and save. */
public record ChangeRequest(
    UUID employeeId,
    UUID unitId,
    String shiftTemplate,
    Instant startAt,
    String kind,
    List<String> acknowledgeWarnings,
    Override override) {

  public record Override(String reason) {}

  public String type() {
    return kind == null ? "ASSIGN" : kind;
  }
}
