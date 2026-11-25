package ca.shiftcircle.api.display;

import ca.shiftcircle.api.coverage.CoverageCalculator;
import ca.shiftcircle.api.coverage.CoverageCalculator.BlockCoverage;
import ca.shiftcircle.api.coverage.CoverageCalculator.Interval;
import ca.shiftcircle.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
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
 * The wall display (docs/07 §4.8): today's coverage by unit and block, open shifts and officers in
 * overtime. Counts only — a shared screen never shows a name, an employee number or an employee id
 * (ADR-017, docs/10 E5).
 */
@Service
public class DisplayService {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  public record UnitRef(UUID id, String name) {}

  public record DisplayBlock(
      String block, int required, CoverageCalculator.HourlyCoverage scheduled,
      CoverageCalculator.HourlyCoverage actual, boolean covered) {}

  public record UnitDisplay(
      UnitRef unit, List<DisplayBlock> coverage, int openShifts, int officersInOvertime,
      boolean closedToday, String closedNote) {}

  /**
   * A supervisor post on the wall (release v1.3 S7): counts only, like a unit. {@code area} is the
   * post's name without "Supervision · ", so the screen can say "Supervisor on duty · Operations".
   */
  public record PostDisplay(
      UnitRef post, String area, List<DisplayBlock> coverage, int openShifts) {}

  /**
   * {@code units} and the two totals are the officer units, as before; the supervisor posts are in
   * {@code posts} (release v1.3 S7), so the unit tiles and their totals are unchanged.
   */
  public record DisplayPayload(
      String asOf, String generatedAt, List<UnitDisplay> units, int totalOpenShifts,
      int totalOfficersInOvertime, List<PostDisplay> posts) {}

  private final JdbcTemplate jdbc;
  private final ca.shiftcircle.api.units.ActiveUnits activeUnits;
  private final CoverageCalculator coverage = new CoverageCalculator();
  private final LocalDate asOf;

  public DisplayService(
      JdbcTemplate jdbc,
      ca.shiftcircle.api.units.ActiveUnits activeUnits,
      @Value("${sc.demo.today:2026-11-19}") String today) {
    this.jdbc = jdbc;
    this.activeUnits = activeUnits;
    this.asOf = LocalDate.parse(today);
  }

  public DisplayPayload today(AuthPrincipal principal) {
    // The supervisor posts (release v1.3) are not unit tiles: eight tiles no longer fit a TV, so
    // the posts get their own counts-only strip (S7), read below.
    List<Map<String, Object>> units =
        jdbc.queryForList(
            "SELECT id, code, name, kind FROM unit WHERE active AND kind <> 'SUPERVISION'"
                + " ORDER BY code");
    Map<UUID, List<Interval>> scheduled = intervals(false);
    Map<UUID, List<Interval>> actual = intervals(true);
    Map<UUID, Integer> openShifts = openShifts();
    Map<UUID, Integer> overtime = officersInOvertime();

    List<UnitDisplay> displays = new ArrayList<>();
    int totalOpen = 0;
    int totalOvertime = 0;
    for (Map<String, Object> unit : units) {
      String code = (String) unit.get("code");
      if (!inScope(principal, code)) {
        continue;
      }
      UUID unitId = (UUID) unit.get("id");
      boolean closed = !activeUnits.active(unitId, asOf);
      Map<String, Integer> required = closed ? Map.of() : required(unitId);
      List<BlockCoverage> blocks =
          closed
              ? List.of()
              : coverage.forDay(asOf, required, scheduled.getOrDefault(unitId, List.of()));

      // Actuals only when the day has recorded entries; a table of false zeros would mislead.
      List<BlockCoverage> actualBlocks = null;
      if (!closed && !actual.getOrDefault(unitId, List.of()).isEmpty()) {
        actualBlocks =
            coverage.forDay(asOf, required, actual.getOrDefault(unitId, List.of()));
      }

      List<DisplayBlock> merged = new ArrayList<>();
      for (int i = 0; i < blocks.size(); i++) {
        BlockCoverage scheduledBlock = blocks.get(i);
        BlockCoverage actualBlock = actualBlocks == null ? null : actualBlocks.get(i);
        merged.add(
            new DisplayBlock(
                scheduledBlock.block(),
                scheduledBlock.required(),
                scheduledBlock.coverage(),
                actualBlock == null ? null : actualBlock.coverage(),
                scheduledBlock.covered()));
      }

      int open = closed ? 0 : openShifts.getOrDefault(unitId, 0);
      int inOvertime = closed ? 0 : overtime.getOrDefault(unitId, 0);
      totalOpen += open;
      totalOvertime += inOvertime;
      String todayNote = closed ? activeUnits.todayNote(unitId) : null;
      String closedNote =
          !closed
              ? null
              : todayNote == null
                  ? "No reopening date is set."
                  : todayNote.startsWith("reopens")
                      ? "It " + todayNote + "."
                      : "No reopening date is set.";
      displays.add(
          new UnitDisplay(
              new UnitRef(unitId, (String) unit.get("name")),
              merged,
              open,
              inOvertime,
              closed,
              closedNote));
    }

    List<PostDisplay> posts = new ArrayList<>();
    for (Map<String, Object> post :
        jdbc.queryForList(
            "SELECT id, code, name FROM unit WHERE active AND kind = 'SUPERVISION' ORDER BY code")) {
      String code = (String) post.get("code");
      if (!inScope(principal, code)) {
        continue;
      }
      UUID postId = (UUID) post.get("id");
      String name = (String) post.get("name");
      String area = name.startsWith("Supervision · ") ? name.substring("Supervision · ".length()) : name;
      boolean closed = !activeUnits.active(postId, asOf);
      posts.add(
          new PostDisplay(
              new UnitRef(postId, name),
              area,
              closed ? List.of() : mergedBlocks(postId, scheduled, actual),
              closed ? 0 : openShifts.getOrDefault(postId, 0)));
    }

    return new DisplayPayload(
        asOf.toString(), Instant.now().toString(), displays, totalOpen, totalOvertime, posts);
  }

  /** Today's blocks for one post: required, scheduled and (when recorded) actual, hourly. */
  private List<DisplayBlock> mergedBlocks(
      UUID unitId, Map<UUID, List<Interval>> scheduled, Map<UUID, List<Interval>> actual) {
    Map<String, Integer> required = required(unitId);
    List<BlockCoverage> blocks =
        coverage.forDay(asOf, required, scheduled.getOrDefault(unitId, List.of()));
    List<Interval> recorded = actual.getOrDefault(unitId, List.of());
    List<BlockCoverage> actualBlocks =
        recorded.isEmpty() ? null : coverage.forDay(asOf, required, recorded);
    List<DisplayBlock> merged = new ArrayList<>();
    for (int i = 0; i < blocks.size(); i++) {
      BlockCoverage block = blocks.get(i);
      merged.add(
          new DisplayBlock(
              block.block(),
              block.required(),
              block.coverage(),
              actualBlocks == null ? null : actualBlocks.get(i).coverage(),
              block.covered()));
    }
    return merged;
  }

  /** Assignments (or recorded actuals) per unit that overlap today's blocks, night tail included. */
  private Map<UUID, List<Interval>> intervals(boolean actuals) {
    Instant windowStart = asOf.atStartOfDay(REGINA).toInstant();
    Instant windowEnd = asOf.plusDays(1).atTime(LocalTime.of(7, 0)).atZone(REGINA).toInstant();

    Map<UUID, List<Interval>> byUnit = new LinkedHashMap<>();
    String sql =
        actuals
            ? "SELECT s.unit_id, te.start_at, te.end_at FROM time_entry te"
                + " JOIN shift_assignment s ON s.id = te.shift_assignment_id"
                + " WHERE te.entry_type = 'ACTUAL' AND te.absence_type IS NULL"
                + " AND s.status <> 'CANCELLED' AND te.start_at < ? AND te.end_at > ?"
            : "SELECT s.unit_id, s.start_at, s.end_at FROM shift_assignment s"
                + " WHERE s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?";
    jdbc.query(
        sql,
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                byUnit
                    .computeIfAbsent(
                        (UUID) resultSet.getObject("unit_id"), key -> new ArrayList<>())
                    .add(
                        new Interval(
                            resultSet.getTimestamp("start_at").toInstant(),
                            resultSet.getTimestamp("end_at").toInstant())),
        java.sql.Timestamp.from(windowEnd),
        java.sql.Timestamp.from(windowStart));
    return byUnit;
  }

  private Map<String, Integer> required(UUID unitId) {
    Map<String, Integer> required = new LinkedHashMap<>();
    jdbc.query(
        "SELECT block, min_staff FROM unit_requirement WHERE unit_id = ?"
            + " AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> required.put(resultSet.getString("block"), resultSet.getInt("min_staff")),
        unitId,
        asOf,
        asOf);
    return required;
  }

  private Map<UUID, Integer> openShifts() {
    Map<UUID, Integer> counts = new LinkedHashMap<>();
    jdbc.query(
        "SELECT unit_id, count(*) AS n FROM open_shift"
            + " WHERE status IN ('OPEN', 'OFFERED')"
            + " AND (start_at AT TIME ZONE 'America/Regina')::date = ?"
            + " GROUP BY unit_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> counts.put((UUID) resultSet.getObject("unit_id"), resultSet.getInt("n")),
        asOf);
    return counts;
  }

  private Map<UUID, Integer> officersInOvertime() {
    double threshold = thresholdHours();
    List<Map<String, Object>> periods =
        jdbc.queryForList(
            "SELECT start_date, end_date FROM pay_period WHERE ? BETWEEN start_date AND end_date",
            asOf);
    if (periods.isEmpty()) {
      return Map.of();
    }
    Instant periodStart =
        ((java.sql.Date) periods.get(0).get("start_date"))
            .toLocalDate()
            .atStartOfDay(REGINA)
            .toInstant();
    Instant periodEnd =
        ((java.sql.Date) periods.get(0).get("end_date"))
            .toLocalDate()
            .plusDays(1)
            .atStartOfDay(REGINA)
            .toInstant();

    Map<UUID, Integer> counts = new LinkedHashMap<>();
    jdbc.query(
        "SELECT e.home_unit_id AS unit_id, count(*) AS n FROM employee e"
            + " JOIN (SELECT employee_id, sum(hours) AS h FROM time_entry"
            + "   WHERE absence_type IS NULL AND entry_type = 'ACTUAL'"
            + "   AND start_at >= ? AND start_at < ?"
            + "   GROUP BY employee_id) te ON te.employee_id = e.id"
            + " WHERE e.active AND e.home_unit_id IS NOT NULL AND te.h >= ?"
            + " GROUP BY e.home_unit_id",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet -> counts.put((UUID) resultSet.getObject("unit_id"), resultSet.getInt("n")),
        java.sql.Timestamp.from(periodStart),
        java.sql.Timestamp.from(periodEnd),
        threshold);
    return counts;
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

  private static boolean inScope(AuthPrincipal principal, String unitCode) {
    if (principal.hasRole("AUDITOR") || principal.hasRole("DISPLAY")) {
      return true;
    }
    return unitCode != null && principal.scopesUnit(unitCode);
  }
}
