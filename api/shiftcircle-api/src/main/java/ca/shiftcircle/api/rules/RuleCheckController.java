package ca.shiftcircle.api.rules;

import ca.shiftcircle.api.assignments.AssignmentService;
import ca.shiftcircle.api.security.ScopeGuard;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code POST /api/v1/rule-checks}: preview any change, save nothing (docs/07 §3). */
@RestController
@RequestMapping("/api/v1")
public class RuleCheckController {

  private final AssignmentService assignments;
  private final ScopeGuard scopeGuard;

  public RuleCheckController(AssignmentService assignments, ScopeGuard scopeGuard) {
    this.assignments = assignments;
    this.scopeGuard = scopeGuard;
  }

  @PostMapping("/rule-checks")
  @PreAuthorize("hasAnyRole('SUPERVISOR','EMPLOYEE')")
  public RuleCheckService.OutcomeView preview(@RequestBody RuleCheckRequest request) {
    // The preview and the save must enforce the same scope (review-r2 S1): one path, one guard.
    return assignments.preview(request, scopeGuard.principal());
  }
}
