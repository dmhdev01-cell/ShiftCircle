package ca.shiftcircle.api.audit;

import ca.shiftcircle.api.security.ScopeGuard;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.format.annotation.DateTimeFormat.ISO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The audit trail, read only (docs/07 §4.8). There is deliberately no write verb. */
@RestController
@RequestMapping("/api/v1")
public class AuditController {

  private final AuditQuery audit;
  private final ScopeGuard scopeGuard;

  public AuditController(AuditQuery audit, ScopeGuard scopeGuard) {
    this.audit = audit;
    this.scopeGuard = scopeGuard;
  }

  /** The actors the caller can filter by; the same scope as the events themselves. */
  @GetMapping("/audit-events/actors")
  @PreAuthorize("hasAnyRole('AUDITOR','SUPERVISOR')")
  public List<AuditQuery.Actor> actors() {
    return audit.actors(scopeGuard.principal());
  }

  @GetMapping("/audit-events")
  @PreAuthorize("hasAnyRole('AUDITOR','SUPERVISOR')")
  public AuditQuery.Page events(
      @RequestParam(required = false) String actor,
      @RequestParam(required = false) String action,
      @RequestParam(required = false) String entityType,
      @RequestParam(required = false) UUID entityId,
      @RequestParam(required = false) @DateTimeFormat(iso = ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = ISO.DATE) LocalDate to,
      @RequestParam(required = false) Long beforeId,
      @RequestParam(required = false) Integer limit) {
    return audit.query(
        scopeGuard.principal(), actor, action, entityType, entityId, from, to, beforeId, limit);
  }
}
