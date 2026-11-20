package ca.shiftcircle.api.payroll;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** The response shapes for time and payroll (docs/07 §4.5, web/src/api/types.ts). */
public final class PayrollViews {

  private PayrollViews() {}

  public record Totals(int officers, double workedHours, double overtimeHours) {}

  public record ExportInfo(String at, String fileHash) {}

  /**
   * A pay period. {@code label} is the screen's "9 – 22 Nov 2026", {@code lockedAt} the friendly
   * "9 Nov 08:12" the design shows, and {@code overtimeThresholdHours} comes from P-01 (ADR-016).
   */
  public record PayPeriodView(
      UUID id,
      String label,
      LocalDate from,
      LocalDate to,
      String status,
      String lockedBy,
      String lockedAt,
      ExportInfo lastExport,
      Totals totals,
      double overtimeThresholdHours) {}

  public record PayCodeView(String code, double hours, double multiplier) {}

  /** One scheduled shift with what was actually recorded for it. */
  public record TimeEntryView(
      UUID assignmentId,
      UUID employeeId,
      String employeeName,
      String unitId,
      String unitName,
      LocalDate date,
      String shiftTemplate,
      String startAt,
      String endAt,
      String actualStart,
      String actualEnd,
      boolean worked,
      String absence,
      Integer unpaidExtensionMinutes,
      List<PayCodeView> payCodes,
      boolean needsActual) {}

  public record RecordActualResult(
      TimeEntryView entry, List<PayCodeView> payCodes, double periodHours) {}

  /** The shifts the api names when it refuses to lock a period (ADR-017). */
  public record MissingActual(UUID assignmentId, UUID employeeId, String start) {}

  public record PayrollFile(String fileName, String content, String sha256, int rowCount) {}
}
