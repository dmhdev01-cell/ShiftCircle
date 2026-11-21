package ca.shiftcircle.api.units;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The one active-units source (ADR-027). A unit is open on a day when its hard {@code active}
 * switch is on and no closure window covers the day. Every reader asks this class or the SQL
 * function it wraps; no reader re-implements the date rule.
 */
@Service
public class ActiveUnits {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final DateTimeFormatter DAY_MONTH =
      DateTimeFormatter.ofPattern("d MMM yyyy", Locale.CANADA);
  private static final DateTimeFormatter DAY_MONTH_WEEKDAY =
      DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.CANADA);

  private final JdbcTemplate jdbc;
  private final LocalDate today;

  public ActiveUnits(
      JdbcTemplate jdbc, @Value("${sc.demo.today:2026-11-19}") String today) {
    this.jdbc = jdbc;
    this.today = LocalDate.parse(today);
  }

  public record Closure(
      UUID id,
      UUID unitId,
      LocalDate closedFrom,
      LocalDate reopensOn,
      String reason,
      String createdBy,
      Instant createdAt) {

    /** Relative to the demo's today: a future, current or ended closure. */
    public String state(LocalDate day) {
      if (closedFrom.isAfter(day)) {
        return "FUTURE";
      }
      if (reopensOn != null && !reopensOn.isAfter(day)) {
        return "ENDED";
      }
      return "CURRENT";
    }

    public boolean covers(LocalDate day) {
      return !day.isBefore(closedFrom) && (reopensOn == null || day.isBefore(reopensOn));
    }

    public boolean touches(LocalDate from, LocalDate to) {
      return !closedFrom.isAfter(to) && (reopensOn == null || !reopensOn.isBefore(from));
    }
  }

  public LocalDate today() {
    return today;
  }

  public boolean active(UUID unitId, LocalDate day) {
    Boolean answer =
        jdbc.queryForObject(
            "SELECT unit_active_on(?, ?)", Boolean.class, unitId, java.sql.Date.valueOf(day));
    return Boolean.TRUE.equals(answer);
  }

  /** Unit ids open on the day, in unit-code order. */
  public List<UUID> activeOn(LocalDate day) {
    return jdbc.queryForList(
        "SELECT id FROM unit WHERE unit_active_on(id, ?) ORDER BY code",
        UUID.class,
        java.sql.Date.valueOf(day));
  }

  public List<Closure> closures(UUID unitId) {
    return jdbc.query(
        "SELECT a.id, a.unit_id, a.disabled_from, a.enabled_from, a.reason, a.created_at,"
            + " u.display_name AS created_by_name FROM unit_availability a"
            + " LEFT JOIN app_user u ON u.id = a.created_by"
            + " WHERE a.unit_id = ? ORDER BY a.disabled_from, a.created_at",
        (rs, row) ->
            new Closure(
                rs.getObject("id", UUID.class),
                rs.getObject("unit_id", UUID.class),
                rs.getDate("disabled_from").toLocalDate(),
                rs.getDate("enabled_from") == null
                    ? null
                    : rs.getDate("enabled_from").toLocalDate(),
                rs.getString("reason"),
                rs.getString("created_by_name"),
                rs.getTimestamp("created_at").toInstant()),
        unitId);
  }

  public List<Closure> closuresIn(UUID unitId, LocalDate from, LocalDate to) {
    return closures(unitId).stream().filter(closure -> closure.touches(from, to)).toList();
  }

  /** Days in the range the unit is closed, in order. Range is small (a week or a quarter). */
  public List<LocalDate> closedDates(UUID unitId, LocalDate from, LocalDate to) {
    List<LocalDate> dates = new ArrayList<>();
    List<Closure> windows = closures(unitId);
    for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
      LocalDate check = day;
      if (windows.stream().anyMatch(closure -> closure.covers(check))) {
        dates.add(day);
      }
    }
    return dates;
  }

  /** The shortest plain label for a closure touching the range, or null when open. */
  public String closedLabel(UUID unitId, LocalDate from, LocalDate to) {
    List<Closure> windows = closuresIn(unitId, from, to);
    if (windows.isEmpty()) {
      return null;
    }
    Closure first = windows.get(0);
    if (first.reopensOn() == null) {
      return "Closed from " + first.closedFrom().format(DAY_MONTH);
    }
    return "Closed "
        + first.closedFrom().format(DAY_MONTH)
        + " - "
        + first.reopensOn().minusDays(1).format(DAY_MONTH);
  }

  /** The one sentence for a roster/board note, e.g. "Unit C is closed from ...". */
  public String note(String unitName, UUID unitId, LocalDate from, LocalDate to) {
    List<Closure> windows = closuresIn(unitId, from, to);
    if (windows.isEmpty()) {
      return null;
    }
    Closure first = windows.get(0);
    String base =
        unitName
            + " is closed from "
            + first.closedFrom().format(DAY_MONTH_WEEKDAY)
            + " (\""
            + first.reason()
            + "\"). It has no roster and needs no staff from that date.";
    if (first.reopensOn() == null) {
      return base + " Its officers work as relief in other units, shown under those units.";
    }
    return base
        + " It reopens on "
        + first.reopensOn().format(DAY_MONTH_WEEKDAY)
        + "; its officers work as relief in other units while it is closed.";
  }

  public String todayStatus(UUID unitId) {
    Boolean activeUnit =
        jdbc.queryForObject("SELECT active FROM unit WHERE id = ?", Boolean.class, unitId);
    if (!Boolean.TRUE.equals(activeUnit)) {
      return "SWITCHED_OFF";
    }
    return active(unitId, today) ? "OPEN" : "CLOSED";
  }

  public String todayNote(UUID unitId) {
    List<Closure> windows = closures(unitId).stream().filter(c -> c.covers(today)).toList();
    if (windows.isEmpty()) {
      return null;
    }
    Closure current = windows.get(0);
    return current.reopensOn() == null
        ? "no reopening date"
        : "reopens " + current.reopensOn().format(DAY_MONTH);
  }

  public Set<UUID> activeUnits(LocalDate from, LocalDate to) {
    Set<UUID> ids = new LinkedHashSet<>();
    for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
      ids.addAll(activeOn(day));
    }
    return ids;
  }

  public List<LocalDate> days(LocalDate from, LocalDate to) {
    List<LocalDate> days = new ArrayList<>();
    for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
      days.add(day);
    }
    return days;
  }

  public Instant now() {
    return Instant.now();
  }

  public Timestamp timestamp(Instant instant) {
    return Timestamp.from(instant);
  }
}
