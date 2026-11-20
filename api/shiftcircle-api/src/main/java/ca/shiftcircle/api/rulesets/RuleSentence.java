package ca.shiftcircle.api.rulesets;

import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import java.util.Arrays;
import java.util.Map;

/**
 * The plain-language sentence a rules admin and a supervisor read (docs/07 §4.7).
 *
 * <p>D6: the sentence used to echo the stored regex ({@code .*}) and the raw severity enum
 * ({@code block}, {@code warn}). This class turns both into words, and every shipped row is pinned
 * by {@code RuleSentenceTest}. It reads the row only, never the compiled DRL, so the rule data and
 * scenarios are untouched.
 */
public final class RuleSentence {

  private RuleSentence() {}

  public static String of(RuleRow row) {
    Map<String, Object> params = row.params();
    String override = override(row.overridePolicy());
    String outcome = outcome(row.severity());
    return switch (row.table()) {
      case REST -> "After "
          + after(params.get("afterShiftKind"))
          + ", an officer needs at least "
          + number(params.get("minRestHours"))
          + " hours off within "
          + number(params.get("windowHours"))
          + " hours; otherwise the change is "
          + outcome
          + "."
          + override;
      case MAX_HOURS -> "No more than "
          + number(params.get("maxHours"))
          + " hours in "
          + number(params.get("windowHours"))
          + " hours; otherwise the change is "
          + outcome
          + "."
          + override;
      case CONSECUTIVE -> "No more than "
          + number(params.get("max"))
          + " consecutive "
          + counted(params.get("counts"))
          + "; a scheduled shift is "
          + outcome
          + ", and one caused by overtime is "
          + outcomeText(params.get("overtimeSeverity"))
          + "."
          + override;
      case LONG_SHIFTS -> "No more than "
          + number(params.get("maxIn7Days"))
          + " 16-hour shifts in 7 days, and "
          + number(params.get("maxIn28Days"))
          + " in 28 days; otherwise the change is "
          + outcome
          + "."
          + override;
      case DAYS_OFF -> "At least "
          + number(params.get("daysOff"))
          + " consecutive days off in every "
          + number(params.get("withinDays"))
          + " days; a break of 24 hours or less does not count, and otherwise the change is "
          + outcome
          + "."
          + override;
      case PAY, OT_RANKING, SHIFT_LENGTHS -> prose(row.message());
    };
  }

  /** "any shift", "a regular shift", or the codes in words; never the stored pattern. */
  private static String after(Object raw) {
    String pattern = raw == null ? ".*" : String.valueOf(raw).trim();
    if (pattern.isBlank() || ".*".equals(pattern)) {
      return "any shift";
    }
    return switch (pattern) {
      case "(D8|E8|N8|A12|P12)" -> "a regular shift";
      case "L16" -> "a 16-hour shift";
      case "A12" -> "a 12-hour day shift (00:00\u201312:00)";
      case "P12" -> "a 12-hour evening shift (12:00\u201324:00)";
      default -> "a " + codes(pattern) + " shift";
    };
  }

  /** {@code (D8|E8|N8)} or {@code D8|E8} in words: "a D8, E8 or N8 shift". */
  private static String codes(String pattern) {
    String body =
        pattern.startsWith("(") && pattern.endsWith(")")
            ? pattern.substring(1, pattern.length() - 1)
            : pattern;
    String[] parts = body.split("\\|");
    if (parts.length == 1) {
      return parts[0];
    }
    return String.join(", ", Arrays.copyOf(parts, parts.length - 1))
        + " or "
        + parts[parts.length - 1];
  }

  /** The stored counts enum in words. */
  private static String counted(Object raw) {
    String value = raw == null ? "shifts" : String.valueOf(raw);
    return switch (value) {
      case "DAYS" -> "days";
      case "SHIFTS_12H" -> "12-hour shifts";
      case "SHIFTS_NIGHT_12H" -> "overnight 12-hour shifts";
      default -> "shifts";
    };
  }

  /** A stored severity enum as a verb: blocked, warned, noted. */
  private static String outcome(Object raw) {
    return outcomeText(raw);
  }

  private static String outcomeText(Object raw) {
    String value = raw == null ? "WARN" : String.valueOf(raw);
    return switch (value) {
      case "BLOCK" -> "blocked";
      case "WARN" -> "warned";
      case "INFO" -> "noted";
      default -> "warned";
    };
  }

  private static String override(OverridePolicy policy) {
    return switch (policy) {
      case EMERGENCY -> " A supervisor may override only in an emergency, with a written reason.";
      case ACKNOWLEDGE -> " A supervisor must acknowledge it before the change is saved.";
      case NONE -> " It cannot be overridden.";
    };
  }

  /** A message row is already prose; make sure it reads as one sentence. */
  private static String prose(String message) {
    String text =
        message == null || message.isBlank()
            ? "This rule is part of the collective agreement."
            : message.trim();
    if (!text.endsWith(".")) {
      text = text + ".";
    }
    return Character.toUpperCase(text.charAt(0)) + text.substring(1);
  }

  private static String number(Object value) {
    if (value instanceof Number number) {
      return number.doubleValue() == Math.rint(number.doubleValue())
          ? String.valueOf(number.intValue())
          : String.valueOf(number.doubleValue());
    }
    return String.valueOf(value);
  }
}
