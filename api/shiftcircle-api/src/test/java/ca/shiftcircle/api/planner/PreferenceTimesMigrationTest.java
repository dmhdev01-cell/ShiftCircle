package ca.shiftcircle.api.planner;

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

/** V9 must backfill the one-release single value and remove the old column. */
class PreferenceTimesMigrationTest {

  @Test
  void v9BackfillsEveryLegacyValueAndDropsTheOldColumn() throws Exception {
    PostgreSQLContainer postgres = PostgresTestSupport.postgres();
    String database = "sc_v9_" + UUID.randomUUID().toString().replace("-", "");
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
        .target("8")
        .load()
        .migrate();

    try (Connection connection =
        DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword())) {
      connection.setAutoCommit(true);
      String unit =
          "SELECT id FROM unit WHERE code = 'A'";
      String[] names = {"DAY", "EVENING", "NIGHT", "NONE", null};
      for (int index = 0; index < names.length; index++) {
        UUID employee = UUID.randomUUID();
        try (var insert =
            connection.prepareStatement(
                "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id,"
                    + " seniority_date) SELECT ?, ?, 'V9', 'Officer', (" + unit + "), DATE '2020-01-01'")) {
          insert.setObject(1, employee);
          insert.setString(2, "V9-" + index);
          insert.executeUpdate();
        }
        try (var insert =
            connection.prepareStatement(
                "INSERT INTO officer_preference (employee_id, time_of_day, days_off)"
                    + " VALUES (?, ?, '{}')")) {
          insert.setObject(1, employee);
          insert.setString(2, names[index]);
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
      List<String> values =
          jdbcQuery(
              connection,
              "SELECT employee_no || '=' || coalesce(array_to_string(times_of_day, ','), '{}')"
                  + " FROM officer_preference p JOIN employee e ON e.id = p.employee_id"
                  + " ORDER BY employee_no");
      assertThat(values)
          .containsExactly("V9-0=DAY", "V9-1=EVENING", "V9-2=NIGHT", "V9-3=", "V9-4=");
      Integer oldColumn =
          jdbcQuery(
                  connection,
                  "SELECT count(*)::text FROM information_schema.columns"
                      + " WHERE table_name = 'officer_preference' AND column_name = 'time_of_day'")
              .stream()
              .map(Integer::valueOf)
              .findFirst()
              .orElse(-1);
      assertThat(oldColumn).isZero();
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
