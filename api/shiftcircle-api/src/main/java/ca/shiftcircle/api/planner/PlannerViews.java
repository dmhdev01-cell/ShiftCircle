package ca.shiftcircle.api.planner;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** The planner read models (docs/07 §4.9, docs/ui/planner.md §10). */
public final class PlannerViews {

  private PlannerViews() {}

  public record Window(LocalDate from, LocalDate to, int periods) {}

  public record DraftSummary(
      UUID id,
      int version,
      long seed,
      String pattern8h,
      String status,
      String createdAt,
      String createdBy,
      int generatedMs,
      Map<String, Object> scorecard,
      int handEdits,
      List<UUID> editedAssignmentIds) {}

  public record LastCommitted(UUID draftId, String at, String by, int shiftsWritten) {}

  public record PlanState(
      Window window,
      long defaultSeed,
      List<String> patterns8h,
      String state,
      DraftSummary draft,
      LastCommitted lastCommitted,
      DraftSummary committedDraft) {}

  public record GapView(
      UUID unitId, String unitCode, String unitName, LocalDate date, String block, int required,
      int placed, String reason) {}

  public record WarningItem(
      String unitCode, LocalDate date, String employeeName, String shift, String message) {}

  public record WarningGroup(String ruleName, int count, List<WarningItem> items) {}

  public record CommitPreview(
      int version,
      int shiftsToWrite,
      int officers,
      int shortBlockDays,
      int warningCount,
      LocalDate from,
      LocalDate to) {}

  public record CommitFailure(
      String unitCode, LocalDate date, String employeeName, String shift, List<String> ruleResults) {}

  public record CommitResult(
      int shiftsWritten, String committedAt, long auditEventId, List<String> units,
      LocalDate firstWeek) {}

  public record CompareRow(
      String key, String label, double board, double draft, String unit, String direction) {}

  public record CompareView(
      int draftShifts,
      int draftGaps,
      int committedShifts,
      String draftStatus,
      String basis,
      List<CompareRow> rows) {}

  public record PreferenceView(
      UUID employeeId,
      String name,
      String employeeNo,
      String unitName,
      LocalDate seniorityDate,
      Integer shiftLength,
      List<String> timesOfDay,
      List<String> daysOff,
      int maxDaysOff,
      String pattern,
      String patternWords,
      boolean patternEditable,
      String inDraft,
      List<String> unmet,
      String updatedAt) {}

  public record MyPreferences(
      Integer shiftLength,
      List<String> timesOfDay,
      List<String> daysOff,
      int maxDaysOff,
      List<Integer> allowedLengths,
      String updatedAt) {}

  public record PreferenceInput(
      Integer shiftLength, List<String> timesOfDay, String timeOfDay, List<String> daysOff) {}

  /** A planned absence and whether this call created it (false = the same absence already existed). */
  public record PlannedAbsenceResult(Map<String, Object> body, boolean created) {}

  /**
   * Planned leave on the draft roster (fit-gap B1-lite): {@code {"type":"ABSENCE",
   * "absenceType":"VACATION"}}, the same item shape as My schedule, so the grid shows a Vac, Sick
   * or Other chip instead of Off.
   */
  public record LeaveItem(String type, String absenceType) {}

  public record DraftCreation(long seed, String pattern8h) {}

  public record CommitInput(Integer acceptedWarningCount) {}

  public record DiscardResult(UUID id, String status) {}

  public record Conflict(String reason, Object detail) {}

  public record UnitCoverage(
      UUID unitId,
      String unitName,
      LocalDate closedFrom,
      LocalDate closedTo,
      String closedLabel,
      String closedReason,
      List<LocalDate> closedDates,
      List<ca.shiftcircle.api.schedule.ScheduleQuery.BlockCoverage> coverage) {}

  /** ISO timestamp helper shared by the service. */
  public static String iso(LocalDateTime value) {
    return value == null ? null : value.toString();
  }
}
