package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.shiftcircle.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** V10 adds the per-officer 8 h pattern on every existing and future employee. */
class OfficerPatternMigrationTest {

  @Test
  void v10GivesEveryExistingAndNewEmployeeTheRotatingDefault() throws Exception {
    PostgreSQLContainer postgres = PostgresTestSupport.postgres();
    String database = "sc_v10_" + UUID.randomUUID().toString().replace("-", "");
    String base = baseUrl(postgres);
    try (Connection connection =
            DriverManager.getConnection(
                base + "/postgres?sslmode=disable", postgres.getUsername(), postgres.getPassword());
        Statement statement = connection.createStatement()) {
      statement.execute("CREATE DATABASE " + database);
    }
    String url = base + "/" + database + "?sslmode=disable";

    Flyway.configure()
        .dataSource(url, postgres.getUsername(), postgres.getPassword())
        .target("9")
        .load()
        .migrate();

    try (Connection connection =
        DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword())) {
      connection.setAutoCommit(true);
      try (var unit =
          connection.prepareStatement(
              "INSERT INTO rotation_pattern (id, code, name, cycle_days, pattern, anchor_date)"
                  + " VALUES (?, 'D12_DAY_4ON4OFF', 'Day 4 on, 4 off', 8, '{}'::jsonb,"
                  + " DATE '2027-01-04')")) {
        unit.setObject(1, UUID.randomUUID());
        unit.executeUpdate();
      }
      for (int index = 0; index < 3; index++) {
        try (var insert =
            connection.prepareStatement(
                "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id,"
                    + " rotation_pattern_id, seniority_date)"
                    + " SELECT ?, ?, 'V10', 'Officer', u.id,"
                    + " (SELECT id FROM rotation_pattern WHERE code = 'D12_DAY_4ON4OFF' LIMIT ?),"
                    + " DATE '2020-01-01' FROM unit u WHERE u.code = 'A'")) {
          insert.setObject(1, UUID.randomUUID());
          insert.setString(2, "V10-" + index);
          insert.setInt(3, index == 0 ? 1 : 0);
          insert.executeUpdate();
        }
      }
    }

    Flyway.configure()
        .dataSource(url, postgres.getUsername(), postgres.getPassword())
        .load()
        .migrate();

    try (Connection connection =
        DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword())) {
      connection.setAutoCommit(true);
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT employee_no || '=' || shift_pattern FROM employee ORDER BY employee_no"))
          .containsExactly("V10-0=ROTATING_5_2", "V10-1=ROTATING_5_2", "V10-2=ROTATING_5_2");
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT is_nullable FROM information_schema.columns"
                      + " WHERE table_name = 'plan_draft' AND column_name = 'pattern8h'"))
          .containsExactly("YES");

      // A reset inserts after Flyway, so the column default must supply the pattern too.
      try (var insert =
          connection.prepareStatement(
              "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id,"
                  + " seniority_date) SELECT ?, 'V10-new', 'V10', 'New', u.id, DATE '2021-01-01'"
                  + " FROM unit u WHERE u.code = 'A'")) {
        insert.setObject(1, UUID.randomUUID());
        insert.executeUpdate();
      }
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT shift_pattern FROM employee WHERE employee_no = 'V10-new'"))
          .containsExactly("ROTATING_5_2");
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT count(*)::text FROM employee WHERE shift_pattern IS NULL"))
          .containsExactly("0");

      assertThatThrownBy(
              () ->
                  jdbcQuery(
                      connection,
                      "UPDATE employee SET shift_pattern = 'FOUR_ON_FOUR_OFF'"
                          + " WHERE employee_no = 'V10-new' RETURNING shift_pattern"))
          .isInstanceOf(SQLException.class);
    }
  }

  private static List<String> jdbcQuery(Connection connection, String sql) throws Exception {
    try (var statement = connection.createStatement();
        var rows = statement.executeQuery(sql)) {
      List<String> values = new java.util.ArrayList<>();
      while (rows.next()) {
        values.add(rows.getString(1));
      }
      return values;
    }
  }

  private static String baseUrl(PostgreSQLContainer container) {
    String url = container.getJdbcUrl();
    int path = url.indexOf('/', "jdbc:postgresql://".length());
    return url.substring(0, path);
  }
}
