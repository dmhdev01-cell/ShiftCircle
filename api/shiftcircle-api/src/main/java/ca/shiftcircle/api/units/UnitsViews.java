package ca.shiftcircle.api.units;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Read models for Units, the closure dialog and the Staffing tile (P4-UNIT-SPEC §7). */
public final class UnitsViews {

  private UnitsViews() {}

  public record ClosureView(
      UUID id,
      LocalDate closedFrom,
      LocalDate reopensOn,
      String reason,
      String createdBy,
      Instant createdAt,
      String state) {}

  public record UnitView(
      UUID id,
      String code,
      String name,
      String kind,
      boolean active,
      String today,
      String todayNote,
      boolean allows12h,
      boolean allows16h,
      int allocated,
      int filled,
      List<ClosureView> closures) {}

  public record Preview(int officersHomed, int publishedShiftsAffected) {}

  public record ClosureInput(LocalDate closedFrom, LocalDate reopensOn, String reason) {}

  public record FlaggedShift(
      UUID shiftId,
      UUID unitId,
      String unitCode,
      String unitName,
      LocalDate date,
      String templateCode,
      String shiftLabel,
      String officerName,
      Instant start,
      Instant end,
      LocalDate closedFrom,
      String reason) {}

  public record StaffingBreakdown(
      int posts12Day,
      int posts12Night,
      int posts8,
      double rawNeeded,
      double leaveAllowance,
      int needed) {}

  public record StaffingUnit(
      UUID unitId,
      String unitCode,
      String unitName,
      boolean closed,
      int allocated,
      int filled,
      int needed,
      int shortfall,
      StaffingBreakdown breakdown) {}

  public record StaffingTotals(int allocated, int filled, int needed, int shortfall) {}

  public record StaffingPeriod(
      LocalDate from, LocalDate to, List<StaffingUnit> units, StaffingTotals totals) {}

  public record StaffingReport(
      double leaveAllowance, List<StaffingPeriod> periods, String note, boolean truncated) {}

  public record AllocatedInput(Integer allocated, String reason) {}

  public record LeaveAllowanceInput(Integer percent, String reason) {}

  public record DeleteInput(String reason) {}
}
