package ca.shiftcircle.api.security;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Unit-scope and "own record" checks (docs/09 §3). Out-of-scope identifiers return 404 so the API
 * does not reveal that a unit or officer exists.
 */
@Component
public class ScopeGuard {

  /** The signed-in principal, from the security context. */
  public AuthPrincipal principal() {
    org.springframework.security.core.Authentication authentication =
        org.springframework.security.core.context.SecurityContextHolder.getContext()
            .getAuthentication();
    if (authentication != null && authentication.getPrincipal() instanceof AuthPrincipal p) {
      return p;
    }
    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not signed in");
  }

  /** Supervisors act on their units only; facility-wide roles pass. */
  public void requireUnit(AuthPrincipal principal, String unitCode) {
    if (facilityWide(principal) || principal.scopesUnit(unitCode)) {
      return;
    }
    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unit not found");
  }

  /** An employee row is visible when it is the caller's own or inside their unit scope. */
  public void requireEmployeeAccess(AuthPrincipal principal, UUID employeeId, String unitCode) {
    if (facilityWide(principal) || principal.scopesUnit(unitCode)) {
      return;
    }
    if (employeeId != null && employeeId.equals(principal.employeeId())) {
      return;
    }
    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
  }

  private boolean facilityWide(AuthPrincipal principal) {
    return principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY");
  }
}
