package ca.shiftcircle.api.units;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** V11 adds the closures, the staffing override and the one active-units function. */
class UnitAvailabilityMigrationTest {

  @Test
  void v11AddsTheTablesAndTheSharedActiveFunction() throws Exception {
    PostgreSQLContainer postgres = PostgresTestSupport.postgres();
    String database = "sc_v11_" + UUID.randomUUID().toString().replace("-", "");
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
        .target("10")
        .load()
        .migrate();
    try (Connection connection =
        DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword())) {
      connection.setAutoCommit(true);
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT count(*)::text FROM information_schema.tables"
                      + " WHERE table_name IN ('unit_availability','unit_staffing','staffing_setting')"))
          .containsExactly("0");
    }

    Flyway.configure()
        .dataSource(url, postgres.getUsername(), postgres.getPassword())
        .load()
        .migrate();

    try (Connection connection =
        DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword())) {
      connection.setAutoCommit(true);
      assertThat(jdbcQuery(connection, "SELECT id::text FROM unit WHERE code = 'A'"))
          .hasSize(1);
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT unit_active_on((SELECT id FROM unit WHERE code = 'A'), DATE '2027-02-15')::text"))
          .containsExactly("true");
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT leave_allowance::text FROM staffing_setting WHERE id = 1"))
          .containsExactly("0.200");
      assertThat(jdbcQuery(connection, "SELECT count(*)::text FROM unit_staffing"))
          .containsExactly("0");

      UUID unit = UUID.fromString(jdbcQuery(connection, "SELECT id::text FROM unit WHERE code = 'A'").get(0));
      try (var insert =
          connection.prepareStatement(
              "INSERT INTO unit_availability (unit_id, disabled_from, enabled_from, reason)"
                  + " VALUES (?, DATE '2027-02-15', DATE '2027-03-29', 'Renovation')")) {
        insert.setObject(1, unit);
        insert.executeUpdate();
      }
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT unit_active_on((SELECT id FROM unit WHERE code = 'A'), DATE '2027-02-14')::text"))
          .containsExactly("true");
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT unit_active_on((SELECT id FROM unit WHERE code = 'A'), DATE '2027-02-15')::text"))
          .containsExactly("false");
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT unit_active_on((SELECT id FROM unit WHERE code = 'A'), DATE '2027-03-28')::text"))
          .containsExactly("false");
      assertThat(
              jdbcQuery(
                  connection,
                  "SELECT unit_active_on((SELECT id FROM unit WHERE code = 'A'), DATE '2027-03-29')::text"))
          .containsExactly("true");
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
