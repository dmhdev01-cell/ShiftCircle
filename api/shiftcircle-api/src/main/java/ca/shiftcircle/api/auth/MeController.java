package ca.shiftcircle.api.auth;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /api/v1/me}: the signed-in user, roles, unit scope and linked employee. */
@RestController
@RequestMapping("/api/v1")
public class MeController {

  private final ScopeGuard scopeGuard;

  public MeController(ScopeGuard scopeGuard) {
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/me")
  public Map<String, Object> me(HttpServletRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    return Map.of(
        "username", principal.username(),
        "displayName", principal.displayName(),
        "roles", principal.roles(),
        "units", principal.units(),
        "employeeId", principal.employeeId() == null ? "" : principal.employeeId().toString());
  }
}
