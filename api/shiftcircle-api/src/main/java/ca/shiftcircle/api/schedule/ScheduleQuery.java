package ca.shiftcircle.api.schedule;

import ca.shiftcircle.api.coverage.CoverageCalculator;
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
  private final ca.shiftcircle.api.units.ActiveUnits activeUnits;

  public ScheduleQuery(
      JdbcTemplate jdbc,
      @Value("${sc.demo.today:2026-11-19}") String asOf,
      ca.shiftcircle.api.units.ActiveUnits activeUnits) {
    this.jdbc = jdbc;
    this.asOf = asOf;
    this.activeUnits = activeUnits;
  }

  public record UnitView(
      UUID id,
      String name,
      LocalDate closedFrom,
      LocalDate closedTo,
      String closedLabel,
      String closedReason,
      List<LocalDate> closedDates) {}

  public record ShortHour(String from, String to, int count) {}

  public record HourlyCoverage(int lowestHourly, List<ShortHour> shortHours, int maxHourly) {}

  public record BlockCoverage(
      String block, LocalDate date, int required, HourlyCoverage scheduled,
      HourlyCoverage actual, boolean covered) {}

  public record ShiftItem(
      String type, UUID assignmentId, String shiftTemplate, String startAt, String endAt,
      String kind, boolean worked, int version, boolean edited) {}

  public record DayCell(LocalDate date, List<ShiftItem> items) {}

  public record OfficerRow(
      UUID employeeId, String name, String rotation, List<String> qualifications,
      double payPeriodHours, double payPeriodThreshold, String overtimeStatus, List<DayCell> cells) {}

  /**
   * Whether the board's period is published, and how many of its shifts changed after the
   * publication. The count is null when the period is not published: there is nothing to compare
   * against yet, and the board says "not published".
   */
  public record PublishedState(boolean published, Integer unpublishedChanges) {}

  /**
   * The roster week the board shows: the period that covers the board's range, with the id the
   * publish endpoint takes. Null when the range is not inside one period.
   */
  public record PeriodView(UUID id, String label, String status) {}

  public record SchedulePayload(
      UnitView unit, LocalDate from, LocalDate to, List<LocalDate> days, String asOf,
      List<BlockCoverage> coverage, List<OfficerRow> officers, int warnings,
      int overridesThisPeriod, PublishedState publishedState, PeriodView period) {}

  public String unitCode(UUID unitId) {
    return jdbc.queryForObject("SELECT code FROM unit WHERE id = ?", String.class, unitId);
  }

  public SchedulePayload forUnit(UUID unitId, LocalDate from, LocalDate to) {
    Map<String, Object> unitRow =
        jdbc.queryForMap("SELECT id, code, name, active FROM unit WHERE id = ?", unitId);
    List<LocalDate> closedDates = activeUnits.closedDates(unitId, from, to);
    List<ca.shiftcircle.api.units.ActiveUnits.Closure> closures =
        activeUnits.closuresIn(unitId, from, to);
    LocalDate closedFrom =
        closures.isEmpty() ? null : closures.get(0).closedFrom();
    LocalDate closedTo =
        closures.isEmpty() || closures.get(0).reopensOn() == null
            ? null
            : closures.get(0).reopensOn().minusDays(1);
    String closedLabel =
        Boolean.TRUE.equals(unitRow.get("active"))
            ? activeUnits.closedLabel(unitId, from, to)
            : "Switched off";
    String closedReason = closures.isEmpty() ? null : closures.get(0).reason();
    if (!Boolean.TRUE.equals(unitRow.get("active"))) {
      closedDates = activeUnits.days(from, to);
    }
    UnitView unit =
        new UnitView(
            (UUID) unitRow.get("id"),
            (String) unitRow.get("name"),
            closedFrom,
            closedTo,
            closedLabel,
            closedReason,
            closedDates);

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
                + " s.start_at, s.end_at, s.work_date, s.kind, s.version,"
                + " EXISTS (SELECT 1 FROM time_entry te WHERE te.shift_assignment_id = s.id"
                + "   AND te.absence_type IS NULL) AS worked"
                + " FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                + " JOIN shift_template t ON t.id = s.shift_template_id"
                + " WHERE s.unit_id = ? AND s.status <> 'CANCELLED'"
                + " AND s.work_date BETWEEN ? AND ? ORDER BY s.start_at",
            unitId,
            from,
            to);

    // Coverage is absolute time (ADR-013/017): the NIGHT block on date D runs 23:00 D to 07:00
    // D+1, so a 23:00 shift must be counted in the hours after midnight. The display query above
    // keeps one row per shift; these intervals include the next day's early shift for that block.
    List<CoverageCalculator.Interval> scheduledIntervals =
        jdbc.query(
            "SELECT start_at, end_at FROM shift_assignment WHERE unit_id = ?"
                + " AND status <> 'CANCELLED' AND work_date BETWEEN ? AND ?",
            (rs, rowNum) ->
                new CoverageCalculator.Interval(
                    rs.getTimestamp("start_at").toInstant(),
                    rs.getTimestamp("end_at").toInstant()),
            unitId,
            from.minusDays(1),
            to.plusDays(1));
    List<CoverageCalculator.Interval> actualIntervals =
        jdbc.query(
            "SELECT te.start_at, te.end_at FROM time_entry te"
                + " JOIN shift_assignment s ON s.id = te.shift_assignment_id"
                + " WHERE s.unit_id = ? AND s.work_date BETWEEN ? AND ?"
                + " AND te.absence_type IS NULL",
            (rs, rowNum) ->
                new CoverageCalculator.Interval(
                    rs.getTimestamp("start_at").toInstant(),
                    rs.getTimestamp("end_at").toInstant()),
            unitId,
            from.minusDays(1),
            to.plusDays(1));

    List<LocalDate> days = new ArrayList<>();
    for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
      days.add(date);
    }

    CoverageCalculator calculator = new CoverageCalculator();
    List<BlockCoverage> coverage = new ArrayList<>();
    for (LocalDate date : days) {
      if (!activeUnits.active(unitId, date)) {
        continue;
      }
      Map<String, CoverageCalculator.BlockCoverage> actualByBlock = new java.util.HashMap<>();
      if (date.isBefore(LocalDate.now(REGINA))) {
        for (CoverageCalculator.BlockCoverage block :
            calculator.forDay(date, required, actualIntervals)) {
          actualByBlock.put(block.block(), block);
        }
      }
      for (CoverageCalculator.BlockCoverage block :
          calculator.forDay(date, required, scheduledIntervals)) {
        CoverageCalculator.BlockCoverage actual = actualByBlock.get(block.block());
        coverage.add(
            new BlockCoverage(
                block.block(),
                date,
                block.required(),
                convert(block.coverage()),
                actual == null ? null : convert(actual.coverage()),
                block.covered()));
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
                        Boolean.TRUE.equals(shift.get("worked")),
                        ((Number) shift.get("version")).intValue(),
                        false));
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

    // The period the board shows: the one whose dates contain the board's range. Its id is what
    // POST /schedule-periods/{id}/publish takes, and its status is the board's published state.
    PeriodRow periodRow = coveringPeriod(unitId, from, to);
    PeriodView period =
        periodRow == null
            ? null
            : new PeriodView(
                periodRow.id(), label(periodRow.start(), periodRow.end()), periodRow.status());
    boolean published = period != null && "PUBLISHED".equals(period.status());
    // Changes made after the publication are the shifts the board shows as not published yet. The
    // audit trail is the source: it is append-only and every assignment change writes an event.
    Integer unpublishedChanges =
        published
            ? unpublishedChanges(
                unitId, periodRow.start(), periodRow.end(), periodRow.publishedAt())
            : null;

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
        new PublishedState(published, unpublishedChanges),
        period);
  }

  /** The period whose dates contain the board's range, or null when the range is not inside one. */
  private PeriodRow coveringPeriod(UUID unitId, LocalDate from, LocalDate to) {
    List<PeriodRow> found = new ArrayList<>();
    jdbc.query(
        "SELECT id, start_date, end_date, status, published_at FROM schedule_period"
            + " WHERE unit_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                found.add(
                    new PeriodRow(
                        (UUID) resultSet.getObject("id"),
                        localDate(resultSet.getObject("start_date")),
                        localDate(resultSet.getObject("end_date")),
                        resultSet.getString("status"),
                        resultSet.getTimestamp("published_at"))),
        unitId,
        from,
        to);
    return found.isEmpty() ? null : found.get(0);
  }

  private record PeriodRow(
      UUID id, LocalDate start, LocalDate end, String status, java.sql.Timestamp publishedAt) {}

  /** "9 – 22 Nov 2026": the week the board shows, the same label the web fixtures use. */
  private static String label(LocalDate start, LocalDate end) {
    return start.getDayOfMonth()
        + " – "
        + end.getDayOfMonth()
        + " "
        + end.format(java.time.format.DateTimeFormatter.ofPattern("MMM yyyy"));
  }

  /**
   * The shifts of that period that were assigned, moved or cancelled after it was published. The
   * audit trail is the source, because it is append-only and every assignment change writes an
   * event with the assignment id.
   */
  private Integer unpublishedChanges(
      UUID unitId, LocalDate start, LocalDate end, java.sql.Timestamp publishedAt) {
    if (publishedAt == null) {
      return 0;
    }
    return jdbc.queryForObject(
        "SELECT count(DISTINCT s.id) FROM shift_assignment s JOIN audit_event a"
            + " ON a.entity_type = 'shift_assignment' AND a.entity_id = s.id"
            + " WHERE s.unit_id = ? AND s.work_date BETWEEN ? AND ? AND a.occurred_at > ?"
            + "   AND a.action IN ('assign_shift', 'move_assignment', 'cancel_assignment')",
        Integer.class,
        unitId,
        start,
        end,
        publishedAt);
  }

  /**
   * The officer's hours in the pay period the board is showing.
   *
   * Recorded actuals are the truth where they exist. A shift the period has not
   * reached yet has no entry - a committed roster for a future quarter is all
   * planned hours - so those shifts count from the roster instead, and a
   * half-recorded period mixes the two: actual for the shifts with an entry,
   * planned for the rest from the demo day on. Past shifts without an entry
   * count nothing, exactly as before (they are the missing actuals the time
   * screen flags). Payroll and time and attendance still read entries only.
   */
  /** The day planned hours start counting from: the board's own "today". */
  private LocalDate planningFrom() {
    try {
      return LocalDate.parse(asOf);
    } catch (RuntimeException unset) {
      return LocalDate.now(REGINA);
    }
  }

  /**
   * The officer's hours in the pay period the board is showing.
   *
   * Recorded actuals are the truth where they exist. A shift the period has not
   * reached yet has no entry - a committed roster for a future quarter is all
   * planned hours - so days without an entry count from the roster instead,
   * from the board's today on. A half-recorded period therefore reads actual
   * for the days that have entries and planned for the rest, and a past day
   * without an entry counts nothing, exactly as before (those are the missing
   * actuals the time screen flags). Entries are matched to a shift by officer
   * and day, because a recorded entry need not name the assignment it belongs
   * to. Payroll and time and attendance still read entries only.
   */
  private Map<UUID, Double> periodHours(LocalDate from) {
    Map<UUID, Double> hours = new LinkedHashMap<>();
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT id, start_date, end_date FROM pay_period WHERE ? BETWEEN start_date AND end_date",
            from);
    if (periods.isEmpty()) {
      return hours;
    }
    Map<String, Object> period = periods.get(0);
    Object periodId = period.get("id");
    LocalDate fromDate = ((java.sql.Date) period.get("start_date")).toLocalDate();
    LocalDate toDate = ((java.sql.Date) period.get("end_date")).toLocalDate();

    jdbc.query(
        "WITH recorded AS ("
            + "  SELECT employee_id, work_date, sum(hours) AS actual FROM time_entry"
            + "  WHERE pay_period_id = ? AND absence_type IS NULL GROUP BY employee_id, work_date)"
            + " SELECT a.employee_id, coalesce(sum(coalesce(r.actual,"
            + "   CASE WHEN a.work_date >= ?"
            + "     THEN extract(epoch from (a.end_at - a.start_at)) / 3600.0 ELSE 0 END)), 0) AS h"
            + " FROM shift_assignment a"
            + " LEFT JOIN recorded r ON r.employee_id = a.employee_id AND r.work_date = a.work_date"
            + " WHERE a.status <> 'CANCELLED' AND a.work_date BETWEEN ? AND ?"
            + " GROUP BY a.employee_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                hours.put(
                    (UUID) resultSet.getObject("employee_id"),
                    Math.round(resultSet.getDouble("h") * 100.0) / 100.0),
        periodId,
        planningFrom(),
        fromDate,
        toDate);
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

  private static HourlyCoverage convert(CoverageCalculator.HourlyCoverage coverage) {
    return new HourlyCoverage(
        coverage.lowestHourly(),
        coverage.shortHours().stream()
            .map(hour -> new ShortHour(hour.from(), hour.to(), hour.count()))
            .toList(),
        coverage.maxHourly());
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
