package ca.shiftcircle.api.rules;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The change body shared by preview and save (docs/07 §3): {@code { "change": {...},
 * "acknowledgeWarnings": [...], "override": { "reason": "..." } }}.
 */
public record RuleCheckRequest(Change change, List<String> acknowledgeWarnings, Override override) {

  public record Change(
      String type, UUID employeeId, UUID unitId, String shiftTemplate, Instant startAt) {

    public String typeOrAssign() {
      return type == null ? "ASSIGN" : type;
    }
  }

  public record Override(String reason) {}
}
