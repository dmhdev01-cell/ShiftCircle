package ca.shiftcircle.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Release 5 #19: V13 retires L16 in place. An old database keeps its 16 h history; only new use is
 * refused. This test migrates to V12, inserts a real L16 assignment, then applies V13.
 */
@Testcontainers
class L16RetirementMigrationTest {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine")
          .withDatabaseName("shiftcircle")
          .withUrlParam("connectTimeout", "30");

  @Test
  void v13RetiresTheTemplateWithoutDeletingOldHistory() throws Exception {
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .target(MigrationVersion.fromVersion("12"))
        .load()
        .migrate();

    UUID employee;
    try (Connection connection = connect()) {
      employee =
          insert(
              connection,
              "INSERT INTO employee (employee_no, first_name, last_name, seniority_date)"
                  + " VALUES ('T-L16-OLD', 'Old', 'History', DATE '2020-01-01') RETURNING id");
      assertThat(
              query(
                  connection,
                  "SELECT active FROM shift_template WHERE code = 'L16'",
                  Boolean.class))
          .as("before V13 the template is still active")
          .isTrue();
      exec(
          connection,
          "INSERT INTO shift_assignment (employee_id, unit_id, shift_template_id, start_at, end_at,"
              + " work_date, kind, source) VALUES ('"
              + employee
              + "', '11111111-1111-1111-1111-000000000001',"
              + " (SELECT id FROM shift_template WHERE code = 'L16'),"
              + " '2026-11-03T20:00:00-06:00', '2026-11-04T12:00:00-06:00',"
              + " DATE '2026-11-03', 'ROSTERED', 'ROTATION')");
    }

    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .load()
        .migrate();

    try (Connection connection = connect()) {
      assertThat(
              query(
                  connection,
                  "SELECT active FROM shift_template WHERE code = 'L16'",
                  Boolean.class))
          .as("V13 retires the template")
          .isFalse();
      assertThat(
              query(
                  connection,
                  "SELECT count(*) FROM shift_assignment s JOIN shift_template t"
                      + " ON t.id = s.shift_template_id"
                      + " WHERE t.code = 'L16' AND s.employee_id = '" + employee + "'",
                  Long.class))
          .as("the old L16 assignment is still there")
          .isEqualTo(1L);
      assertThat(
              query(
                  connection,
                  "SELECT count(*) FROM shift_template WHERE code = 'L16'",
                  Long.class))
          .as("the type is retired, not deleted")
          .isEqualTo(1L);
    }
  }

  private static Connection connect() throws SQLException {
    return DriverManager.getConnection(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
  }

  private static UUID insert(Connection connection, String sql) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      try (ResultSet result = statement.executeQuery()) {
        assertThat(result.next()).isTrue();
        return (UUID) result.getObject(1);
      }
    }
  }

  private static void exec(Connection connection, String sql) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.executeUpdate();
    }
  }

  private static <T> T query(Connection connection, String sql, Class<T> type)
      throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql);
        ResultSet result = statement.executeQuery()) {
      assertThat(result.next()).isTrue();
      return type.cast(result.getObject(1));
    }
  }
}
