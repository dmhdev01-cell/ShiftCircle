package ca.shiftcircle.api.rules;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code POST /api/v1/rule-checks}: preview any change, save nothing (docs/07 §3). */
@RestController
@RequestMapping("/api/v1")
public class RuleCheckController {

  private final RuleCheckService ruleChecks;
  private final ScopeGuard scopeGuard;

  public RuleCheckController(RuleCheckService ruleChecks, ScopeGuard scopeGuard) {
    this.ruleChecks = ruleChecks;
    this.scopeGuard = scopeGuard;
  }

  @PostMapping("/rule-checks")
  @PreAuthorize("hasAnyRole('SUPERVISOR','EMPLOYEE')")
  public RuleCheckService.OutcomeView preview(
      @RequestBody ChangeRequest request, HttpServletRequest http) {
    AuthPrincipal principal = scopeGuard.principal(http);
    // Employees may preview against themselves only; supervisors against their units.
    if (!principal.hasRole("SUPERVISOR")
        && !java.util.Objects.equals(principal.employeeId(), request.employeeId())) {
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.NOT_FOUND, "Employee not found");
    }
    return ruleChecks.evaluate(
        new RuleCheckService.Change(
            request.type(),
            request.employeeId(),
            request.unitId(),
            request.shiftTemplate(),
            request.startAt()));
  }
}
