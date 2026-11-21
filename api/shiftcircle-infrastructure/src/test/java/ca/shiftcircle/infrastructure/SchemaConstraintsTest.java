package ca.shiftcircle.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Proves the database enforces what the application must not have to: no double-booking, no
 * overlapping pay periods, maker/checker, a locked pay period, an append-only audit log, and
 * mandatory override reasons (HANDOFF §6 step 3; T10, T11 and the overlap case).
 *
 * <p>Migrations run against a real PostgreSQL 17 container, so this also proves V1–V3 apply from an
 * empty database exactly as they will on {@code docker compose up}.
 */
@Testcontainers
class SchemaConstraintsTest {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine")
          .withDatabaseName("shiftcircle")
          .withUrlParam("connectTimeout", "30");

  private static Connection migratedConnection() throws SQLException {
    return DriverManager.getConnection(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
  }

  @BeforeAll
  static void migrate() {
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .load()
        .migrate();
  }

  private Connection connection;

  @BeforeEach
  void openTransaction() throws Exception {
    connection = migratedConnection();
    connection.setAutoCommit(false);
  }

  @AfterEach
  void rollBack() throws SQLException {
    connection.rollback();
    connection.close();
  }

  // -------------------------------------------------------------------------------------------
  // Migration and seed sanity
  // -------------------------------------------------------------------------------------------

  @Test
  void migrationsApplyAndSeedTheReferenceData() throws Exception {
    assertThat(queryInt("SELECT max(version) FROM rule_set_version")).isEqualTo(2);
    assertThat(queryInt("SELECT count(*) FROM rule_table")).isEqualTo(8);
    // V6 publishes a second rule-set version; only the published set's 19 rows are live.
    assertThat(queryInt(
            "SELECT count(*) FROM rule_row r JOIN rule_set_version v"
                + " ON v.id = r.rule_set_version_id WHERE v.status = 'PUBLISHED'"))
        .isEqualTo(19);
    assertThat(queryInt("SELECT count(*) FROM rule_row")).isEqualTo(38);
    assertThat(queryInt("SELECT count(*) FROM shift_template")).isEqualTo(8);
    assertThat(queryInt("SELECT count(*) FROM unit")).isEqualTo(6);
    assertThat(queryInt("SELECT count(*) FROM unit_requirement")).isEqualTo(18);
    // V5 adds the PLANNER account and role.
    assertThat(queryInt("SELECT count(*) FROM app_user")).isEqualTo(8);
    assertThat(queryInt("SELECT count(*) FROM app_user_role")).isEqualTo(10);
    assertThat(queryString("SELECT status FROM rule_set_version WHERE version = 1"))
        .isEqualTo("SUPERSEDED");
    assertThat(queryString("SELECT status FROM rule_set_version WHERE version = 2"))
        .isEqualTo("PUBLISHED");
    assertThat(queryString("SELECT start_time::text FROM shift_template WHERE code = 'A12'"))
        .isEqualTo("00:00:00");
    assertThat(queryString("SELECT start_time::text FROM shift_template WHERE code = 'D12'"))
        .isEqualTo("07:00:00");
    assertThat(queryString("SELECT start_time::text FROM shift_template WHERE code = 'N12'"))
        .isEqualTo("19:00:00");
  }

  // -------------------------------------------------------------------------------------------
  // No double-booking (shift_assignment exclusion constraint)
  // -------------------------------------------------------------------------------------------

  @Test
  void rejectsOverlappingShiftsForTheSameOfficer() throws Exception {
    UUID employee = insertEmployee("overlap");
    insertShift(employee, "2026-11-19T07:00:00Z", "2026-11-19T15:00:00Z", "PLANNED");

    expectSqlState(
        "23P01",
        () -> insertShift(employee, "2026-11-19T14:00:00Z", "2026-11-19T22:00:00Z", "PLANNED"));
  }

  @Test
  void allowsBackToBackShifts() throws Exception {
    UUID employee = insertEmployee("back-to-back");
    insertShift(employee, "2026-11-19T07:00:00Z", "2026-11-19T15:00:00Z", "PLANNED");
    insertShift(employee, "2026-11-19T15:00:00Z", "2026-11-19T23:00:00Z", "PLANNED");

    assertThat(queryInt("SELECT count(*) FROM shift_assignment WHERE employee_id = ?", employee))
        .isEqualTo(2);
  }

  @Test
  void allowsReplacingACancelledShift() throws Exception {
    UUID employee = insertEmployee("cancelled");
    insertShift(employee, "2026-11-19T07:00:00Z", "2026-11-19T15:00:00Z", "CANCELLED");
    insertShift(employee, "2026-11-19T07:00:00Z", "2026-11-19T15:00:00Z", "PLANNED");

    assertThat(queryInt("SELECT count(*) FROM shift_assignment WHERE employee_id = ?", employee))
        .isEqualTo(2);
  }

  @Test
  void rejectsAShiftThatEndsBeforeItStarts() throws Exception {
    UUID employee = insertEmployee("backwards");

    expectSqlState(
        "23514",
        () -> insertShift(employee, "2026-11-19T15:00:00Z", "2026-11-19T07:00:00Z", "PLANNED"));
  }

  // -------------------------------------------------------------------------------------------
  // Pay periods
  // -------------------------------------------------------------------------------------------

  @Test
  void rejectsOverlappingPayPeriods() throws Exception {
    insertPayPeriod("2026-10-26", "2026-11-08", "OPEN");

    expectSqlState("23P01", () -> insertPayPeriod("2026-11-02", "2026-11-15", "OPEN"));
  }

  @Test
  void allowsAdjacentPayPeriods() throws Exception {
    insertPayPeriod("2026-10-26", "2026-11-08", "OPEN");
    insertPayPeriod("2026-11-09", "2026-11-22", "OPEN");

    assertThat(queryInt("SELECT count(*) FROM pay_period")).isEqualTo(2);
  }

  @Test
  void unlockingAPayPeriodNeedsAReason() throws Exception {
    expectSqlState(
        "23514",
        () ->
            exec(
                "INSERT INTO pay_period (start_date, end_date, status, locked_at)"
                    + " VALUES (DATE '2026-10-26', DATE '2026-11-08', 'OPEN', now())"));

    exec(
        "INSERT INTO pay_period (start_date, end_date, status, locked_at, unlock_reason)"
            + " VALUES (DATE '2026-10-26', DATE '2026-11-08', 'OPEN', now(),"
            + " 'Correction after payroll query')");
  }

  // -------------------------------------------------------------------------------------------
  // T11 — a locked pay period freezes its time entries
  // -------------------------------------------------------------------------------------------

  @Test
  void rejectsTimeEntryChangesInALockedPayPeriod() throws Exception {
    UUID employee = insertEmployee("locked");
    UUID period = insertPayPeriod("2026-10-26", "2026-11-08", "OPEN");
    UUID entry = insertTimeEntry(employee, period, "2026-10-27");
    exec("UPDATE pay_period SET status = 'LOCKED', locked_at = now() WHERE id = ?", period);

    expectSqlState(
        "23514",
        () ->
            exec(
                "UPDATE time_entry SET hours = 8.5 WHERE id = ?",
                entry));
    expectSqlState(
        "23514",
        () ->
            exec(
                "INSERT INTO time_entry (employee_id, pay_period_id, work_date, start_at, end_at,"
                    + " hours, entry_type) VALUES (?, ?, DATE '2026-10-28',"
                    + " TIMESTAMPTZ '2026-10-28 07:00:00+00', TIMESTAMPTZ '2026-10-28 15:00:00+00',"
                    + " 8.00, 'ACTUAL')",
                employee,
                period));
    expectSqlState("23514", () -> exec("DELETE FROM time_entry WHERE id = ?", entry));
  }

  @Test
  void acceptsTimeEntriesInAnOpenPayPeriod() throws Exception {
    UUID employee = insertEmployee("open-period");
    UUID period = insertPayPeriod("2026-10-26", "2026-11-08", "OPEN");
    insertTimeEntry(employee, period, "2026-10-27");

    // Double guard: the trigger raises with a generic SQLSTATE for the UPDATE path as well.
    assertThat(queryInt("SELECT count(*) FROM time_entry WHERE pay_period_id = ?", period))
        .isEqualTo(1);
  }

  // -------------------------------------------------------------------------------------------
  // T10 — maker/checker
  // -------------------------------------------------------------------------------------------

  @Test
  void rejectsAVersionApprovedByItsOwnAuthor() throws Exception {
    UUID author = UUID.fromString("22222222-2222-2222-2222-000000000004");

    expectSqlState(
        "23514",
        () ->
            exec(
                "INSERT INTO rule_set_version (version, status, effective_from, created_by,"
                    + " approved_by) VALUES (3, 'APPROVED', DATE '2026-11-01', ?, ?)",
                author,
                author));
  }

  @Test
  void allowsADifferentApprover() throws Exception {
    exec(
        "INSERT INTO rule_set_version (version, status, effective_from, created_by, approved_by)"
            + " VALUES (3, 'APPROVED', DATE '2026-11-01', ?, ?)",
        UUID.fromString("22222222-2222-2222-2222-000000000004"),
        UUID.fromString("22222222-2222-2222-2222-000000000005"));

    assertThat(queryInt("SELECT count(*) FROM rule_set_version WHERE version = 3")).isEqualTo(1);
  }

  @Test
  void rejectsTwoPublishedVersionsForTheSameEffectiveDate() throws Exception {
    expectSqlState(
        "23505",
        () ->
            exec(
                "INSERT INTO rule_set_version (version, status, effective_from)"
                    + " VALUES (3, 'PUBLISHED', DATE '2026-11-21')"));
  }

  // -------------------------------------------------------------------------------------------
  // Append-only audit log
  // -------------------------------------------------------------------------------------------

  @Test
  void auditEventsCannotBeUpdatedOrDeleted() throws Exception {
    exec(
        "INSERT INTO audit_event (action, entity_type) VALUES ('assign', 'shift_assignment')");

    expectSqlState("42501", () -> exec("UPDATE audit_event SET action = 'tampered'"));
    expectSqlState("42501", () -> exec("DELETE FROM audit_event"));
  }

  // -------------------------------------------------------------------------------------------
  // Override reasons
  // -------------------------------------------------------------------------------------------

  @Test
  void overrideReasonsMustSaySomething() throws Exception {
    expectSqlState(
        "23514",
        () ->
            exec(
                "INSERT INTO override (reason, rule_set_version_id)"
                    + " VALUES ('123456789', '00000000-0000-0000-0000-000000000001')"));

    // Exactly the minimum is allowed: the check is inclusive.
    exec(
        "INSERT INTO override (reason, rule_set_version_id)"
            + " VALUES ('1234567890', '00000000-0000-0000-0000-000000000001')");
    exec(
        "INSERT INTO override (reason, rule_set_version_id)"
            + " VALUES ('Emergency lockdown staffing', '00000000-0000-0000-0000-000000000001')");
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private UUID insertEmployee(String tag) throws SQLException {
    return execReturningUuid(
        "INSERT INTO employee (employee_no, first_name, last_name, seniority_date)"
            + " VALUES (?, 'Test', ?, DATE '2020-01-01') RETURNING id",
        "T-" + tag + "-" + UUID.randomUUID(),
        tag);
  }

  private void insertShift(UUID employeeId, String start, String end, String status)
      throws SQLException {
    exec(
        "INSERT INTO shift_assignment (employee_id, unit_id, shift_template_id, start_at, end_at,"
            + " work_date, kind, source, status) VALUES (?,"
            + " '11111111-1111-1111-1111-000000000001',"
            + " (SELECT id FROM shift_template WHERE code = 'D8'),"
            + " ?::timestamptz, ?::timestamptz, ?::date, 'ROSTERED', 'MANUAL', ?)",
        employeeId,
        start,
        end,
        start.substring(0, 10),
        status);
  }

  private UUID insertPayPeriod(String start, String end, String status) throws SQLException {
    return execReturningUuid(
        "INSERT INTO pay_period (start_date, end_date, status)"
            + " VALUES (?::date, ?::date, ?) RETURNING id",
        start,
        end,
        status);
  }

  private UUID insertTimeEntry(UUID employeeId, UUID periodId, String workDate)
      throws SQLException {
    return execReturningUuid(
        "INSERT INTO time_entry (employee_id, pay_period_id, work_date, start_at, end_at, hours,"
            + " entry_type) VALUES (?, ?, ?::date, ?::timestamptz, ?::timestamptz, 8.00,"
            + " 'ACTUAL') RETURNING id",
        employeeId,
        periodId,
        workDate,
        workDate + "T07:00:00Z",
        workDate + "T15:00:00Z");
  }

  private void exec(String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      bind(statement, args);
      statement.executeUpdate();
    }
  }

  private UUID execReturningUuid(String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      bind(statement, args);
      try (ResultSet result = statement.executeQuery()) {
        result.next();
        return (UUID) result.getObject(1);
      }
    }
  }

  private int queryInt(String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      bind(statement, args);
      try (ResultSet result = statement.executeQuery()) {
        result.next();
        return result.getInt(1);
      }
    }
  }

  private String queryString(String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      bind(statement, args);
      try (ResultSet result = statement.executeQuery()) {
        result.next();
        return result.getString(1);
      }
    }
  }

  private static void bind(PreparedStatement statement, Object... args) throws SQLException {
    for (int i = 0; i < args.length; i++) {
      statement.setObject(i + 1, args[i]);
    }
  }

  private interface SqlCall {
    void run() throws SQLException;
  }

  private void expectSqlState(String expectedState, SqlCall call) throws SQLException {
    Savepoint savepoint = connection.setSavepoint();
    assertThatThrownBy(call::run)
        .isInstanceOf(SQLException.class)
        .satisfies(
            error ->
                assertThat(((SQLException) error).getSQLState())
                    .as("SQLSTATE of: %s", error.getMessage())
                    .isEqualTo(expectedState));
    connection.rollback(savepoint);
  }
}
