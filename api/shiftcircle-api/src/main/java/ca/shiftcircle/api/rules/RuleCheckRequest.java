package ca.shiftcircle.api.rules;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * The change body shared by preview and save (docs/07 §3): {@code { "change": {...},
 * "acknowledgeWarnings": [...], "override": { "reason": "..." } }}.
 */
public record RuleCheckRequest(Change change, List<String> acknowledgeWarnings, Override override) {

  public record Change(
      String type, UUID employeeId, UUID unitId, String shiftTemplate, Instant startAt) {

    public String typeOrAssign() {
      if (type == null || type.isBlank()) {
        return "ASSIGN";
      }
      if (!"ASSIGN".equals(type) && !"EXTRA".equals(type)) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "The change type (type) must be ASSIGN or EXTRA");
      }
      return type;
    }
  }

  public record Override(String reason) {}
}
