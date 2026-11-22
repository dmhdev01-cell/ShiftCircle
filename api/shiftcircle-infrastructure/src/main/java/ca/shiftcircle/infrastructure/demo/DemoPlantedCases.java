package ca.shiftcircle.infrastructure.demo;

import ca.shiftcircle.rules.build.BusinessTime;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The planted cases from docs/10-testing.md §6.6. They are applied after the base dataset so the demo
 * script can point at them, and they use the same deterministic ids as the generator.
 *
 * <p>Each case is small and named: PC-01/PC-08 share the open Unit B day shift on Sat 21 Nov,
 * PC-02 the exactly-eight-hour rest slot, PC-03 the 17-hour override, PC-04 Piotr's four nights with
 * a fifth available, PC-05 the pay-period boundary officers, PC-09 the Control shift whose top
 * candidate is unqualified. PC-06 and PC-07 are asserted by the self-check because they are
 * properties of the whole roster.
 */
final class DemoPlantedCases {

  private static final LocalDate PC01_DATE = LocalDate.of(2026, 11, 20);
  private static final LocalDate PC02_DATE = LocalDate.of(2026, 11, 25);
  private static final LocalDate PC03_DATE = LocalDate.of(2026, 11, 3);
  private static final LocalDate PC04_START = LocalDate.of(2026, 11, 20);

  private final JdbcTemplate jdbc;

  DemoPlantedCases(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  void apply() {
    plantPc01NiaDoubleBooking();
    plantPc02EightHourRest();
    plantPc03SeventeenHourOverride();
    plantPc04PiotrFourNights();
    plantPc05PayPeriodBoundary();
    plantPc06MoreFourNightRuns();
    plantPc09ControlCandidate();
  }

  // PC-01 / PC-08: Nia works a 12-hour afternoon shift on Fri 20 Nov, and the Unit B day shift on
  // Sat 21 Nov is open. Assigning her to it gives 7 hours of rest and 17 hours in 24: blocked.
  private void plantPc01NiaDoubleBooking() {
    String nia = "E-002";
    // The night shift that ends on the Friday morning must go too, or her 12:00 start has 5 h rest.
    deleteAssignments(nia, PC01_DATE.minusDays(1));
    deleteAssignments(nia, PC01_DATE);
    // Saturday must be free for her, or the base roster would already give her the blocked rest.
    deleteAssignments(nia, PC01_DATE.plusDays(1));
    // The previous Saturday would make the base week 64 h (a saved U-14 Block) once the two
    // shifts below are added; without it the base is 56 h and only the proposal crosses 60.
    deleteAssignments(nia, PC01_DATE.minusDays(6));

    Instant start = instant(PC01_DATE, "12:00");
    insertAssignment(
        id("planted:pc01:nia"), nia, "B", "P12", start, start.plusSeconds(12 * 3600L), PC01_DATE);

    // The U-14 block needs Nia's week over 60 h without L16 (retired in release 5). Turn her
    // Monday E8 into a 12 h P12 (+4 h) and add a Thursday E8 (+8 h); removing her previous
    // Saturday keeps the saved week at 56 h, so the Saturday D8 takes it to 64 h and U-14 blocks
    // with U-01 and U-05. The Monday shift is past, so its actual is moved with it.
    LocalDate monday = PC01_DATE.minusDays(4);
    Instant mondayStart = instant(monday, "12:00");
    Instant mondayEnd = mondayStart.plusSeconds(12 * 3600L);
    jdbc.update(
        "UPDATE shift_assignment SET shift_template_id ="
            + " (SELECT id FROM shift_template WHERE code = 'P12'), start_at = ?, end_at = ?"
            + " WHERE employee_id = (SELECT id FROM employee WHERE employee_no = 'E-002')"
            + " AND work_date = ?",
        Timestamp.from(mondayStart),
        Timestamp.from(mondayEnd),
        monday);
    jdbc.update(
        "UPDATE time_entry SET start_at = ?, end_at = ?, hours = 12.0 WHERE shift_assignment_id ="
            + " (SELECT id FROM shift_assignment WHERE employee_id ="
            + " (SELECT id FROM employee WHERE employee_no = 'E-002') AND work_date = ?)",
        Timestamp.from(mondayStart),
        Timestamp.from(mondayEnd),
        monday);
    LocalDate thursday = PC01_DATE.minusDays(1);
    Instant thursdayStart = instant(thursday, "15:00");
    insertAssignment(
        id("planted:pc01:nia-thu"),
        "E-002",
        "B",
        "E8",
        thursdayStart,
        thursdayStart.plusSeconds(8 * 3600L),
        thursday);

    // Make one Unit B day shift on the Saturday open (the demo tries to fill it with Nia).
    removeOneAssignment("B", "D8", PC01_DATE.plusDays(1));
    // E2: Tara is the demo employee account (t.nakamura). She must be free to take that open
    // shift, or the supervisor cannot offer it to the one employee who can sign in.
    deleteAssignments("E-001", PC01_DATE.plusDays(1));
    insertOpenShift("planted:pc08:unit-b-day", "B", "D8", PC01_DATE.plusDays(1), "EXTRA_COVERAGE");

    // A shift after the demo week where Tara has no Block: give her two consecutive days off
    // (Sat 28 + Sun 29) and enough 168 h headroom for an 8 h pick-up. Removing the Sun 29 base
    // shift does not touch the golden period or the plan's 30 Nov look-back.
    deleteAssignments("E-001", LocalDate.of(2026, 11, 29));
  }

  // PC-02: an officer finishes a night shift at 07:00 on Thu 26 Nov; an evening slot at 15:00 is
  // exactly eight hours of rest.
  private void plantPc02EightHourRest() {
    String officer = "E-003";
    Instant nightStart = instant(PC02_DATE, "23:00");
    deleteAssignments(officer, PC02_DATE);
    deleteAssignments(officer, PC02_DATE.plusDays(1));
    insertAssignment(
        id("planted:pc02:night"), officer, "A", "N8", nightStart, nightStart.plusSeconds(8 * 3600L),
        PC02_DATE);
    removeOneAssignment("A", "E8", PC02_DATE.plusDays(1));
    insertOpenShift("planted:pc02:evening", "A", "E8", PC02_DATE.plusDays(1), "SICK_CALL");
  }

  // PC-03: Tue 3 Nov, Unit C, a 12-hour P12 shift extended by five hours to 05:00 next day (17
  // hours worked), with the supervisor's emergency reason. The five-hour extension is over the
  // normal four-hour limit, so U-05 blocks it without the override. The assignment stays 12 h;
  // the actual records the 17 h, exactly like a real extension.
  private void plantPc03SeventeenHourOverride() {
    UUID assignment =
        jdbc.query(
            "SELECT s.id FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
                + " JOIN shift_template t ON t.id = s.shift_template_id"
                + " WHERE u.code = 'C' AND t.code = 'P12' AND s.work_date = ? LIMIT 1",
            resultSet -> resultSet.next() ? (UUID) resultSet.getObject(1) : null,
            PC03_DATE);

    Instant start;
    if (assignment == null) {
      start = instant(PC03_DATE, "12:00");
      assignment = id("planted:pc03:long");
      deleteAssignments("E-053", PC03_DATE);
      deleteAssignments("E-053", PC03_DATE.plusDays(1));
      insertAssignment(assignment, "E-053", "C", "P12", start,
          start.plusSeconds(12 * 3600L), PC03_DATE);
    } else {
      start =
          jdbc
              .queryForObject(
                  "SELECT start_at FROM shift_assignment WHERE id = ?",
                  (resultSet, row) -> resultSet.getTimestamp(1).toInstant(),
                  assignment);
    }

    Instant extendedEnd = start.plusSeconds(17 * 3600L);

    UUID override = id("planted:pc03:override");
    jdbc.update(
        "INSERT INTO override (id, reason, rule_codes, rule_set_version_id, created_by, created_at)"
            + " VALUES (?, 'Lockdown, relief unavailable', ?,"
            + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'),"
            + " (SELECT id FROM app_user WHERE username = 'm.ellis'),"
            + " TIMESTAMPTZ '2026-11-04 05:05:00-06')",
        override,
        new String[] {"U-05"});
    jdbc.update("UPDATE shift_assignment SET override_id = ? WHERE id = ?", override, assignment);

    jdbc.update("UPDATE time_entry SET end_at = ?, hours = 17.0 WHERE shift_assignment_id = ?",
        Timestamp.from(extendedEnd), assignment);
  }

  // PC-04: Piotr works four consecutive overnight 00-12 shifts ending Mon 23 Nov; a fifth is open.
  private void plantPc04PiotrFourNights() {
    String piotr = "E-007";
    // Clear the week before the run (a night shift on 19 Nov would end inside the first A12) and the
    // days after it, so the four 12-hour shifts do not push any rolling 168 h window over 60 h.
    for (int day = 7; day >= 1; day--) {
      deleteAssignments(piotr, PC04_START.minusDays(day));
    }
    for (int day = 4; day <= 6; day++) {
      deleteAssignments(piotr, PC04_START.plusDays(day));
    }
    for (int day = 0; day < 4; day++) {
      LocalDate date = PC04_START.plusDays(day);
      deleteAssignments(piotr, date);
      Instant start = instant(date, "00:00");
      insertAssignment(
          id("planted:pc04:" + day), piotr, "CTL", "A12", start, start.plusSeconds(12 * 3600L),
          date);
    }
    removeOneAssignment("CTL", "A12", PC04_START.plusDays(4));
    insertOpenShift("planted:pc04:fifth-night", "CTL", "A12", PC04_START.plusDays(4),
        "SICK_CALL");
  }

  // PC-05: in the locked 26 Oct - 8 Nov period, one officer exactly at 80 h, one 29 minutes over
  // (unpaid under P-04) and one clearly over.
  private void plantPc05PayPeriodBoundary() {
    LocalDate periodStart = LocalDate.of(2026, 10, 26);
    List<String> officers =
        jdbc.query(
            "SELECT DISTINCT e.employee_no FROM time_entry t JOIN employee e ON e.id = t.employee_id"
                + " JOIN pay_period p ON p.id = t.pay_period_id"
                + " WHERE p.start_date = ? AND t.absence_type IS NULL ORDER BY e.employee_no"
                + " LIMIT 3",
            (resultSet, rowNum) -> resultSet.getString(1),
            periodStart);
    if (officers.size() < 3) {
      return;
    }
    setPeriodHours(officers.get(0), periodStart, 80.0);
    setPeriodHours(officers.get(1), periodStart, 80.0 + 29.0 / 60.0);
    setPeriodHours(officers.get(2), periodStart, 84.0);
  }

  // PC-06: T7 needs plural four-night runs for its dry run. Two officers get four overnight shifts
  // in the first four days of the window: no rolling week before that can see them, and the rest of
  // that week is cleared so the 48 hours stay under the weekly ceiling.
  private void plantPc06MoreFourNightRuns() {
    LocalDate runStart = LocalDate.of(2026, 10, 1);
    for (String employeeNo : new String[] {"E-001", "E-004"}) {
      for (int day = 4; day <= 8; day++) {
        deleteAssignments(employeeNo, runStart.plusDays(day));
      }
      for (int day = 0; day < 4; day++) {
        LocalDate date = runStart.plusDays(day);
        // Replace whatever that day held, so the four dates are consecutive nights.
        deleteAssignments(employeeNo, date);
        Instant start = instant(date, "00:00");
        UUID assignmentId = id("planted:pc06:" + employeeNo + ":" + day);
        insertAssignment(
            assignmentId, employeeNo, unitFor(employeeNo), "A12", start,
            start.plusSeconds(12 * 3600L), date);
        // The run sits in the past, so it carries an actual like every other worked shift (ADR-017).
        jdbc.update(
            "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id,"
                + " work_date, start_at, end_at, hours, entry_type, pay_code, rule_set_version_id)"
                + " VALUES (?, (SELECT id FROM employee WHERE employee_no = ?),"
                + " (SELECT id FROM pay_period WHERE ? BETWEEN start_date AND end_date), ?, ?, ?, ?,"
                + " 12.0, 'ACTUAL', 'REG',"
                + " (SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'))",
            id("time-entry:pc06:" + employeeNo + ":" + day),
            employeeNo,
            date,
            assignmentId,
            date,
            Timestamp.from(start),
            Timestamp.from(start.plusSeconds(12 * 3600L)));
      }
    }
  }

  private String unitFor(String employeeNo) {
    return jdbc.queryForObject(
        "SELECT u.code FROM employee e JOIN unit u ON u.id = e.home_unit_id"
            + " WHERE e.employee_no = ?",
        String.class,
        employeeNo);
  }

  private static LocalDate localDate(Object value) {
    if (value instanceof LocalDate date) {
      return date;
    }
    return ((java.sql.Date) value).toLocalDate();
  }

  // PC-09: an open Control shift exists; the self-check proves the officer with the fewest overtime
  // hours this quarter is not Control-qualified.
  private void plantPc09ControlCandidate() {
    LocalDate date = LocalDate.of(2026, 11, 24);
    removeOneAssignment("CTL", "D8", date);
    insertOpenShift("planted:pc09:control-day", "CTL", "D8", date, "SICK_CALL");
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private void setPeriodHours(String employeeNo, LocalDate periodStart, double targetHours) {
    record Entry(UUID id, double hours) {}
    List<Entry> entries =
        jdbc.query(
            "SELECT t.id, t.hours FROM time_entry t JOIN employee e ON e.id = t.employee_id"
                + " JOIN pay_period p ON p.id = t.pay_period_id"
                + " WHERE e.employee_no = ? AND p.start_date = ? AND t.absence_type IS NULL"
                + " ORDER BY t.start_at",
            (resultSet, rowNum) -> new Entry((UUID) resultSet.getObject(1), resultSet.getDouble(2)),
            employeeNo,
            periodStart);
    if (entries.isEmpty()) {
      return;
    }

    double current = entries.stream().mapToDouble(Entry::hours).sum();
    double remaining = targetHours - current;

    // Spread the difference from the last entry backwards so no entry falls to zero hours (the
    // schema requires end_at > start_at) and none exceeds a 16-hour day.
    for (int i = entries.size() - 1; i >= 0 && Math.abs(remaining) > 0.001; i--) {
      Entry entry = entries.get(i);
      double updated = Math.max(0.25, Math.min(16.0, entry.hours() + remaining));
      remaining -= updated - entry.hours();
      jdbc.update(
          "UPDATE time_entry SET hours = ?,"
              + " end_at = start_at + make_interval(secs => ? * 3600) WHERE id = ?",
          updated,
          updated,
          entry.id());
    }
  }

  private void deleteAssignments(String employeeNo, LocalDate date) {
    // A past shift has an actual and maybe an absence; both reference the assignment, so they go
    // first. The self-check then sees no shift at all rather than a shift with no actual.
    String ids =
        "SELECT id FROM shift_assignment WHERE employee_id ="
            + " (SELECT id FROM employee WHERE employee_no = ?) AND work_date = ?";
    jdbc.update("DELETE FROM time_entry WHERE shift_assignment_id IN (" + ids + ")", employeeNo, date);
    jdbc.update("DELETE FROM absence WHERE shift_assignment_id IN (" + ids + ")", employeeNo, date);
    jdbc.update(
        "DELETE FROM shift_assignment WHERE employee_id ="
            + " (SELECT id FROM employee WHERE employee_no = ?) AND work_date = ?",
        employeeNo,
        date);
  }

  private void removeOneAssignment(String unitCode, String templateCode, LocalDate date) {
    UUID id =
        jdbc.query(
            "SELECT s.id FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
                + " JOIN shift_template t ON t.id = s.shift_template_id"
                + " WHERE u.code = ? AND t.code = ? AND s.work_date = ? LIMIT 1",
            resultSet -> resultSet.next() ? (UUID) resultSet.getObject(1) : null,
            unitCode,
            templateCode,
            date);
    if (id != null) {
      jdbc.update("DELETE FROM time_entry WHERE shift_assignment_id = ?", id);
      jdbc.update("DELETE FROM absence WHERE shift_assignment_id = ?", id);
      jdbc.update("DELETE FROM shift_assignment WHERE id = ?", id);
    }
  }

  private void insertAssignment(
      UUID id, String employeeNo, String unitCode, String templateCode, Instant start, Instant end,
      LocalDate workDate) {
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source)"
            + " VALUES (?, (SELECT id FROM employee WHERE employee_no = ?),"
            + " (SELECT id FROM unit WHERE code = ?), (SELECT id FROM shift_template WHERE code = ?),"
            + " ?, ?, ?, 'ROSTERED', 'MANUAL')",
        id,
        employeeNo,
        unitCode,
        templateCode,
        Timestamp.from(start),
        Timestamp.from(end),
        workDate);
  }

  private void insertOpenShift(
      String key, String unitCode, String templateCode, LocalDate date, String reason) {
    Instant start =
        date.atTime(templateStart(templateCode)).atZone(BusinessTime.REGINA).toInstant();
    Instant end = start.plusSeconds(templateMinutes(templateCode) * 60L);
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " VALUES (?, (SELECT id FROM unit WHERE code = ?),"
            + " (SELECT id FROM shift_template WHERE code = ?), ?, ?, ?, 'OPEN')",
        id(key),
        unitCode,
        templateCode,
        Timestamp.from(start),
        Timestamp.from(end),
        reason);
  }

  private static LocalTime templateStart(String template) {
    return switch (template) {
      case "D8" -> LocalTime.of(7, 0);
      case "E8" -> LocalTime.of(15, 0);
      case "A12" -> LocalTime.of(0, 0);
      case "P12" -> LocalTime.of(12, 0);
      case "L16" -> LocalTime.of(20, 0);
      default -> LocalTime.of(23, 0);
    };
  }

  private static int templateMinutes(String template) {
    return switch (template) {
      case "A12", "P12" -> 720;
      case "L16" -> 960;
      default -> 480;
    };
  }

  private static Instant instant(LocalDate date, String time) {
    return date.atTime(LocalTime.parse(time)).atZone(BusinessTime.REGINA).toInstant();
  }

  private static UUID id(String key) {
    return DemoDataGenerator.id(key);
  }
}
