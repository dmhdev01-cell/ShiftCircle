package ca.shiftcircle.rules.model;

import ca.shiftcircle.rules.RuleCompilationException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Turns an admin-editable {@link RuleRow} into the columns its Drools template expects.
 *
 * <p>Everything technical lives here rather than in the database: the admin edits limits, arrays and
 * choices, and this class derives the strings the template needs (thresholds, CSV lists, the
 * property-first condition fragments Drools requires).
 */
public final class TemplateColumns {

  /**
   * Defense in depth behind the validator (review-r2 S1): every value that becomes DRL source is
   * checked here too, so a row that reached the database another way still cannot inject code.
   */
  private static final Pattern CODE = Pattern.compile("[A-Za-z0-9-]{1,16}");

  /** A qualification or position code: {@code ACTING_SUP}, {@code CS}. */
  private static final Pattern QUALIFICATION = Pattern.compile("[A-Z][A-Z0-9_]{0,31}");

  private static final Pattern SHIFT_KIND =
      Pattern.compile("\\.\\*|\\(?[A-Za-z0-9]{1,8}(\\|[A-Za-z0-9]{1,8})*\\)?");

  private TemplateColumns() {}

  public static Map<String, Object> of(RuleRow row) {
    Map<String, Object> columns = new LinkedHashMap<>();
    columns.put("code", checkedCode(row.code()));
    columns.put("severity", row.severity().name());
    columns.put("overridePolicy", row.overridePolicy().name());
    columns.put("message", quoted(row.message()));

    switch (row.table()) {
      case REST -> {
        columns.put("afterShiftKind", checkedRegex(row.text("afterShiftKind")));
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
        double maxHours = row.number("maxHours");
        if (warnAt > 0 && warnAt >= maxHours) {
          // A warning level at or above the ceiling would silently disable the ceiling: refuse it,
          // the same way the publish pipeline will (review F6).
          throw new RuleCompilationException(
              row.code()
                  + ": warnAtHours ("
                  + warnAt
                  + ") must be below maxHours ("
                  + maxHours
                  + ")");
        }
        columns.put("firstThreshold", warnAt > 0 ? warnAt : maxHours);
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
      case POSTS -> {
        columns.put("condition", postCondition(row));
        Object acting = row.params().get("actingQualification");
        // The template drops a line whose column is empty, so "no acting qualification" is "-":
        // a value no qualification code can have, which nobody holds.
        columns.put(
            "actingQualification",
            acting == null || acting.toString().isBlank() ? "-" : checkedQualification(acting));
        // The acting qualification only ever softens a row: a Block becomes a Warn the supervisor
        // acknowledges, and a Warn or Info stays what it is.
        boolean softens = row.severity() == ca.shiftcircle.rules.facts.RuleOutcome.BLOCK;
        columns.put("actingSeverity", softens ? "WARN" : row.severity().name());
        columns.put(
            "actingOverridePolicy", softens ? "ACKNOWLEDGE" : row.overridePolicy().name());
      }
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

  private static String checkedCode(String code) {
    if (code == null || !CODE.matcher(code).matches()) {
      throw new RuleCompilationException(
          "A rule code uses letters, digits and hyphens only");
    }
    return code;
  }

  private static String checkedQualification(Object value) {
    String code = value.toString();
    if (!QUALIFICATION.matcher(code).matches()) {
      throw new RuleCompilationException(
          "A qualification code uses capital letters, digits and underscores only");
    }
    return code;
  }

  private static String checkedRegex(String value) {
    if (value == null || value.length() > 64 || !SHIFT_KIND.matcher(value).matches()) {
      throw new RuleCompilationException(
          "The shift-kind pattern is a list of shift codes joined by |, or .*");
    }
    return value;
  }

  /** The value sits inside a Java string literal in the consequence. */
  private static String quoted(String message) {
    if (message == null) {
      return "";
    }
    return message
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r");
  }

  private static String shiftLengthCondition(RuleRow row) {
    if (Boolean.TRUE.equals(row.params().get("nightShiftOnly"))) {
      return "nightShift && nominalMinutes == 480";
    }
    if (row.params().containsKey("allowedLengths")) {
      // The grid edits hours; the fact carries minutes.
      String allowed =
          ((List<?>) row.params().get("allowedLengths"))
              .stream()
                  .map(item -> String.valueOf(((Number) item).intValue() * 60))
                  .collect(Collectors.joining(", "));
      return "nominalMinutes not in (" + allowed + ")";
    }
    // Rule S-03: 12- and 16-hour patterns need a local agreement on the unit.
    return "!allowedPatternByUnit";
  }


  /**
   * R-01/R-02: the row fires when the post is of the row's kind and the person's position is not
   * one the row allows. Every value is a checked code, so nothing but a code reaches the DRL.
   */
  private static String postCondition(RuleRow row) {
    String postKind = row.text("postKind");
    if (!"SUPERVISION".equals(postKind) && !"LINE".equals(postKind)) {
      throw new RuleCompilationException(row.code() + ": the post kind is SUPERVISION or LINE");
    }
    Object raw = row.params().get("allowedPositions");
    if (!(raw instanceof List<?> allowed) || allowed.isEmpty()) {
      throw new RuleCompilationException(row.code() + ": name at least one allowed position");
    }
    String positions =
        allowed.stream()
            .map(item -> "\"" + checkedQualification(item) + "\"")
            .collect(Collectors.joining(", "));
    return "postKind == \"" + postKind + "\" && position not in (" + positions + ")";
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
