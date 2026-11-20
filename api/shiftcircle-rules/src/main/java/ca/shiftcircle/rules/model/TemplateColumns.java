package ca.shiftcircle.rules.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Turns an admin-editable {@link RuleRow} into the columns its Drools template expects.
 *
 * <p>Everything technical lives here rather than in the database: the admin edits limits, arrays and
 * choices, and this class derives the strings the template needs (thresholds, CSV lists, the
 * property-first condition fragments Drools requires).
 */
public final class TemplateColumns {

  private TemplateColumns() {}

  public static Map<String, Object> of(RuleRow row) {
    Map<String, Object> columns = new LinkedHashMap<>();
    columns.put("code", row.code());
    columns.put("severity", row.severity().name());
    columns.put("overridePolicy", row.overridePolicy().name());
    columns.put("message", row.message());

    switch (row.table()) {
      case REST -> {
        columns.put("afterShiftKind", row.text("afterShiftKind"));
        columns.put("windowHours", row.number("windowHours"));
        columns.put("minExtensionMinutes", optionalNumber(row, "minExtensionMinutes", 0));
        columns.put("minRestHours", row.number("minRestHours"));
      }
      case MAX_HOURS -> {
        columns.put("windowHours", row.number("windowHours"));
        columns.put("maxHours", row.number("maxHours"));
        // One row can warn below the ceiling (U-14: warn 48, block 60): match at the lower level and
        // pick the outcome in the consequence.
        double warnAt = optionalNumber(row, "warnAtHours", 0);
        columns.put("firstThreshold",
            warnAt > 0 && warnAt < row.number("maxHours") ? warnAt : row.number("maxHours"));
      }
      case CONSECUTIVE -> {
        columns.put("counts", row.text("counts"));
        columns.put("max", row.number("max"));
        columns.put("overtimeSeverity", optionalText(row, "overtimeSeverity", "WARN"));
      }
      case LONG_SHIFTS -> {
        columns.put("maxIn7Days", row.number("maxIn7Days"));
        columns.put("maxIn28Days", row.number("maxIn28Days"));
      }
      case DAYS_OFF -> {
        columns.put("withinDays", row.number("withinDays"));
        columns.put("daysOff", row.number("daysOff"));
      }
      case PAY -> {
        columns.put("condition", "overtimeHours > 0");
        columns.put("thresholdHours", row.number("thresholdHours"));
      }
      case OT_RANKING -> columns.put("condition", "rankedCount >= 0");
      case SHIFT_LENGTHS -> columns.put("condition", shiftLengthCondition(row));
    }
    return columns;
  }

  /**
   * Whether a row produces a Drools rule.
   *
   * <p>Configuration rows (the overtime rate and the 30-minute minimum) are read by the Java pay
   * classifier; they have no condition of their own, so the compiler keeps them in the rule set but
   * generates no rule for them. Everything else fires.
   */
  public static boolean fireable(RuleRow row) {
    if (!row.enabled()) {
      return false;
    }
    return row.table() != RuleTableCode.PAY || row.params().containsKey("thresholdHours");
  }

  private static String shiftLengthCondition(RuleRow row) {
    if (row.params().containsKey("allowedLengths")) {
      // The grid edits hours; the fact carries minutes.
      String allowed =
          ((List<?>) row.params().get("allowedLengths"))
              .stream()
                  .map(item -> String.valueOf(((Number) item).intValue() * 60))
                  .collect(Collectors.joining(", "));
      return "durationMinutes not in (" + allowed + ")";
    }
    // Rule S-03: 12- and 16-hour patterns need a local agreement on the unit.
    return "!allowedPatternByUnit";
  }


  private static double optionalNumber(RuleRow row, String key, double fallback) {
    Object value = row.params().get(key);
    return value == null ? fallback : ((Number) value).doubleValue();
  }

  private static String optionalText(RuleRow row, String key, String fallback) {
    Object value = row.params().get(key);
    return value == null ? fallback : value.toString();
  }
}
