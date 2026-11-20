package ca.shiftcircle.api.assignments;

import ca.shiftcircle.api.rules.RuleCheckRequest;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/v1/assignments} saves a shift after the rules agree; {@code PATCH} moves it and
 * {@code DELETE} cancels it (docs/07 §3, §4.2). Every answer carries the row's new version as an
 * ETag.
 */
@RestController
@RequestMapping("/api/v1")
public class AssignmentController {

  private final AssignmentService assignments;
  private final ScopeGuard scopeGuard;

  public AssignmentController(AssignmentService assignments, ScopeGuard scopeGuard) {
    this.assignments = assignments;
    this.scopeGuard = scopeGuard;
  }

  @PostMapping("/assignments")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public ResponseEntity<AssignmentService.SaveView> assign(
      @RequestBody RuleCheckRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    AssignmentService.SaveView saved = assignments.assign(request, principal);
    return ResponseEntity.status(HttpStatus.CREATED)
        .eTag(etag(saved.version()))
        .body(saved);
  }

  @PatchMapping("/assignments/{id}")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public ResponseEntity<AssignmentService.MoveView> move(
      @PathVariable UUID id,
      @RequestHeader(value = "If-Match", required = false) String ifMatch,
      @RequestBody(required = false) RuleCheckRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    AssignmentService.MoveView moved = assignments.move(id, request, ifMatch, principal);
    return ResponseEntity.ok().eTag(etag(moved.version())).body(moved);
  }

  @DeleteMapping("/assignments/{id}")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public ResponseEntity<AssignmentService.CancelView> cancel(
      @PathVariable UUID id,
      @RequestHeader(value = "If-Match", required = false) String ifMatch,
      @RequestBody(required = false) AssignmentService.CancelRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    AssignmentService.CancelView cancelled = assignments.cancel(id, request, ifMatch, principal);
    return ResponseEntity.ok().eTag(etag(cancelled.version())).body(cancelled);
  }

  private static String etag(int version) {
    return "\"" + version + "\"";
  }
}
