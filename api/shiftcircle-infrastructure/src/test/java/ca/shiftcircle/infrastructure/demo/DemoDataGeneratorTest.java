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
      new PostgreSQLContainer("postgres:17-alpine")
          .withDatabaseName("shiftcircle")
          .withUrlParam("connectTimeout", "30");

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

    // Planted cases PC-01 to PC-09 (docs/10 §6.6) exist with their documented shape.
    assertThat(
            count(
                "SELECT count(*) FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                    + " JOIN shift_template t ON t.id = s.shift_template_id"
                    + " WHERE e.employee_no = 'E-002' AND t.code = 'P12'"
                    + " AND s.work_date = DATE '2026-11-20'"))
        .isEqualTo(1);
    assertThat(
            count(
                "SELECT count(*) FROM open_shift o JOIN unit u ON u.id = o.unit_id"
                    + " JOIN shift_template t ON t.id = o.shift_template_id"
                    + " WHERE u.code = 'B' AND t.code = 'D8'"
                    + " AND o.start_at::date = DATE '2026-11-21' AND o.status = 'OPEN'"))
        .isEqualTo(1);
    assertThat(
            count(
                "SELECT count(*) FROM shift_assignment WHERE override_id IS NOT NULL"
                    + " AND work_date = DATE '2026-11-03'"
                    + " AND end_at - start_at = interval '17 hours'"))
        .isEqualTo(1);
    assertThat(
            count(
                "SELECT count(*) FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                    + " JOIN shift_template t ON t.id = s.shift_template_id"
                    + " WHERE e.employee_no = 'E-007' AND t.code = 'A12'"
                    + " AND s.work_date BETWEEN DATE '2026-11-20' AND DATE '2026-11-23'"))
        .isEqualTo(4);
    assertThat(
            count(
                "SELECT count(*) FROM (SELECT e.id, sum(t.hours) AS h FROM time_entry t"
                    + " JOIN employee e ON e.id = t.employee_id JOIN pay_period p"
                    + " ON p.id = t.pay_period_id WHERE p.start_date = DATE '2026-10-26'"
                    + " AND t.absence_type IS NULL GROUP BY e.id) x WHERE abs(h - 80.0) < 0.01"))
        .isGreaterThanOrEqualTo(1);
    assertThat(
            count(
                "SELECT count(*) FROM (SELECT e.id, sum(t.hours) AS h FROM time_entry t"
                    + " JOIN employee e ON e.id = t.employee_id JOIN pay_period p"
                    + " ON p.id = t.pay_period_id WHERE p.start_date = DATE '2026-10-26'"
                    + " AND t.absence_type IS NULL GROUP BY e.id) x"
                    + " WHERE abs(h - 80.4833) < 0.01"))
        .isGreaterThanOrEqualTo(1);

    // R1: a 16-hour shift is never extended past the legal ceiling, and the extension rate does not
    // quietly create 16.5-18 h days.
    assertThat(
            count(
                "SELECT count(*) FROM time_entry t JOIN shift_assignment s"
                    + " ON s.id = t.shift_assignment_id JOIN shift_template st"
                    + " ON st.id = s.shift_template_id WHERE st.code = 'L16'"
                    + " AND s.override_id IS NULL"
                    + " AND t.end_at - t.start_at > interval '16 hours'"))
        .isZero();

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
    int firstPeriods = count("SELECT count(*) FROM schedule_period");

    resetSchema();
    new DemoDataGenerator(jdbc).generate(DemoSettings.defaults());

    assertThat(DemoChecksum.of(jdbc)).isEqualTo(firstChecksum);
    assertThat(count("SELECT count(*) FROM shift_assignment")).isEqualTo(firstAssignments);
    assertThat(count("SELECT count(*) FROM time_entry")).isEqualTo(firstEntries);
    assertThat(count("SELECT count(*) FROM absence")).isEqualTo(firstAbsences);
    assertThat(count("SELECT count(*) FROM schedule_period")).isEqualTo(firstPeriods);
  }

  @Test
  void seedsTheRosterWeeksEveryUnitCanPublish() {
    // Six units, one Monday-to-Sunday period per week of the 90-day window (14 weeks).
    assertThat(count("SELECT count(DISTINCT unit_id) FROM schedule_period")).isEqualTo(6);
    assertThat(
            count(
                "SELECT count(*) FROM schedule_period WHERE start_date = DATE '2026-09-28'"
                    + " AND end_date = DATE '2026-10-04'"))
        .isEqualTo(6);
    assertThat(
            count(
                "SELECT count(*) FROM schedule_period WHERE start_date = DATE '2026-12-28'"
                    + " AND end_date = DATE '2027-01-03'"))
        .isEqualTo(6);

    // Past weeks are published history; the demo week and the week after it are drafts.
    assertThat(
            count(
                "SELECT count(*) FROM schedule_period WHERE end_date < DATE '2026-11-19'"
                    + " AND status = 'PUBLISHED' AND published_at IS NOT NULL"))
        .isEqualTo(6 * 7);
    assertThat(
            count(
                "SELECT count(*) FROM schedule_period WHERE end_date >= DATE '2026-11-19'"
                    + " AND status = 'DRAFT'"))
        .isEqualTo(6 * 7);

    // Every shift belongs to the period that covers its work date.
    assertThat(count("SELECT count(*) FROM shift_assignment WHERE schedule_period_id IS NULL"))
        .isZero();
    assertThat(
            count(
                "SELECT count(*) FROM shift_assignment s JOIN schedule_period p"
                    + " ON p.id = s.schedule_period_id WHERE p.unit_id <> s.unit_id"
                    + " OR s.work_date < p.start_date OR s.work_date > p.end_date"))
        .isZero();
  }

  @Test
  void aMissingSchedulePeriodFailsTheSelfCheck() {
    // A week without a period is a week a supervisor cannot publish, so the generator must refuse
    // to hand out such a dataset.
    jdbc.update(
        "UPDATE shift_assignment SET schedule_period_id = NULL WHERE schedule_period_id ="
            + " (SELECT id FROM schedule_period WHERE unit_id ="
            + "   (SELECT id FROM unit WHERE code = 'A') AND start_date = DATE '2026-11-16')");
    jdbc.update(
        "DELETE FROM schedule_period WHERE unit_id ="
            + " (SELECT id FROM unit WHERE code = 'A') AND start_date = DATE '2026-11-16'");

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> new DemoDataSelfCheck(jdbc, null, java.time.Instant.now()).verify())
        .isInstanceOf(DemoDataSelfCheckException.class)
        .hasMessageContaining("schedule period");
  }

  @Test
  void fewerThanThreeFourNightRunsFailsTheSelfCheck() {
    // The check must count runs (QA finding): remove the two planted extra runs and expect PC-06.
    // The planted run is in a locked period; unlock it for the test, then remove the run.
    jdbc.update(
        "UPDATE pay_period SET status = 'OPEN', unlock_reason = 'test'"
            + " WHERE start_date = DATE '2026-09-28'");
    String runAssignments =
        "SELECT s.id FROM shift_assignment s WHERE s.shift_template_id ="
            + " (SELECT id FROM shift_template WHERE code = 'A12')"
            + " AND s.work_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-04'"
            + " AND s.employee_id IN (SELECT id FROM employee"
            + "   WHERE employee_no IN ('E-001','E-004'))";
    jdbc.update("DELETE FROM time_entry WHERE shift_assignment_id IN (" + runAssignments + ")");
    jdbc.update("DELETE FROM shift_assignment WHERE id IN (" + runAssignments + ")");

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> new DemoDataSelfCheck(jdbc, null, java.time.Instant.now()).verify())
        .isInstanceOf(DemoDataSelfCheckException.class)
        .hasMessageContaining("PC-06");
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
