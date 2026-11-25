package ca.shiftcircle.infrastructure.demo;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * SHA-256 over the roster. Two runs with the same seed must produce the same string; the generator
 * test compares them, and the demo log prints it so the dataset can be identified.
 *
 * <p>The schedule periods are part of the dataset, so they are part of the checksum: the same seed
 * must produce the same roster weeks and the same published history.
 */
public final class DemoChecksum {

  private DemoChecksum() {}

  public static String of(JdbcTemplate jdbc) {
    return roster(jdbc, "", "");
  }

  /**
   * Release v1.3 (S4): the checksum over the officers only, the officers' shifts and the officer
   * units' schedule periods. It equals the pre-supervisor checksum of each dataset, which proves
   * that adding the supervisors left every officer row unchanged.
   */
  public static String officersOnly(JdbcTemplate jdbc) {
    return roster(
        jdbc,
        " WHERE e.classification = 'CO' AND u.kind <> 'SUPERVISION'",
        " WHERE u.kind <> 'SUPERVISION'");
  }

  /**
   * The officers-only form of the 120/150 checksum, which adds the synthetic identities: the
   * officers' roster checksum, then the officers' numbers and names.
   */
  public static String officersOnlyWithNames(JdbcTemplate jdbc) {
    StringBuilder names = new StringBuilder();
    jdbc.query(
        "SELECT employee_no, first_name, last_name FROM employee WHERE classification = 'CO'"
            + " ORDER BY employee_no",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                names
                    .append(rs.getString("employee_no"))
                    .append('|')
                    .append(rs.getString("first_name"))
                    .append('|')
                    .append(rs.getString("last_name"))
                    .append('\n'));
    return sha256(officersOnly(jdbc) + "|" + names);
  }

  private static String roster(JdbcTemplate jdbc, String shiftFilter, String periodFilter) {
    StringBuilder canonical = new StringBuilder();
    jdbc.query(
        "SELECT e.employee_no, s.start_at, s.end_at, t.code, u.code AS unit, s.kind"
            + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
            + " JOIN shift_template t ON t.id = s.shift_template_id"
            + " JOIN unit u ON u.id = s.unit_id" + shiftFilter
            + " ORDER BY e.employee_no, s.start_at, s.end_at",
        resultSet -> {
          canonical
              .append(resultSet.getString("employee_no"))
              .append('|')
              .append(resultSet.getTimestamp("start_at").toInstant())
              .append('|')
              .append(resultSet.getTimestamp("end_at").toInstant())
              .append('|')
              .append(resultSet.getString("code"))
              .append('|')
              .append(resultSet.getString("unit"))
              .append('|')
              .append(resultSet.getString("kind"))
              .append('\n');
        });
    jdbc.query(
        "SELECT u.code AS unit, s.start_date, s.end_date, s.status FROM schedule_period s"
            + " JOIN unit u ON u.id = s.unit_id" + periodFilter + " ORDER BY u.code, s.start_date",
        resultSet -> {
          canonical
              .append("period|")
              .append(resultSet.getString("unit"))
              .append('|')
              .append(resultSet.getDate("start_date"))
              .append('|')
              .append(resultSet.getDate("end_date"))
              .append('|')
              .append(resultSet.getString("status"))
              .append('\n');
        });
    return sha256(canonical.toString());
  }

  public static String sha256(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder();
      for (byte b : hash) {
        hex.append(String.format("%02x", b));
      }
      return hex.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
