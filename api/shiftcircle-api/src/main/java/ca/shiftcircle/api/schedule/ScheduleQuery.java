package ca.shiftcircle.api.schedule;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Builds the planning-board payload (docs/07 §4.2). Coverage is hourly (ADR-013 revised): each block
 * reports the lowest hourly headcount, the merged hour ranges below the requirement, and whether the
 * block is covered (ADR-017).
 */
@Service
public class ScheduleQuery {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  private final JdbcTemplate jdbc;

  public ScheduleQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public record UnitView(UUID id, String code, String name) {}

  public record ShortHour(String from, String to, int count) {}

  public record Coverage(int required, int lowestHourly, int maxHourly, List<ShortHour> shortHours,
      boolean covered) {}

  public record BlockCoverage(String block, LocalDate date, int required, Coverage scheduled,
      Coverage actual, boolean covered) {}

  public record DayView(LocalDate date, Map<String, BlockCoverage> blocks) {}

  public record AssignmentView(UUID id, LocalDate date, String templateCode, String label,
      String start, String end, String kind, String status, String absenceType) {}

  public record OfficerView(UUID id, String employeeNo, String firstName, String lastName,
      double hoursThisPeriod, String overtimeStatus, List<AssignmentView> assignments) {}

  public record ScheduleView(UnitView unit, LocalDate from, LocalDate to, String asOf,
      String publishedState, int overridesThisPeriod, List<DayView> days, List<OfficerView> officers) {}

  /** Unit code for scope checks. */
  public String unitCode(UUID unitId) {
    return jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, unitId);
  }

  public ScheduleView forUnit(UUID unitId, LocalDate from, LocalDate to) {
    Map<String, Object> unitRow =
        jdbc.queryForMap("SELECT id, code, name FROM unit WHERE id = ?", unitId);
    UnitView unit =
        new UnitView(
            (UUID) unitRow.get("id"),
            (String) unitRow.get("code"),
            (String) unitRow.get("name"));

    Map<String, Integer> required = new LinkedHashMap<>();
    jdbc.query(
        "SELECT block, min_staff FROM unit_requirement WHERE unit_id = ?",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                required.put(resultSet.getString("block"), resultSet.getInt("min_staff")),
        unitId);

    List<Map<String, Object>> assignments =
        jdbc.queryForList(
            "SELECT s.id, s.employee_id, e.employee_no, e.first_name, e.last_name,"
                + " t.code AS template_code, t.label, s.start_at, s.end_at, s.work_date, s.kind,"
                + " s.status, a.type AS absence_type"
                + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                + " JOIN shift_template t ON t.id = s.shift_template_id"
                + " LEFT JOIN absence a ON a.shift_assignment_id = s.id"
                + " WHERE s.unit_id = ? AND s.status <> 'CANCELLED'"
                + " AND s.work_date BETWEEN ? AND ? ORDER BY s.start_at",
            unitId,
            from,
            to);

    List<Map<String, Object>> actuals =
        jdbc.queryForList(
            "SELECT te.employee_id, te.start_at, te.end_at FROM time_entry te"
                + " JOIN shift_assignment s ON s.id = te.shift_assignment_id"
                + " WHERE s.unit_id = ? AND s.work_date BETWEEN ? AND ?"
                + " AND te.absence_type IS NULL",
            unitId,
            from,
            to);

    Map<LocalDate, List<Map<String, Object>>> byDay = new LinkedHashMap<>();
    for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
      byDay.put(date, new ArrayList<>());
    }
    assignments.forEach(
        assignment ->
            byDay
                .getOrDefault(localDate(assignment.get("work_date")), new ArrayList<>())
                .add(assignment));

    List<DayView> days = new ArrayList<>();
    byDay.forEach((date, dayAssignments) -> days.add(dayView(date, required, dayAssignments, actuals)));

    Map<UUID, List<AssignmentView>> assignmentsByOfficer = new LinkedHashMap<>();
    Map<UUID, Map<String, Object>> officerRows = new LinkedHashMap<>();
    for (Map<String, Object> assignment : assignments) {
      UUID employeeId = (UUID) assignment.get("employee_id");
      officerRows.putIfAbsent(employeeId, assignment);
      assignmentsByOfficer
          .computeIfAbsent(employeeId, key -> new ArrayList<>())
          .add(
              new AssignmentView(
                  (UUID) assignment.get("id"),
                  localDate(assignment.get("work_date")),
                  (String) assignment.get("template_code"),
                  (String) assignment.get("label"),
                  format((java.sql.Timestamp) assignment.get("start_at")),
                  format((java.sql.Timestamp) assignment.get("end_at")),
                  (String) assignment.get("kind"),
                  (String) assignment.get("status"),
                  (String) assignment.get("absence_type")));
    }

    LocalDate periodStart =
        jdbc.queryForObject(
            "SELECT start_date FROM pay_period WHERE ? BETWEEN start_date AND end_date",
            LocalDate.class,
            from);
    Map<UUID, Double> periodHours = new LinkedHashMap<>();
    jdbc.query(
        "SELECT employee_id, coalesce(sum(hours), 0) AS h FROM time_entry"
            + " WHERE pay_period_id = (SELECT id FROM pay_period WHERE start_date = ?)"
            + " AND absence_type IS NULL GROUP BY employee_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                periodHours.put(
                    (UUID) resultSet.getObject("employee_id"), resultSet.getDouble("h")),
        periodStart);

    List<OfficerView> officers = new ArrayList<>();
    officerRows.forEach(
        (employeeId, row) -> {
          double hours = periodHours.getOrDefault(employeeId, 0.0);
          String status = hours >= 80 ? "OVER" : hours >= 72 ? "APPROACHING" : "UNDER";
          officers.add(
              new OfficerView(
                  employeeId,
                  (String) row.get("employee_no"),
                  (String) row.get("first_name"),
                  (String) row.get("last_name"),
                  Math.round(hours * 100.0) / 100.0,
                  status,
                  assignmentsByOfficer.getOrDefault(employeeId, List.of())));
        });

    Integer published =
        jdbc.queryForObject(
            "SELECT count(*) FROM schedule_period WHERE unit_id = ? AND status = 'PUBLISHED'"
                + " AND start_date <= ? AND end_date >= ?",
            Integer.class,
            unitId,
            to,
            from);
    Integer overrides =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment WHERE unit_id = ? AND override_id IS NOT NULL"
                + " AND work_date BETWEEN ? AND ?",
            Integer.class,
            unitId,
            from,
            to);

    return new ScheduleView(
        unit,
        from,
        to,
        java.time.Instant.now().toString(),
        published != null && published > 0 ? "PUBLISHED" : "DRAFT",
        overrides == null ? 0 : overrides,
        days,
        officers);
  }

  private DayView dayView(
      LocalDate date,
      Map<String, Integer> required,
      List<Map<String, Object>> dayAssignments,
      List<Map<String, Object>> actuals) {
    Map<String, BlockCoverage> blocks = new LinkedHashMap<>();
    for (String block : List.of("DAY", "EVENING", "NIGHT")) {
      int need = required.getOrDefault(block, 0);
      int[] scheduledHours = hourly(date, dayAssignments, true);
      int[] actualHours = hourly(date, actuals, false);
      Coverage scheduled = coverage(need, scheduledHours, block);
      Coverage actual =
          date.isBefore(LocalDate.now(REGINA)) ? coverage(need, actualHours, block) : null;
      boolean covered = scheduled.shortHours().isEmpty();
      blocks.put(
          block,
          new BlockCoverage(block, date, need, scheduled, actual, covered));
    }
    return new DayView(date, blocks);
  }

  /** Hourly headcount for the day, for assignments or actual entries. */
  private int[] hourly(LocalDate date, List<Map<String, Object>> entries, boolean assignments) {
    int[] counts = new int[24];
    for (Map<String, Object> entry : entries) {
      if (assignments) {
        if (entry.get("absence_type") != null) {
          continue; // an absent officer does not cover the hour
        }
        LocalDate day = localDate(entry.get("work_date"));
        if (!day.equals(date)) {
          continue;
        }
      }
      java.time.Instant start = ((java.sql.Timestamp) entry.get("start_at")).toInstant();
      java.time.Instant end = ((java.sql.Timestamp) entry.get("end_at")).toInstant();
      if (!start.atZone(REGINA).toLocalDate().equals(date)) {
        continue;
      }
      for (int hour = 0; hour < 24; hour++) {
        java.time.Instant hourStart = date.atTime(hour, 0).atZone(REGINA).toInstant();
        java.time.Instant hourEnd = hourStart.plusSeconds(3600);
        if (start.isBefore(hourEnd) && end.isAfter(hourStart)) {
          counts[hour]++;
        }
      }
    }
    return counts;
  }

  private Coverage coverage(int required, int[] hourly, String block) {
    int from = blockFrom(block);
    int to = blockTo(block);
    int lowest = Integer.MAX_VALUE;
    int highest = 0;
    List<ShortHour> shortHours = new ArrayList<>();
    int runStart = -1;
    int runCount = 0;

    for (int hour = from; hour < to; hour++) {
      int count = hourly[hour % 24];
      lowest = Math.min(lowest, count);
      highest = Math.max(highest, count);
      if (count < required) {
        if (runStart < 0) {
          runStart = hour;
          runCount = count;
        } else {
          runCount = Math.min(runCount, count);
        }
      } else if (runStart >= 0) {
        shortHours.add(new ShortHour(time(runStart), time(hour), runCount));
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      shortHours.add(new ShortHour(time(runStart), time(to), runCount));
    }

    return new Coverage(required, lowest == Integer.MAX_VALUE ? 0 : lowest, highest, shortHours,
        shortHours.isEmpty());
  }

  private static int blockFrom(String block) {
    return switch (block) {
      case "DAY" -> 7;
      case "EVENING" -> 15;
      default -> 23;
    };
  }

  private static int blockTo(String block) {
    return switch (block) {
      case "DAY" -> 15;
      case "EVENING" -> 23;
      default -> 31;
    };
  }

  private static String time(int hour) {
    int wrapped = hour % 24;
    return String.format("%02d:00", wrapped);
  }

  private static LocalDate localDate(Object value) {
    if (value instanceof LocalDate date) {
      return date;
    }
    return ((java.sql.Date) value).toLocalDate();
  }

  private static String format(java.sql.Timestamp timestamp) {
    return timestamp.toInstant().atZone(REGINA).toOffsetDateTime().toString();
  }
}
