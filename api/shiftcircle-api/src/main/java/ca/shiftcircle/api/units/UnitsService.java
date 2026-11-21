package ca.shiftcircle.api.units;

import ca.shiftcircle.api.planner.PlanGenerator;
import ca.shiftcircle.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Units, closures and the staffing estimate (P4-UNIT-SPEC, ADR-027). One service owns the
 * validation, the plain messages and the numbers; readers use ActiveUnits for the date rule.
 */
@Service
public class UnitsService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final DateTimeFormatter DAY_MONTH =
      DateTimeFormatter.ofPattern("d MMM yyyy", Locale.CANADA);
  private static final LocalDate FROM = PlanGenerator.FROM;
  private static final LocalDate TO = PlanGenerator.TO;

  private final JdbcTemplate jdbc;
  private final ActiveUnits activeUnits;
  private final ObjectMapper mapper = new ObjectMapper();

  public UnitsService(JdbcTemplate jdbc, ActiveUnits activeUnits) {
    this.jdbc = jdbc;
    this.activeUnits = activeUnits;
  }

  // ---------------------------------------------------------------------------------------------
  // Units and closures
  // ---------------------------------------------------------------------------------------------

  public List<UnitsViews.UnitView> units() {
    Map<UUID, Integer> filled = filledByUnit();
    Map<UUID, Integer> allocated = allocatedByUnit();
    return jdbc.queryForList(
            "SELECT id, code, name, kind, active, allows_12h, allows_16h FROM unit ORDER BY code")
        .stream()
            .map(
                row -> {
                  UUID id = (UUID) row.get("id");
                  return new UnitsViews.UnitView(
                      id,
                      (String) row.get("code"),
                      (String) row.get("name"),
                      (String) row.get("kind"),
                      Boolean.TRUE.equals(row.get("active")),
                      activeUnits.todayStatus(id),
                      activeUnits.todayNote(id),
                      Boolean.TRUE.equals(row.get("allows_12h")),
                      Boolean.TRUE.equals(row.get("allows_16h")),
                      allocated.getOrDefault(id, filled.getOrDefault(id, 0)),
                      filled.getOrDefault(id, 0),
                      activeUnits.closures(id).stream()
                          .map(
                              closure ->
                                  new UnitsViews.ClosureView(
                                      closure.id(),
                                      closure.closedFrom(),
                                      closure.reopensOn(),
                                      closure.reason(),
                                      closure.createdBy(),
                                      closure.createdAt(),
                                      closure.state(activeUnits.today())))
                          .toList());
                })
        .toList();
  }

  public UnitsViews.Preview preview(
      UUID unitId, UnitsViews.ClosureInput input) {
    requireUnit(unitId);
    if (input == null || input.closedFrom() == null) {
      throw badRequest("Enter the first day the unit is closed.");
    }
    if (input.reopensOn() != null && !input.reopensOn().isAfter(input.closedFrom())) {
      throw badRequest("The reopening date must be after the closing date.");
    }
    int officers =
        jdbc.queryForObject(
            "SELECT count(*) FROM employee WHERE active AND home_unit_id = ?",
            Integer.class,
            unitId);
    Instant start = input.closedFrom().atStartOfDay(REGINA).toInstant();
    Instant end =
        input.reopensOn() == null
            ? null
            : input.reopensOn().atStartOfDay(REGINA).toInstant();
    int shifts;
    if (end == null) {
      shifts =
          jdbc.queryForObject(
              "SELECT count(*) FROM shift_assignment WHERE unit_id = ?"
                  + " AND status <> 'CANCELLED' AND start_at >= ? AND start_at > now()",
              Integer.class,
              unitId,
              java.sql.Timestamp.from(start));
    } else {
      shifts =
          jdbc.queryForObject(
              "SELECT count(*) FROM shift_assignment WHERE unit_id = ?"
                  + " AND status <> 'CANCELLED' AND start_at >= ? AND start_at < ?"
                  + " AND start_at > now()",
              Integer.class,
              unitId,
              java.sql.Timestamp.from(start),
              java.sql.Timestamp.from(end));
    }
    return new UnitsViews.Preview(officers, shifts);
  }

  @Transactional
  public UnitsViews.ClosureView add(
      UUID unitId, UnitsViews.ClosureInput input, AuthPrincipal principal) {
    Map<String, Object> unit = requireUnit(unitId);
    validateWindow(input, null, true);
    checkOverlap(unitId, input.closedFrom(), input.reopensOn(), null, (String) unit.get("name"));
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO unit_availability (id, unit_id, disabled_from, enabled_from, reason,"
            + " created_by) VALUES (?, ?, ?, ?, ?, (SELECT id FROM app_user WHERE username = ?))",
        id,
        unitId,
        input.closedFrom(),
        input.reopensOn(),
        input.reason().trim(),
        principal.username());
    audit(
        principal,
        "unit_closure_added",
        "unit_availability",
        id,
        Map.of(
            "unit", unit.get("name"),
            "closedFrom", input.closedFrom().toString(),
            "reopensOn", input.reopensOn() == null ? "none" : input.reopensOn().toString(),
            "reason", input.reason().trim()));
    return closure(unitId, id);
  }

  @Transactional
  public UnitsViews.ClosureView change(
      UUID unitId, UUID closureId, UnitsViews.ClosureInput input, AuthPrincipal principal) {
    Map<String, Object> unit = requireUnit(unitId);
    ActiveUnits.Closure existing = requireClosure(unitId, closureId);
    LocalDate closedFrom = input.closedFrom() == null ? existing.closedFrom() : input.closedFrom();
    LocalDate reopensOn = input.reopensOn();
    String reason = input.reason() == null ? "" : input.reason().trim();
    if (closedFrom.isBefore(activeUnits.today()) && !closedFrom.equals(existing.closedFrom())) {
      throw badRequest("The closing date can't be in the past. Shifts already worked stay as they were.");
    }
    if (reopensOn != null && !reopensOn.isAfter(closedFrom)) {
      throw badRequest("The reopening date must be after the closing date.");
    }
    if (reason.length() < 5) {
      throw badRequest("Write a reason of at least 5 characters.");
    }
    checkOverlap(unitId, closedFrom, reopensOn, closureId, (String) unit.get("name"));
    jdbc.update(
        "UPDATE unit_availability SET disabled_from = ?, enabled_from = ?, reason = ?"
            + " WHERE id = ? AND unit_id = ?",
        closedFrom,
        reopensOn,
        reason,
        closureId,
        unitId);
    audit(
        principal,
        "unit_closure_changed",
        "unit_availability",
        closureId,
        Map.of(
            "unit", unit.get("name"),
            "from",
            existing.closedFrom()
                + (existing.reopensOn() == null ? " (no reopening date)" : " to " + existing.reopensOn()),
            "to",
            closedFrom + (reopensOn == null ? " (no reopening date)" : " to " + reopensOn),
            "reason", reason));
    return closure(unitId, closureId);
  }

  @Transactional
  public void remove(
      UUID unitId, UUID closureId, UnitsViews.DeleteInput input, AuthPrincipal principal) {
    Map<String, Object> unit = requireUnit(unitId);
    ActiveUnits.Closure existing = requireClosure(unitId, closureId);
    String reason =
        input == null || input.reason() == null || input.reason().trim().length() < 5
            ? "Removed by the facility planner"
            : input.reason().trim();
    jdbc.update("DELETE FROM unit_availability WHERE id = ? AND unit_id = ?", closureId, unitId);
    audit(
        principal,
        "unit_closure_removed",
        "unit_availability",
        closureId,
        Map.of(
            "unit", unit.get("name"),
            "closedFrom", existing.closedFrom().toString(),
            "reopensOn", existing.reopensOn() == null ? "none" : existing.reopensOn().toString(),
            "reason", reason));
  }

  public List<UnitsViews.FlaggedShift> flaggedShifts() {
    return jdbc.query(
        "SELECT s.id, s.unit_id, u.code, u.name, s.work_date, t.code AS template_code,"
            + " t.start_time, t.duration_minutes, e.first_name || ' ' || e.last_name AS officer,"
            + " s.start_at, s.end_at, a.disabled_from, a.reason"
            + " FROM shift_assignment s JOIN unit u ON u.id = s.unit_id"
            + " JOIN shift_template t ON t.id = s.shift_template_id"
            + " JOIN employee e ON e.id = s.employee_id"
            + " JOIN LATERAL (SELECT a.* FROM unit_availability a WHERE a.unit_id = s.unit_id"
            + "   AND s.work_date >= a.disabled_from"
            + "   AND (a.enabled_from IS NULL OR s.work_date < a.enabled_from)"
            + "   ORDER BY a.disabled_from DESC LIMIT 1) a ON true"
            + " WHERE s.status <> 'CANCELLED' AND s.start_at > now()"
            + " ORDER BY s.work_date, u.code, e.last_name, e.first_name",
        (rs, row) ->
            new UnitsViews.FlaggedShift(
                rs.getObject("id", UUID.class),
                rs.getObject("unit_id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getDate("work_date").toLocalDate(),
                rs.getString("template_code"),
                shiftLabel(
                    rs.getString("template_code"),
                    rs.getTime("start_time").toLocalTime(),
                    rs.getInt("duration_minutes")),
                rs.getString("officer"),
                rs.getTimestamp("start_at").toInstant(),
                rs.getTimestamp("end_at").toInstant(),
                rs.getDate("disabled_from").toLocalDate(),
                rs.getString("reason")));
  }

  // ---------------------------------------------------------------------------------------------
  // Staffing
  // ---------------------------------------------------------------------------------------------

  public UnitsViews.StaffingReport staffing() {
    double leave = leaveAllowance();
    List<LocalDate> boundaries = staffingBoundaries();
    List<UnitsViews.StaffingPeriod> periods = new ArrayList<>();
    for (int index = 0; index + 1 < boundaries.size(); index++) {
      LocalDate from = boundaries.get(index);
      LocalDate to = boundaries.get(index + 1).minusDays(1);
      if (to.isBefore(from)) {
        continue;
      }
      periods.add(period(from, to, leave));
    }
    boolean truncated = periods.size() > 3;
    if (truncated) {
      periods =
          periods.stream()
              .sorted(
                  Comparator.comparingInt(
                          (UnitsViews.StaffingPeriod period) -> period.totals().shortfall())
                      .reversed()
                      .thenComparing(UnitsViews.StaffingPeriod::from))
              .limit(3)
              .sorted(Comparator.comparing(UnitsViews.StaffingPeriod::from))
              .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
    }
    return new UnitsViews.StaffingReport(
        leave,
        periods,
        truncated ? "Only the three periods with the most shortage are shown." : null,
        truncated);
  }

  @Transactional
  public UnitsViews.StaffingUnit setAllocated(
      UUID unitId, UnitsViews.AllocatedInput input, AuthPrincipal principal) {
    Map<String, Object> unit = requireUnit(unitId);
    if (input == null || input.allocated() == null || input.allocated() < 0 || input.allocated() > 999) {
      throw badRequest("Enter a whole number from 0 to 999.");
    }
    if (input.reason() == null || input.reason().trim().length() < 5) {
      throw badRequest("Write a reason of at least 5 characters.");
    }
    jdbc.update(
        "INSERT INTO unit_staffing (unit_id, allocated_headcount, updated_at, updated_by)"
            + " VALUES (?, ?, now(), (SELECT id FROM app_user WHERE username = ?))"
            + " ON CONFLICT (unit_id) DO UPDATE SET allocated_headcount = EXCLUDED.allocated_headcount,"
            + " updated_at = now(), updated_by = EXCLUDED.updated_by",
        unitId,
        input.allocated(),
        principal.username());
    audit(
        principal,
        "unit_staffing_changed",
        "unit_staffing",
        unitId,
        Map.of(
            "unit", unit.get("name"),
            "allocated", input.allocated(),
            "reason", input.reason().trim()));
    return staffingUnitFor(unitId, FROM, TO);
  }

  @Transactional
  public Map<String, Object> setLeaveAllowance(
      UnitsViews.LeaveAllowanceInput input, AuthPrincipal principal) {
    if (input == null || input.percent() == null || input.percent() < 0 || input.percent() > 50) {
      throw badRequest("Enter a whole number from 0 to 50.");
    }
    if (input.reason() == null || input.reason().trim().length() < 5) {
      throw badRequest("Write a reason of at least 5 characters.");
    }
    double previous = leaveAllowance();
    double next = input.percent() / 100.0;
    jdbc.update(
        "UPDATE staffing_setting SET leave_allowance = ?, updated_at = now(),"
            + " updated_by = (SELECT id FROM app_user WHERE username = ?) WHERE id = 1",
        next,
        principal.username());
    audit(
        principal,
        "leave_allowance_changed",
        "staffing_setting",
        null,
        Map.of(
            "from", Math.round(previous * 100),
            "to", input.percent(),
            "reason", input.reason().trim()));
    return Map.of("leaveAllowance", next);
  }

  public double leaveAllowance() {
    return jdbc.queryForObject(
        "SELECT leave_allowance FROM staffing_setting WHERE id = 1", Double.class);
  }

  private UnitsViews.StaffingPeriod period(LocalDate from, LocalDate to, double leave) {
    List<UnitsViews.StaffingUnit> rows = new ArrayList<>();
    Map<UUID, Integer> filled = filledByUnit();
    Map<UUID, Integer> allocated = allocatedByUnit();
    for (Map<String, Object> unit :
        jdbc.queryForList(
            "SELECT id, code, name, allows_12h FROM unit ORDER BY code")) {
      UUID unitId = (UUID) unit.get("id");
      rows.add(
          staffingUnit(
              unitId,
              (String) unit.get("code"),
              (String) unit.get("name"),
              Boolean.TRUE.equals(unit.get("allows_12h")),
              from,
              to,
              leave,
              allocated.getOrDefault(unitId, filled.getOrDefault(unitId, 0)),
              filled.getOrDefault(unitId, 0)));
    }
    int allocatedTotal = rows.stream().mapToInt(UnitsViews.StaffingUnit::allocated).sum();
    int filledTotal = rows.stream().mapToInt(UnitsViews.StaffingUnit::filled).sum();
    int neededTotal = rows.stream().mapToInt(UnitsViews.StaffingUnit::needed).sum();
    int shortTotal = rows.stream().mapToInt(UnitsViews.StaffingUnit::shortfall).sum();
    return new UnitsViews.StaffingPeriod(
        from,
        to,
        rows,
        new UnitsViews.StaffingTotals(allocatedTotal, filledTotal, neededTotal, shortTotal));
  }

  private UnitsViews.StaffingUnit staffingUnitFor(UUID unitId, LocalDate from, LocalDate to) {
    Map<String, Object> unit =
        jdbc.queryForMap("SELECT id, code, name, allows_12h FROM unit WHERE id = ?", unitId);
    Map<UUID, Integer> filled = filledByUnit();
    Map<UUID, Integer> allocated = allocatedByUnit();
    return staffingUnit(
        unitId,
        (String) unit.get("code"),
        (String) unit.get("name"),
        Boolean.TRUE.equals(unit.get("allows_12h")),
        from,
        to,
        leaveAllowance(),
        allocated.getOrDefault(unitId, filled.getOrDefault(unitId, 0)),
        filled.getOrDefault(unitId, 0));
  }

  private UnitsViews.StaffingUnit staffingUnit(
      UUID unitId,
      String code,
      String name,
      boolean allows12h,
      LocalDate from,
      LocalDate to,
      double leave,
      int allocated,
      int filled) {
    Map<String, Integer> requirements = new LinkedHashMap<>();
    jdbc.query(
        "SELECT block, min_staff FROM unit_requirement WHERE unit_id = ? AND effective_to IS NULL",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> requirements.put(rs.getString("block"), rs.getInt("min_staff")),
        unitId);
    boolean closed = !activeUnits.active(unitId, from);
    int day = requirements.getOrDefault("DAY", 0);
    int evening = requirements.getOrDefault("EVENING", 0);
    int night = requirements.getOrDefault("NIGHT", 0);
    int posts12Day = allows12h ? day : 0;
    int posts12Night = allows12h ? night : 0;
    int posts8 = allows12h ? Math.max(0, evening - night) : day + evening + night;
    double rawNeeded = 2.0 * (posts12Day + posts12Night) + 1.4 * posts8;
    int needed = closed ? 0 : (int) Math.ceil(rawNeeded / (1.0 - leave));
    int shortfall = Math.max(0, needed - filled);
    return new UnitsViews.StaffingUnit(
        unitId,
        code,
        name,
        closed,
        allocated,
        filled,
        needed,
        shortfall,
        new UnitsViews.StaffingBreakdown(
            posts12Day, posts12Night, posts8, round1(rawNeeded), leave, needed));
  }

  private List<LocalDate> staffingBoundaries() {
    Set<LocalDate> boundaries = new LinkedHashSet<>();
    boundaries.add(FROM);
    boundaries.add(TO.plusDays(1));
    for (Map<String, Object> row :
        jdbc.queryForList(
            "SELECT disabled_from, enabled_from FROM unit_availability")) {
      LocalDate closed = ((java.sql.Date) row.get("disabled_from")).toLocalDate();
      if (!closed.isBefore(FROM) && !closed.isAfter(TO)) {
        boundaries.add(closed);
      }
      if (row.get("enabled_from") != null) {
        LocalDate reopened = ((java.sql.Date) row.get("enabled_from")).toLocalDate();
        if (!reopened.isBefore(FROM) && !reopened.isAfter(TO.plusDays(1))) {
          boundaries.add(reopened);
        }
      }
    }
    return boundaries.stream().sorted().toList();
  }

  private Map<UUID, Integer> filledByUnit() {
    Map<UUID, Integer> filled = new HashMap<>();
    jdbc.query(
        "SELECT home_unit_id, count(*) AS n FROM employee"
            + " WHERE active AND home_unit_id IS NOT NULL GROUP BY home_unit_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> filled.put(rs.getObject("home_unit_id", UUID.class), rs.getInt("n")));
    return filled;
  }

  private Map<UUID, Integer> allocatedByUnit() {
    Map<UUID, Integer> allocated = new HashMap<>();
    jdbc.query(
        "SELECT unit_id, allocated_headcount FROM unit_staffing",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> allocated.put(rs.getObject("unit_id", UUID.class), rs.getInt("allocated_headcount")));
    return allocated;
  }

  // ---------------------------------------------------------------------------------------------
  // Validation and helpers
  // ---------------------------------------------------------------------------------------------

  private Map<String, Object> requireUnit(UUID unitId) {
    return jdbc.queryForList("SELECT id, name FROM unit WHERE id = ?", unitId).stream()
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown unit"));
  }

  private ActiveUnits.Closure requireClosure(UUID unitId, UUID closureId) {
    return activeUnits.closures(unitId).stream()
        .filter(closure -> closure.id().equals(closureId))
        .findFirst()
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown closure for this unit"));
  }

  private UnitsViews.ClosureView closure(UUID unitId, UUID closureId) {
    ActiveUnits.Closure closure = requireClosure(unitId, closureId);
    return new UnitsViews.ClosureView(
        closure.id(),
        closure.closedFrom(),
        closure.reopensOn(),
        closure.reason(),
        closure.createdBy(),
        closure.createdAt(),
        closure.state(activeUnits.today()));
  }

  private void validateWindow(
      UnitsViews.ClosureInput input, UUID ignoreClosureId, boolean futureOnly) {
    if (input == null || input.closedFrom() == null) {
      throw badRequest("Enter the first day the unit is closed.");
    }
    if (futureOnly && input.closedFrom().isBefore(activeUnits.today())) {
      throw badRequest("The closing date can't be in the past. Shifts already worked stay as they were.");
    }
    if (input.reopensOn() != null && !input.reopensOn().isAfter(input.closedFrom())) {
      throw badRequest("The reopening date must be after the closing date.");
    }
    if (input.reason() == null || input.reason().trim().length() < 5) {
      throw badRequest("Write a reason of at least 5 characters.");
    }
  }

  private void checkOverlap(
      UUID unitId, LocalDate closedFrom, LocalDate reopensOn, UUID ignoreClosureId, String unitName) {
    for (ActiveUnits.Closure existing : activeUnits.closures(unitId)) {
      if (existing.id().equals(ignoreClosureId)) {
        continue;
      }
      boolean overlap =
          (reopensOn == null || existing.closedFrom().isBefore(reopensOn))
              && (existing.reopensOn() == null || closedFrom.isBefore(existing.reopensOn()));
      if (!overlap) {
        continue;
      }
      String shortName = unitName.contains(" · ") ? unitName.substring(0, unitName.indexOf(" · ")) : unitName;
      if (existing.reopensOn() == null) {
        throw badRequest(
            shortName
                + " is already closed from "
                + existing.closedFrom().format(DAY_MONTH)
                + " with no reopening date set. Change that closure instead.");
      }
      throw badRequest(
          shortName
              + " is already closed from "
              + existing.closedFrom().format(DAY_MONTH)
              + " to "
              + existing.reopensOn().minusDays(1).format(DAY_MONTH)
              + ". Choose dates outside it.");
    }
  }

  private static ResponseStatusException badRequest(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static double round1(double value) {
    return Math.round(value * 10.0) / 10.0;
  }

  private static String shiftLabel(String code, java.time.LocalTime start, int minutes) {
    int hour = start.getHour();
    int endHour = Math.floorMod(hour + minutes / 60, 24);
    String part =
        switch (code) {
          case "D8", "D12" -> "Day";
          case "E8" -> "Evening";
          case "N8", "N12" -> "Night";
          case "A12" -> "Day";
          case "P12" -> "Evening";
          case "L16" -> "Long";
          default -> "Shift";
        };
    return String.format(
        Locale.CANADA,
        "%s %02d-%02d (%d h)",
        part,
        hour,
        endHour,
        minutes / 60);
  }

  private void audit(
      AuthPrincipal principal,
      String action,
      String entityType,
      UUID entityId,
      Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, ?, ?, ?::jsonb)",
        principal.username(),
        action,
        entityType,
        entityId,
        mapper.writeValueAsString(after));
  }
}
