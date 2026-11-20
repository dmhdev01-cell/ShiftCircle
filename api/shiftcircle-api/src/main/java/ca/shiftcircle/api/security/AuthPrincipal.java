package ca.shiftcircle.api.security;

import java.util.List;
import java.util.UUID;

/**
 * The signed-in user, as carried in the token and returned by {@code GET /api/v1/me}.
 *
 * @param username login name
 * @param displayName name shown in the UI
 * @param roles role codes, e.g. {@code SUPERVISOR}
 * @param units unit codes the user may manage (supervisors), empty for other roles
 * @param employeeId linked officer, when the account is an employee
 */
public record AuthPrincipal(
    String username, String displayName, List<String> roles, List<String> units,
    UUID employeeId)
    implements java.security.Principal {

  public AuthPrincipal {
    roles = List.copyOf(roles);
    units = List.copyOf(units);
  }

  @Override
  public String getName() {
    return username;
  }

  public boolean hasRole(String role) {
    return roles.contains(role);
  }

  public boolean scopesUnit(String unitCode) {
    return units.contains(unitCode);
  }
}
