package ca.shiftcircle.api.auth;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /api/v1/me}: the signed-in user, roles, unit scope and linked employee. */
@RestController
@RequestMapping("/api/v1")
public class MeController {

  private final ScopeGuard scopeGuard;
  private final JdbcTemplate jdbc;

  public MeController(ScopeGuard scopeGuard, JdbcTemplate jdbc) {
    this.scopeGuard = scopeGuard;
    this.jdbc = jdbc;
  }

  @GetMapping("/me")
  public Map<String, Object> me(HttpServletRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    return Map.of(
        "username", principal.username(),
        "displayName", principal.displayName(),
        "roles", principal.roles(),
        "units", principal.units(),
        "employeeId", principal.employeeId() == null ? "" : principal.employeeId().toString(),
        "position", position(principal.employeeId()));
  }

  /**
   * The position of the linked employee, e.g. "Correctional supervisor". It is an empty string when
   * the account has no employee record, like {@code employeeId}.
   */
  private String position(UUID employeeId) {
    if (employeeId == null) {
      return "";
    }
    List<String> names =
        jdbc.queryForList(
            "SELECT p.name FROM employee e JOIN position p ON p.code = e.classification"
                + " WHERE e.id = ?",
            String.class,
            employeeId);
    return names.isEmpty() ? "" : names.get(0);
  }
}
