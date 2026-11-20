package ca.shiftcircle.infrastructure.demo;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Proves the demo dataset (docs/10-testing.md §6): the generator's self-check passes, the planted
 * shape exists, and the same seed produces the same roster twice.
 */
@Testcontainers
class DemoDataGeneratorTest {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine").withDatabaseName("shiftcircle");

  private static JdbcTemplate jdbc;

  @BeforeAll
  static void prepare() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource();
    dataSource.setUrl(POSTGRES.getJdbcUrl());
    dataSource.setUsername(POSTGRES.getUsername());
    dataSource.setPassword(POSTGRES.getPassword());
    jdbc = new JdbcTemplate(dataSource);
  }

  @org.junit.jupiter.api.BeforeEach
  void freshDataset() throws SQLException {
    resetSchema();
    new DemoDataGenerator(jdbc).generate(DemoSettings.defaults());
  }

  @Test
  void generatesADatasetThatPassesItsOwnSelfCheck() {
    assertThat(count("SELECT count(*) FROM employee")).isEqualTo(100);
    assertThat(count("SELECT count(*) FROM shift_assignment")).isBetween(4000, 7000);
    assertThat(count("SELECT count(*) FROM time_entry")).isGreaterThan(3000);
    assertThat(count("SELECT count(*) FROM pay_period WHERE status = 'LOCKED'"))
        .isGreaterThanOrEqualTo(3);
    assertThat(count("SELECT count(*) FROM absence")).isGreaterThan(100);
    assertThat(count("SELECT count(*) FROM open_shift")).isGreaterThan(5);
    assertThat(count("SELECT count(*) FROM overtime_offer")).isGreaterThan(10);

    // Every shift length in the design is present: 8, 12 and 16 hours.
    Map<String, Integer> byTemplate =
        jdbc.query(
            "SELECT t.code, count(*) AS n FROM shift_assignment s"
                + " JOIN shift_template t ON t.id = s.shift_template_id GROUP BY t.code",
            resultSet -> {
              Map<String, Integer> counts = new java.util.LinkedHashMap<>();
              while (resultSet.next()) {
                counts.put(resultSet.getString("code"), resultSet.getInt("n"));
              }
              return counts;
            });
    assertThat(byTemplate).containsKeys("D8", "E8", "N8", "A12", "P12", "L16");
    assertThat(byTemplate.get("L16")).isGreaterThan(0);

    // The locked period used by the payroll golden file exists.
    assertThat(
            count(
                "SELECT count(*) FROM pay_period WHERE status = 'LOCKED'"
                    + " AND start_date = DATE '2026-10-26' AND end_date = DATE '2026-11-08'"))
        .isEqualTo(1);
  }

  @Test
  void theSameSeedProducesTheSameRosterTwice() throws SQLException {
    String firstChecksum = DemoChecksum.of(jdbc);
    int firstAssignments = count("SELECT count(*) FROM shift_assignment");
    int firstEntries = count("SELECT count(*) FROM time_entry");
    int firstAbsences = count("SELECT count(*) FROM absence");

    resetSchema();
    new DemoDataGenerator(jdbc).generate(DemoSettings.defaults());

    assertThat(DemoChecksum.of(jdbc)).isEqualTo(firstChecksum);
    assertThat(count("SELECT count(*) FROM shift_assignment")).isEqualTo(firstAssignments);
    assertThat(count("SELECT count(*) FROM time_entry")).isEqualTo(firstEntries);
    assertThat(count("SELECT count(*) FROM absence")).isEqualTo(firstAbsences);
  }

  @Test
  void twoOfficersCanShareOvertimeHoursWithDifferentSeniority() {
    // PC-07's precondition: the ranking needs a real tie to break by seniority.
    Integer ties =
        count(
            "SELECT count(*) FROM (SELECT ot FROM"
                + " (SELECT e.id, min(e.seniority_date) AS seniority,"
                + "  coalesce(sum(CASE WHEN t.pay_code = 'OT15' THEN t.hours ELSE 0 END), 0) AS ot"
                + "  FROM employee e LEFT JOIN time_entry t ON t.employee_id = e.id"
                + "  GROUP BY e.id) x"
                + " GROUP BY ot HAVING count(*) > 1 AND count(DISTINCT seniority) > 1) y");
    assertThat(ties).isGreaterThan(0);
  }

  private static void resetSchema() throws SQLException {
    try (Connection connection =
        DriverManager.getConnection(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
      connection.createStatement().execute("DROP SCHEMA public CASCADE");
      connection.createStatement().execute("CREATE SCHEMA public");
    }
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .load()
        .migrate();
  }

  private static int count(String sql) {
    Integer value = jdbc.queryForObject(sql, Integer.class);
    return value == null ? 0 : value;
  }
}
