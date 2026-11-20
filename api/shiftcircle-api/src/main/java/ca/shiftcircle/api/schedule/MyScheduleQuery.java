package ca.shiftcircle.api.schedule;

import ca.shiftcircle.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The employee's own schedule (docs/07 §4.2): their shifts in a range, their pay-period hours, their
 * overtime this quarter and their place on the overtime list. Only their own data; the caller's
 * linked officer is the subject, never a request parameter.
 */
@Service
public class MyScheduleQuery {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final DateTimeFormatter MONTH_DAY =
      DateTimeFormatter.ofPattern("MMM d", Locale.ENGLISH);
  private static final DateTimeFormatter MONTH_YEAR =
      DateTimeFormatter.ofPattern("MMM yyyy", Locale.ENGLISH);

  public record UnitView(UUID id, String name) {}

  public record EmployeeView(
      UUID id, String name, String role, UnitView unit, String rotation,
      List<String> qualifications) {}

  public record NextShiftView(
      LocalDate date, String startAt, String endAt, String shiftTemplate, UnitView unit) {}

  public record PayPeriodView(
      String label, double workedHours, double scheduledHours, double totalHours,
      double thresholdHours) {}

  public record OvertimeView(double hours, int rank, int of) {}

  public record ShiftItem(
      String type, String assignmentId, String shiftTemplate, String startAt, String endAt,
      String kind, boolean worked, int version) {}

  public record AbsenceItem(String type, String absenceType) {}

  public record DayCell(LocalDate date, List<Object> items) {}

  public record MySchedulePayload(
      String asOf, EmployeeView employee, NextShiftView nextShift, PayPeriodView payPeriod,
      OvertimeView overtimeThisQuarter, List<LocalDate> days, List<DayCell> shifts) {}

  private final JdbcTemplate jdbc;
  private final LocalDate asOf;

  public MyScheduleQuery(JdbcTemplate jdbc, @Value("${sc.demo.today:2026-11-19}") String asOf) {
    this.jdbc = jdbc;
    this.asOf = LocalDate.parse(asOf);
  }

  public MySchedulePayload forEmployee(
      AuthPrincipal principal, LocalDate from, LocalDate to) {
    UUID employeeId = principal.employeeId();
    if (employeeId == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No employee record for this user");
    }
    LocalDate first = from == null ? asOf.withDayOfMonth(1) : from;
    LocalDate last = to == null ? first.withDayOfMonth(first.lengthOfMonth()) : to;
    if (last.isBefore(first) || last.toEpochDay() - first.toEpochDay() > 62) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "from and to must span at most 62 days, in order");
    }

    Map<String, Object> employee =
        jdbc.queryForMap(
            "SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.classification,"
                + " e.seniority_date, u.id AS unit_id, u.name AS unit_name, rp.name AS rotation"
                + " FROM employee e LEFT JOIN unit u ON u.id = e.home_unit_id"
                + " LEFT JOIN rotation_pattern rp ON rp.id = e.rotation_pattern_id"
                + " WHERE e.id = ?",
            employeeId);

    List<LocalDate> days = new ArrayList<>();
    for (LocalDate date = first; !date.isAfter(last); date = date.plusDays(1)) {
      days.add(date);
    }

    Map<LocalDate, List<Object>> items = new LinkedHashMap<>();
    for (LocalDate date : days) {
      items.put(date, new ArrayList<>());
    }

    jdbc.query(
        "SELECT s.id, t.code AS template_code, s.start_at, s.end_at, s.work_date, s.kind,"
            + " s.version,"
            + " EXISTS (SELECT 1 FROM time_entry te WHERE te.shift_assignment_id = s.id"
            + "   AND te.absence_type IS NULL) AS worked"
            + " FROM shift_assignment s JOIN shift_template t ON t.id = s.shift_template_id"
            + " WHERE s.employee_id = ? AND s.status <> 'CANCELLED'"
            + " AND s.work_date BETWEEN ? AND ? ORDER BY s.start_at",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> {
              LocalDate date = resultSet.getDate("work_date").toLocalDate();
              items
                  .computeIfAbsent(date, key -> new ArrayList<>())
                  .add(
                      new ShiftItem(
                          "SHIFT",
                          resultSet.getObject("id").toString(),
                          resultSet.getString("template_code"),
                          resultSet.getTimestamp("start_at").toInstant().toString(),
                          resultSet.getTimestamp("end_at").toInstant().toString(),
                          resultSet.getString("kind"),
                          resultSet.getBoolean("worked"),
                          resultSet.getInt("version")));
            },
        employeeId,
        first,
        last);

    jdbc.query(
        "SELECT type, start_at FROM absence WHERE employee_id = ?"
            + " AND (start_at AT TIME ZONE 'America/Regina')::date BETWEEN ? AND ?"
            + " ORDER BY start_at",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> {
              LocalDate date =
                  resultSet
                      .getTimestamp("start_at")
                      .toInstant()
                      .atZone(REGINA)
                      .toLocalDate();
              items
                  .computeIfAbsent(date, key -> new ArrayList<>())
                  .add(new AbsenceItem("ABSENCE", resultSet.getString("type")));
            },
        employeeId,
        first,
        last);

    List<DayCell> cells = new ArrayList<>();
    items.forEach((date, dayItems) -> cells.add(new DayCell(date, dayItems)));

    return new MySchedulePayload(
        asOf.toString(),
        new EmployeeView(
            employeeId,
            (String) employee.get("name"),
            (String) employee.get("classification"),
            employee.get("unit_id") == null
                ? null
                : new UnitView((UUID) employee.get("unit_id"), (String) employee.get("unit_name")),
            employee.get("rotation") == null ? "" : (String) employee.get("rotation"),
            qualifications(employeeId)),
        nextShift(employeeId),
        payPeriod(employeeId),
        overtime(employeeId),
        days,
        cells);
  }

  private NextShiftView nextShift(UUID employeeId) {
    Instant now = asOf.atTime(LocalTime.NOON).atZone(REGINA).toInstant();
    List<NextShiftView> shifts =
        jdbc.query(
            "SELECT s.start_at, s.end_at, s.work_date, t.code AS template_code, u.id AS unit_id,"
                + " u.name AS unit_name FROM shift_assignment s"
                + " JOIN shift_template t ON t.id = s.shift_template_id"
                + " JOIN unit u ON u.id = s.unit_id"
                + " WHERE s.employee_id = ? AND s.status <> 'CANCELLED' AND s.start_at >= ?"
                + " ORDER BY s.start_at LIMIT 1",
            (resultSet, rowNum) ->
                new NextShiftView(
                    resultSet.getDate("work_date").toLocalDate(),
                    resultSet.getTimestamp("start_at").toInstant().toString(),
                    resultSet.getTimestamp("end_at").toInstant().toString(),
                    resultSet.getString("template_code"),
                    new UnitView(
                        (UUID) resultSet.getObject("unit_id"), resultSet.getString("unit_name"))),
            employeeId,
            java.sql.Timestamp.from(now));
    return shifts.isEmpty() ? null : shifts.get(0);
  }

  private PayPeriodView payPeriod(UUID employeeId) {
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT id, start_date, end_date FROM pay_period WHERE ? BETWEEN start_date AND end_date",
            asOf);
    double threshold = thresholdHours();
    if (periods.isEmpty()) {
      return new PayPeriodView("", 0, 0, 0, threshold);
    }
    Map<String, Object> period = periods.get(0);
    UUID periodId = (UUID) period.get("id");
    LocalDate start = ((java.sql.Date) period.get("start_date")).toLocalDate();
    LocalDate end = ((java.sql.Date) period.get("end_date")).toLocalDate();

    Double worked =
        jdbc.queryForObject(
            "SELECT coalesce(sum(hours), 0) FROM time_entry WHERE employee_id = ?"
                + " AND pay_period_id = ? AND entry_type = 'ACTUAL' AND absence_type IS NULL",
            Double.class,
            employeeId,
            periodId);
    Instant now = asOf.atTime(LocalTime.NOON).atZone(REGINA).toInstant();
    Double scheduled =
        jdbc.queryForObject(
            "SELECT coalesce(sum(extract(epoch from (end_at - start_at)) / 3600.0), 0)"
                + " FROM shift_assignment WHERE employee_id = ? AND status <> 'CANCELLED'"
                + " AND (work_date BETWEEN ? AND ?)"
                + " AND start_at > ?",
            Double.class,
            employeeId,
            start,
            end,
            java.sql.Timestamp.from(now));
    double workedHours = worked == null ? 0 : round(worked);
    double scheduledHours = scheduled == null ? 0 : round(scheduled);
    String label =
        MONTH_DAY.format(start)
            + " – "
            + (start.getMonth() == end.getMonth() ? String.valueOf(end.getDayOfMonth())
                : MONTH_DAY.format(end))
            + ", "
            + MONTH_YEAR.format(end);
    return new PayPeriodView(label, workedHours, scheduledHours,
        round(workedHours + scheduledHours), threshold);
  }

  private double thresholdHours() {
    List<String> thresholds =
        jdbc.queryForList(
            "SELECT r.params->>'thresholdHours' FROM rule_row r"
                + " JOIN rule_set_version v ON v.id = r.rule_set_version_id"
                + " WHERE v.status = 'PUBLISHED' AND r.code = 'P-01' AND r.enabled",
            String.class);
    if (thresholds.isEmpty() || thresholds.get(0) == null) {
      return 80.0;
    }
    return Double.parseDouble(thresholds.get(0));
  }

  private OvertimeView overtime(UUID employeeId) {
    LocalDate quarterStart =
        asOf.withMonth(((asOf.getMonthValue() - 1) / 3) * 3 + 1).withDayOfMonth(1);
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT e.id, coalesce(sum(CASE WHEN te.pay_code IN ('OT15', 'OT20')"
                + " THEN te.hours ELSE 0 END), 0) AS ot"
                + " FROM employee e"
                + " LEFT JOIN time_entry te ON te.employee_id = e.id"
                + "   AND te.start_at >= ?"
                + " WHERE e.active GROUP BY e.id, e.seniority_date"
                + " ORDER BY ot, e.seniority_date, e.id",
            java.sql.Timestamp.from(quarterStart.atStartOfDay(REGINA).toInstant()));
    int rank = 1;
    for (Map<String, Object> row : rows) {
      if (employeeId.equals(row.get("id"))) {
        return new OvertimeView(round(((Number) row.get("ot")).doubleValue()), rank, rows.size());
      }
      rank++;
    }
    return new OvertimeView(0, rows.size() + 1, rows.size());
  }

  private List<String> qualifications(UUID employeeId) {
    return jdbc.queryForList(
        "SELECT q.code FROM employee_qualification eq"
            + " JOIN qualification q ON q.id = eq.qualification_id WHERE eq.employee_id = ?",
        String.class,
        employeeId);
  }

  private static double round(double value) {
    return Math.round(value * 100.0) / 100.0;
  }
}
