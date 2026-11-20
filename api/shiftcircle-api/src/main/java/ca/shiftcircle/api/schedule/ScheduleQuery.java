package ca.shiftcircle.api.schedule;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Builds the planning-board payload in the shape the web builds against (docs/07 §4.2 and
 * {@code web/src/api/types.ts}): a flat coverage list per block and day, and officer rows with day
 * cells.
 *
 * <p>Coverage is hourly (ADR-013 revised): each block reports the lowest hourly headcount, the merged
 * hour ranges below the requirement, and whether the block is covered (ADR-017).
 */
@Service
public class ScheduleQuery {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  private final JdbcTemplate jdbc;
  private final String asOf;

  public ScheduleQuery(JdbcTemplate jdbc, @Value("${sc.demo.today:2026-11-19}") String asOf) {
    this.jdbc = jdbc;
    this.asOf = asOf;
  }

  public record UnitView(UUID id, String name) {}

  public record ShortHour(String from, String to, int count) {}

  public record HourlyCoverage(int lowestHourly, List<ShortHour> shortHours, int maxHourly) {}

  public record BlockCoverage(
      String block, LocalDate date, int required, HourlyCoverage scheduled,
      HourlyCoverage actual, boolean covered) {}

  public record ShiftItem(
      String type, UUID assignmentId, String shiftTemplate, String startAt, String endAt,
      String kind, boolean worked) {}

  public record DayCell(LocalDate date, List<ShiftItem> items) {}

  public record OfficerRow(
      UUID employeeId, String name, String rotation, List<String> qualifications,
      double payPeriodHours, double payPeriodThreshold, String overtimeStatus, List<DayCell> cells) {}

  public record PublishedState(boolean published, int unpublishedChanges) {}

  public record SchedulePayload(
      UnitView unit, LocalDate from, LocalDate to, List<LocalDate> days, String asOf,
      List<BlockCoverage> coverage, List<OfficerRow> officers, int warnings,
      int overridesThisPeriod, PublishedState publishedState) {}

  public String unitCode(UUID unitId) {
    return jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, unitId);
  }

  public SchedulePayload forUnit(UUID unitId, LocalDate from, LocalDate to) {
    Map<String, Object> unitRow =
        jdbc.queryForMap("SELECT id, code, name FROM unit WHERE id = ?", unitId);
    UnitView unit = new UnitView((UUID) unitRow.get("id"), (String) unitRow.get("name"));

    Map<String, Integer> required = new LinkedHashMap<>();
    jdbc.query(
        "SELECT block, min_staff FROM unit_requirement WHERE unit_id = ?",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                required.put(resultSet.getString("block"), resultSet.getInt("min_staff")),
        unitId);

    List<Map<String, Object>> assignments =
        jdbc.queryForList(
            "SELECT s.id, s.employee_id, e.first_name, e.last_name, t.code AS template_code,"
                + " s.start_at, s.end_at, s.work_date, s.kind,"
                + " EXISTS (SELECT 1 FROM time_entry te WHERE te.shift_assignment_id = s.id"
                + "   AND te.absence_type IS NULL) AS worked"
                + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                + " JOIN shift_template t ON t.id = s.shift_template_id"
                + " WHERE s.unit_id = ? AND s.status <> 'CANCELLED'"
                + " AND s.work_date BETWEEN ? AND ? ORDER BY s.start_at",
            unitId,
            from,
            to);

    List<Map<String, Object>> actuals =
        jdbc.queryForList(
            "SELECT te.start_at, te.end_at FROM time_entry te"
                + " JOIN shift_assignment s ON s.id = te.shift_assignment_id"
                + " WHERE s.unit_id = ? AND s.work_date BETWEEN ? AND ?"
                + " AND te.absence_type IS NULL",
            unitId,
            from,
            to);

    List<LocalDate> days = new ArrayList<>();
    for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
      days.add(date);
    }

    List<BlockCoverage> coverage = new ArrayList<>();
    for (LocalDate date : days) {
      for (String block : List.of("DAY", "EVENING", "NIGHT")) {
        int need = required.getOrDefault(block, 0);
        int[] scheduledHours = hourly(date, assignments, true);
        int[] actualHours = hourly(date, actuals, false);
        HourlyCoverage scheduled = coverage(need, scheduledHours, block);
        HourlyCoverage actual =
            date.isBefore(LocalDate.now(REGINA)) ? coverage(need, actualHours, block) : null;
        coverage.add(
            new BlockCoverage(block, date, need, scheduled, actual,
                scheduled.shortHours().isEmpty()));
      }
    }

    Map<UUID, Map<String, Object>> officers = new LinkedHashMap<>();
    Map<UUID, List<Map<String, Object>>> shiftsByOfficer = new LinkedHashMap<>();
    for (Map<String, Object> assignment : assignments) {
      UUID employeeId = (UUID) assignment.get("employee_id");
      officers.putIfAbsent(employeeId, assignment);
      shiftsByOfficer.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(assignment);
    }

    Map<UUID, Double> periodHours = periodHours(from);
    Map<UUID, List<String>> qualifications = qualifications(officers.keySet());

    List<OfficerRow> rows = new ArrayList<>();
    officers.forEach(
        (employeeId, row) -> {
          double hours = periodHours.getOrDefault(employeeId, 0.0);
          String status = hours >= 80 ? "IN_OVERTIME" : hours >= 72 ? "APPROACHING" : "UNDER";

          Map<LocalDate, List<ShiftItem>> itemsByDay = new LinkedHashMap<>();
          for (LocalDate date : days) {
            itemsByDay.put(date, new ArrayList<>());
          }
          for (Map<String, Object> shift : shiftsByOfficer.getOrDefault(employeeId, List.of())) {
            itemsByDay
                .getOrDefault(localDate(shift.get("work_date")), new ArrayList<>())
                .add(
                    new ShiftItem(
                        "SHIFT",
                        (UUID) shift.get("id"),
                        (String) shift.get("template_code"),
                        format((java.sql.Timestamp) shift.get("start_at")),
                        format((java.sql.Timestamp) shift.get("end_at")),
                        (String) shift.get("kind"),
                        Boolean.TRUE.equals(shift.get("worked"))));
          }
          List<DayCell> cells = new ArrayList<>();
          itemsByDay.forEach((date, items) -> cells.add(new DayCell(date, items)));

          rows.add(
              new OfficerRow(
                  employeeId,
                  row.get("first_name") + " " + row.get("last_name"),
                  "",
                  qualifications.getOrDefault(employeeId, List.of()),
                  Math.round(hours * 100.0) / 100.0,
                  80.0,
                  status,
                  cells));
        });

    Integer publishedCount =
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

    return new SchedulePayload(
        unit,
        from,
        to,
        days,
        asOf,
        coverage,
        rows,
        0,
        overrides == null ? 0 : overrides,
        new PublishedState(publishedCount != null && publishedCount > 0, 0));
  }

  private Map<UUID, Double> periodHours(LocalDate from) {
    Map<UUID, Double> hours = new LinkedHashMap<>();
    List<LocalDate> periodStarts =
        jdbc.queryForList(
            "SELECT start_date FROM pay_period WHERE ? BETWEEN start_date AND end_date",
            LocalDate.class,
            from);
    if (periodStarts.isEmpty()) {
      return hours;
    }
    jdbc.query(
        "SELECT employee_id, coalesce(sum(hours), 0) AS h FROM time_entry"
            + " WHERE pay_period_id = (SELECT id FROM pay_period WHERE start_date = ?)"
            + " AND absence_type IS NULL GROUP BY employee_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                hours.put((UUID) resultSet.getObject("employee_id"), resultSet.getDouble("h")),
        periodStarts.get(0));
    return hours;
  }

  private Map<UUID, List<String>> qualifications(java.util.Set<UUID> employeeIds) {
    Map<UUID, List<String>> qualifications = new LinkedHashMap<>();
    if (employeeIds.isEmpty()) {
      return qualifications;
    }
    jdbc.query(
        "SELECT eq.employee_id, q.code FROM employee_qualification eq"
            + " JOIN qualification q ON q.id = eq.qualification_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                qualifications
                    .computeIfAbsent(
                        (UUID) resultSet.getObject("employee_id"), key -> new ArrayList<>())
                    .add(resultSet.getString("code")));
    return qualifications;
  }

  /** Hourly headcount for the day, for assignments or actual entries. */
  private int[] hourly(LocalDate date, List<Map<String, Object>> entries, boolean assignments) {
    int[] counts = new int[24];
    for (Map<String, Object> entry : entries) {
      if (assignments) {
        if (!localDate(entry.get("work_date")).equals(date)) {
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

  private HourlyCoverage coverage(int required, int[] hourly, String block) {
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

    return new HourlyCoverage(lowest == Integer.MAX_VALUE ? 0 : lowest, shortHours, highest);
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
    return String.format("%02d:00", hour % 24);
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
