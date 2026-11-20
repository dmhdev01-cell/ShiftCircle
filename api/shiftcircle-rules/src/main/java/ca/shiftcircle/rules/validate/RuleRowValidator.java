package ca.shiftcircle.rules.validate;

import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The publish-time validation docs/04 §5a requires: reject row values the fact builders never
 * produce, before a version can be built, submitted or published.
 *
 * <p>A rule that can never fire is worse than a broken one, because the admin believes it is
 * protecting people. Every message says what to change, in words a rules admin can act on.
 */
public final class RuleRowValidator {

  private static final Set<String> CONSECUTIVE_COUNTS =
      Set.of("DAYS", "SHIFTS_12H", "SHIFTS_NIGHT_12H");
  private static final Set<String> SORT_KEYS = Set.of("OT_HOURS_QUARTER_ASC", "SENIORITY_ASC");
  private static final Set<Integer> SHIFT_LENGTHS = Set.of(8, 12, 16);
  /**
   * A rule row is turned into DRL source, so a value is a code fragment, not data (review-r2 S1).
   * Codes and the shift-kind regex are restricted to characters that cannot close a string literal
   * or a constraint; messages may use ordinary prose but never a quote, backslash, newline or brace.
   */
  private static final Pattern CODE = Pattern.compile("[A-Za-z0-9-]{1,16}");

  private static final Pattern SHIFT_KIND =
      Pattern.compile("\\.\\*|\\(?[A-Za-z0-9]{1,8}(\\|[A-Za-z0-9]{1,8})*\\)?");
  private static final Pattern UNSAFE_MESSAGE = Pattern.compile("[\"\\\\\r\n{}]");
  /** Every rule the mock agreement requires (docs/05 §3 says these are the Must set). */
  private static final Set<String> REQUIRED = RuleRowsV1.ruleSet().ruleCodes();

  /**
   * The override policy each Must rule was published with (docs/05 legend, ADR-023). Weakening a
   * Block to "no override" removes the emergency path; strengthening an acknowledge to EMERGENCY
   * adds one. Neither is an edit the pipeline may accept.
   */
  private static final Map<String, OverridePolicy> REQUIRED_POLICIES =
      RuleRowsV1.ruleSet().rows().stream()
          .collect(
              java.util.stream.Collectors.toUnmodifiableMap(
                  RuleRow::code, RuleRow::overridePolicy));

  /** One plain-language problem with one row. */
  public record Violation(String code, String column, String message) {
    @Override
    public String toString() {
      return code + " · " + column + ": " + message;
    }
  }

  public List<Violation> validate(RuleSet ruleSet) {
    List<Violation> violations = new ArrayList<>();
    // Deleting a rule is not an edit: the Must set cannot disappear from a version.
    for (String required : REQUIRED) {
      if (!ruleSet.ruleCodes().contains(required)) {
        violations.add(
            new Violation(
                required,
                "Rule",
                "This rule is required by the mock agreement (docs/05 §3); add it back before"
                    + " publishing."));
      }
    }
    for (RuleRow row : ruleSet.rows()) {
      if (row.code() == null || !CODE.matcher(row.code()).matches()) {
        violations.add(
            new Violation(
                display(row.code()),
                "Rule code",
                "A rule code uses capital letters, digits and hyphens only (for example U-01)."));
      }
      OverridePolicy documented = REQUIRED_POLICIES.get(row.code());
      if (documented != null && row.overridePolicy() != documented) {
        violations.add(
            new Violation(
                row.code(),
                "Override",
                "The documented override policy for this rule is "
                    + policyLabel(documented)
                    + "; a Must rule cannot be changed."));
      }
      if (row.message() == null || row.message().isBlank()) {
        violations.add(new Violation(row.code(), "Message", "A rule needs a message to show."));
      } else if (UNSAFE_MESSAGE.matcher(row.message()).find()) {
        violations.add(
            new Violation(
                row.code(),
                "Message",
                "The message can't contain a quote, backslash, newline or brace."));
      }
      switch (row.table()) {
        case REST -> validateRest(row, violations);
        case MAX_HOURS -> validateMaxHours(row, violations);
        case CONSECUTIVE -> validateConsecutive(row, violations);
        case LONG_SHIFTS -> validateLongShifts(row, violations);
        case DAYS_OFF -> validateDaysOff(row, violations);
        case PAY -> validatePay(row, violations);
        case OT_RANKING -> validateRanking(row, violations);
        case SHIFT_LENGTHS -> validateShiftLengths(row, violations);
      }
    }
    return violations;
  }

  private static void validateRest(RuleRow row, List<Violation> violations) {
    String afterShiftKind = row.text("afterShiftKind");
    if (afterShiftKind == null
        || afterShiftKind.length() > 64
        || !SHIFT_KIND.matcher(afterShiftKind).matches()) {
      violations.add(
          new Violation(
              row.code(),
              "After this kind of shift",
              "Use shift codes joined by | (for example D8|N8 or (D8|N8|A12)), or .* for any"
                  + " shift. No other regex syntax: a quantifier like (a+)+ could hang the"
                  + " build."));
    }
    if (row.number("windowHours") != 24) {
      violations.add(
          new Violation(
              row.code(),
              "Within (hours)",
              "Window must be 24 hours: the fact builders measure rest in a 24-hour window."));
    }
    double minimum = row.number("minRestHours");
    if (minimum < 8) {
      violations.add(
          new Violation(
              row.code(),
              "At least (hours) off",
              "Minimum rest can't be below the 8-hour legal floor."));
    }
    if (optional(row, "minExtensionMinutes", 0) < 0) {
      violations.add(
          new Violation(row.code(), "Overtime extension trigger", "Cannot be negative."));
    }
  }

  private static void validateMaxHours(RuleRow row, List<Violation> violations) {
    double window = row.number("windowHours");
    if (window != 24 && window != 168) {
      violations.add(
          new Violation(
              row.code(),
              "Window (hours)",
              "Window must be 24 or 168 hours: those are the windows the fact builders produce."));
    }
    double maximum = row.number("maxHours");
    if (maximum <= 0 || maximum > window) {
      violations.add(
          new Violation(
              row.code(),
              "Maximum (hours)",
              "Maximum must be above 0 and no more than the window (" + (int) window + " h)."));
    }
    double warnAt = optional(row, "warnAtHours", 0);
    if (warnAt < 0 || (warnAt > 0 && warnAt >= maximum)) {
      violations.add(
          new Violation(
              row.code(),
              "Warn at (hours)",
              "A warning level at or above the maximum would never fire."));
    }
  }

  private static void validateConsecutive(RuleRow row, List<Violation> violations) {
    String counts = row.text("counts");
    if (!CONSECUTIVE_COUNTS.contains(counts)) {
      violations.add(
          new Violation(
              row.code(),
              "What is counted",
              "Choose days, 12-hour shifts or overnight 12-hour shifts."
              ));
    }
    double maximum = row.number("max");
    if (maximum < 1) {
      violations.add(new Violation(row.code(), "Maximum", "Maximum must be at least 1."));
    }
    String overtime = optionalText(row, "overtimeSeverity", "WARN");
    if (!overtime.equals("BLOCK") && !overtime.equals("WARN")) {
      violations.add(
          new Violation(row.code(), "When caused by overtime", "Choose Block or Warn."));
    }
  }

  private static void validateLongShifts(RuleRow row, List<Violation> violations) {
    double in7 = row.number("maxIn7Days");
    double in28 = row.number("maxIn28Days");
    if (in7 < 1) {
      violations.add(
          new Violation(row.code(), "Max in 7 days", "Maximum must be at least 1."));
    }
    if (in28 < in7) {
      violations.add(
          new Violation(
              row.code(),
              "Max in 28 days",
              "The 28-day limit can't be lower than the 7-day limit."));
    }
  }

  private static void validateDaysOff(RuleRow row, List<Violation> violations) {
    if (row.number("withinDays") != 7) {
      violations.add(
          new Violation(
              row.code(),
              "Within how many days",
              "Days off are measured in a 7-day window; the value must be 7."));
    }
    if (row.number("daysOff") < 1) {
      violations.add(
          new Violation(row.code(), "Days off required", "Must be at least 1 day."));
    }
  }

  private static void validatePay(RuleRow row, List<Violation> violations) {
    if ("P-01".equals(row.code())) {
      String window = optionalText(row, "thresholdWindow", "PAY_PERIOD");
      if (!window.equals("PAY_PERIOD")) {
        violations.add(
            new Violation(
                row.code(),
                "Threshold window",
                "The prototype classifies overtime per pay period; a weekly threshold needs a"
                    + " per-week split first."));
      }
      if (row.number("thresholdHours") <= 0) {
        violations.add(
            new Violation(row.code(), "Threshold hours", "Must be above 0 hours."));
      }
    }
    if ("P-01b".equals(row.code())) {
      if (row.number("otRate") < 1) {
        violations.add(
            new Violation(row.code(), "Overtime rate", "The rate can't be below 1.0×."));
      }
    }
    if ("P-04".equals(row.code())) {
      double minimum = row.number("ignoreUnderMinutes");
      if (minimum < 0 || minimum >= 120) {
        violations.add(
            new Violation(
                row.code(), "Unpaid below (minutes)", "Must be between 0 and 120 minutes."));
      }
    }
  }

  private static void validateRanking(RuleRow row, List<Violation> violations) {
    Object rawOrder = row.params().get("orderBy");
    if (rawOrder instanceof List<?> order) {
      if (order.isEmpty()) {
        violations.add(
            new Violation(row.code(), "Sort order", "Choose at least one sort key."));
      }
      for (Object key : order) {
        if (!SORT_KEYS.contains(String.valueOf(key))) {
          violations.add(
              new Violation(
                  row.code(),
                  "Sort order",
                  "Unknown sort key '" + key + "'. Choose overtime hours or seniority."));
        }
      }
    }
    Object skip = row.params().get("skipIfBlocked");
    if (Boolean.FALSE.equals(skip)) {
      violations.add(
          new Violation(
              row.code(),
              "Skip if a block rule applies",
              "Skipping blocked officers is a safeguard and cannot be switched off."));
    }
  }

  private static void validateShiftLengths(RuleRow row, List<Violation> violations) {
    Object rawLengths = row.params().get("allowedLengths");
    if (rawLengths instanceof List<?> lengths) {
      if (lengths.isEmpty()) {
        violations.add(
            new Violation(row.code(), "Allowed lengths", "Choose at least one shift length."));
      }
      for (Object length : lengths) {
        if (!SHIFT_LENGTHS.contains(((Number) length).intValue())) {
          violations.add(
              new Violation(
                  row.code(),
                  "Allowed lengths",
                  "Only 8, 12 and 16-hour shifts have templates: " + length + " h cannot be"
                      + " scheduled."));
        }
      }
    }
    Object rawFlags = row.params().get("requireUnitFlagFor");
    if (rawFlags instanceof List<?> flags) {
      for (Object flag : flags) {
        if (!Set.of(12, 16).contains(((Number) flag).intValue())) {
          violations.add(
              new Violation(
                  row.code(),
                  "Needs a local agreement on the unit",
                  "Only 12- and 16-hour patterns need the unit flag."));
        }
      }
    }
  }

  private static String policyLabel(OverridePolicy policy) {
    return switch (policy) {
      case EMERGENCY -> "an emergency override with a written reason";
      case ACKNOWLEDGE -> "acknowledgement, not an override";
      case NONE -> "no override";
    };
  }

  /** A hostile value must not be echoed whole into a report; the column check already refuses it. */
  private static String display(String code) {
    if (code == null) {
      return "";
    }
    return code.length() <= 24 ? code : code.substring(0, 24) + "\u2026";
  }

  private static double optional(RuleRow row, String key, double fallback) {
    Object value = row.params().get(key);
    return value == null ? fallback : ((Number) value).doubleValue();
  }

  private static String optionalText(RuleRow row, String key, String fallback) {
    Object value = row.params().get(key);
    return value == null ? fallback : value.toString();
  }
}
