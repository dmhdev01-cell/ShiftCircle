package ca.shiftcircle.api.assignments;

import ca.shiftcircle.api.rules.ChangeRequest;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** {@code POST /api/v1/assignments}: save a shift after the rules agree (docs/07 §3). */
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
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("hasRole('SUPERVISOR')")
  public Map<String, Object> assign(@RequestBody ChangeRequest request, HttpServletRequest http) {
    AuthPrincipal principal = scopeGuard.principal();
    UUID id = assignments.assign(request, principal);
    return Map.of("id", id.toString(), "status", "PLANNED");
  }
}
