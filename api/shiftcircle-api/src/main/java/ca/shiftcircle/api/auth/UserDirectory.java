package ca.shiftcircle.api.auth;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** The demo sign-in accounts from the database (docs/09 §4). */
@Repository
public class UserDirectory {

  public record DemoUser(
      UUID id, String username, String displayName, List<String> roles, List<String> units,
      UUID employeeId) {}

  private final JdbcTemplate jdbc;

  public UserDirectory(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public List<DemoUser> users() {
    return jdbc.query(
        "SELECT u.id, u.username, u.display_name, u.employee_id,"
            + " coalesce(array_agg(DISTINCT r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,"
            + " coalesce(array_agg(DISTINCT un.code) FILTER (WHERE un.code IS NOT NULL), '{}') AS units"
            + " FROM app_user u LEFT JOIN app_user_role r ON r.user_id = u.id"
            + " LEFT JOIN user_unit_scope s ON s.user_id = u.id"
            + " LEFT JOIN unit un ON un.id = s.unit_id"
            + " WHERE u.active GROUP BY u.id ORDER BY u.username",
        (resultSet, rowNum) ->
            new DemoUser(
                (UUID) resultSet.getObject("id"),
                resultSet.getString("username"),
                resultSet.getString("display_name"),
                array(resultSet.getArray("roles")),
                array(resultSet.getArray("units")),
                (UUID) resultSet.getObject("employee_id")));
  }

  public DemoUser find(String idOrUsername) {
    return users().stream()
        .filter(
            user ->
                user.username().equals(idOrUsername)
                    || user.id().toString().equalsIgnoreCase(idOrUsername))
        .findFirst()
        .orElse(null);
  }

  private static List<String> array(java.sql.Array sqlArray) {
    try {
      if (sqlArray == null) {
        return List.of();
      }
      String[] values = (String[]) sqlArray.getArray();
      return List.of(values);
    } catch (java.sql.SQLException e) {
      throw new IllegalStateException("Could not read array", e);
    }
  }
}
