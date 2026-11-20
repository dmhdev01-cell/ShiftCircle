package ca.shiftcircle.api.reference;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Reference data the screens need (docs/07 §4.1): units, shift templates, qualifications and the
 * officers of a unit. Supervisors see only their scope, auditors everything.
 */
@RestController
@RequestMapping("/api/v1")
public class ReferenceController {

  private final JdbcTemplate jdbc;
  private final ScopeGuard scopeGuard;

  public ReferenceController(JdbcTemplate jdbc, ScopeGuard scopeGuard) {
    this.jdbc = jdbc;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/units")
  public List<Map<String, Object>> units(HttpServletRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    List<Map<String, Object>> units =
        jdbc.queryForList(
            "SELECT id, code, name, kind, allows_12h, allows_16h FROM unit"
                + " WHERE active ORDER BY code");
    if (principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY")
        || !principal.hasRole("SUPERVISOR")) {
      return units;
    }
    return units.stream()
        .filter(unit -> principal.scopesUnit((String) unit.get("code")))
        .toList();
  }

  @GetMapping("/shift-templates")
  public List<Map<String, Object>> shiftTemplates() {
    return jdbc.queryForList(
        "SELECT id, code, label, start_time::text AS start, duration_minutes, regular_allowed,"
            + " chip_style FROM shift_template WHERE active ORDER BY start_time, code");
  }

  @GetMapping("/qualifications")
  public List<Map<String, Object>> qualifications() {
    return jdbc.queryForList("SELECT id, code, name FROM qualification ORDER BY name");
  }

  @GetMapping("/employees")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR')")
  public List<Map<String, Object>> employees(
      @RequestParam(required = false) UUID unitId, HttpServletRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    if (unitId != null) {
      String unitCode =
          jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, unitId);
      scopeGuard.requireUnit(principal, unitCode);
    }

    List<Map<String, Object>> employees =
        new ArrayList<>(
            jdbc.queryForList(
                unitId == null
                    ? "SELECT e.id, e.employee_no, e.first_name, e.last_name, e.home_unit_id,"
                        + " u.code AS home_unit FROM employee e"
                        + " LEFT JOIN unit u ON u.id = e.home_unit_id"
                        + " WHERE e.active ORDER BY e.last_name, e.first_name"
                    : "SELECT e.id, e.employee_no, e.first_name, e.last_name, e.home_unit_id,"
                        + " u.code AS home_unit FROM employee e"
                        + " LEFT JOIN unit u ON u.id = e.home_unit_id"
                        + " WHERE e.active AND e.home_unit_id = ? ORDER BY e.last_name, e.first_name",
                unitId == null ? new Object[] {} : new Object[] {unitId}));

    // No unit filter means "the officers I may see", not the whole roster (docs/09 §3): a
    // supervisor sees only officers whose home unit is in their scope; the auditor sees all.
    boolean facilityWide = principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY");
    if (unitId == null && !facilityWide) {
      employees.removeIf(
          employee -> !principal.scopesUnit((String) employee.get("home_unit")));
    }

    Map<UUID, List<String>> qualifications = new LinkedHashMap<>();
    jdbc.query(
        "SELECT eq.employee_id, q.code FROM employee_qualification eq"
            + " JOIN qualification q ON q.id = eq.qualification_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                qualifications
                    .computeIfAbsent(
                        (UUID) resultSet.getObject("employee_id"), key -> new ArrayList<>())
                    .add(resultSet.getString("code")));

    employees.forEach(
        employee ->
            employee.put(
                "qualifications",
                qualifications.getOrDefault((UUID) employee.get("id"), List.of())));
    return employees;
  }
}
