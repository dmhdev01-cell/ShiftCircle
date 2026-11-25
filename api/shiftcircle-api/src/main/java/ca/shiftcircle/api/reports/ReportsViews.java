package ca.shiftcircle.api.reports;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** The report shapes the web builds against (web/src/api/types.ts, docs/07 §4.6). */
public final class ReportsViews {

  private ReportsViews() {}

  /**
   * One bucket of the coverage chart. The hours are carried alongside the percentages so the CSV
   * and the reconciliation test can see what the percentage was made of; the web screen reads the
   * percentages and ignores the rest.
   */
  public record CoverageWeek(
      String label,
      double scheduledPercent,
      double extraPercent,
      Double actualPercent,
      boolean planned,
      double requiredHours,
      double scheduledHours,
      Double actualHours,
      double extraHours,
      Map<String, Double> extraHoursByBlock) {}

  public record ClosureNote(
      UUID unitId, String unitName, LocalDate closedFrom, LocalDate closedTo, String reason) {}

  public record CoverageReport(
      List<CoverageWeek> weeks,
      int axisFrom,
      int axisTo,
      double requiredHours,
      double scheduledHours,
      Double actualHours,
      double extraHours,
      List<ClosureNote> closureNotes) {}

  /** {@code position} is the person's rank code, CO or CS (release v1.3 S7). */
  public record HoursByOfficer(
      UUID employeeId,
      String name,
      double scheduled,
      double worked,
      double regular,
      double overtime15,
      double overtime20,
      double sick,
      double vacation,
      String position) {}

  public record HoursPeriod(
      UUID id, String label, String status, String lockedBy, String lockedAt) {}

  public record HoursReport(HoursPeriod period, List<HoursByOfficer> rows, int totalOfficers) {}

  /** {@code position} is the person's rank code, CO or CS (release v1.3 S7). */
  public record OvertimeByOfficer(UUID employeeId, String name, double hours, String position) {}

  public record OvertimeReport(List<OvertimeByOfficer> rows, double averageHours) {}

  /**
   * One emergency override. {@code actor} is who recorded it; the web screen does not show it yet,
   * but the report has to carry it (docs/09 §6).
   */
  public record OverrideRow(
      UUID id,
      String at,
      String employeeName,
      String unitName,
      String reason,
      String ruleCode,
      String actor) {}
}
