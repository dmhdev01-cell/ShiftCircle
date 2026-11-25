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
  /** A list column never needs more than this; a 4000-item list is a payload, not an edit. */
  private static final int MAX_LIST_VALUES = 16;
  /**
   * A rule row is turned into DRL source, so a value is a code fragment, not data (review-r2 S1).
   * Codes and the shift-kind regex are restricted to characters that cannot close a string literal
   * or a constraint; messages may use ordinary prose but never a quote, backslash, newline or brace.
   */
  private static final Pattern CODE = Pattern.compile("[A-Za-z0-9-]{1,16}");

  private static final Pattern SHIFT_KIND =
      Pattern.compile("\\.\\*|\\(?[A-Za-z0-9]{1,8}(\\|[A-Za-z0-9]{1,8})*\\)?");
  /** The positions a post row can name (the position table, docs/06 §3.1). */
  private static final Set<String> POSITIONS = Set.of("CO", "CS");
  private static final Set<String> POST_KINDS = Set.of("SUPERVISION", "LINE");
  private static final Pattern QUALIFICATION = Pattern.compile("[A-Z][A-Z0-9_]{0,31}");
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

  /**
   * The result each Must rule was published with. Like the override policy, it is part of what
   * the mock agreement requires: a Block cannot be turned into a warning, and a Must rule cannot
   * be switched off, through the rules screen (security review I2, release v1.3).
   */
  private static final Map<String, ca.shiftcircle.rules.facts.RuleOutcome> REQUIRED_SEVERITIES =
      RuleRowsV1.ruleSet().rows().stream()
          .collect(
              java.util.stream.Collectors.toUnmodifiableMap(RuleRow::code, RuleRow::severity));

  /**
   * The qualifications that may soften R-01: only a supervisory one. A common qualification here
   * would turn the Block into a warning for everyone who holds it (security review L1).
   */
  private static final Set<String> ACTING_QUALIFICATIONS = Set.of("ACTING_SUP");

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
      // A row stored with the wrong type must become a validation error, never a 500. The API
      // refuses such values at PUT; this is the defence for rows edited directly in PostgreSQL.
      try {
        validateRow(row, violations);
      } catch (RuntimeException unreadable) {
        violations.add(
            new Violation(
                display(row.code()),
                "Row values",
                "One of this row's values has the wrong type or is missing; correct the row and"
                    + " build again."));
      }
    }
    return violations;
  }

  private void validateRow(RuleRow row, List<Violation> violations) {
    if (row.code() == null || !CODE.matcher(row.code()).matches()) {
      violations.add(
          new Violation(
              display(row.code()),
              "Rule code",
              "A rule code uses letters, digits and hyphens only (for example U-01 or P-01b)."));
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
    ca.shiftcircle.rules.facts.RuleOutcome documentedResult = REQUIRED_SEVERITIES.get(row.code());
    if (documentedResult != null && row.severity() != documentedResult) {
      violations.add(
          new Violation(
              row.code(),
              "Result",
              "The documented result for this rule is "
                  + resultLabel(documentedResult)
                  + "; a Must rule cannot be changed."));
    }
    if (REQUIRED_SEVERITIES.containsKey(row.code()) && !row.enabled()) {
      violations.add(
          new Violation(
              row.code(),
              "On",
              "This rule is required by the mock agreement (docs/05 §3); it cannot be switched"
                  + " off."));
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
      case POSTS -> validatePosts(row, violations);
    }
  }

  private static void validateRest(RuleRow row, List<Violation> violations) {
    String afterShiftKind = row.text("afterShiftKind");
    boolean unbalancedParens =
        afterShiftKind != null
            && afterShiftKind.startsWith("(") != afterShiftKind.endsWith(")");
    if (afterShiftKind == null || unbalancedParens) {
      violations.add(
          new Violation(
              row.code(),
              "After this kind of shift",
              "Use balanced parentheses: (D8|N8) or no parentheses, or .* for any shift."));
    } else if (afterShiftKind.length() > 64 || !SHIFT_KIND.matcher(afterShiftKind).matches()) {
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
    if (minimum < 8 || minimum > 24) {
      violations.add(
          new Violation(
              row.code(),
              "At least (hours) off",
              "Minimum rest must be between 8 and 24 hours: 8 is the legal floor and the fact"
                  + " builders measure rest in a 24-hour window."));
    }
    if (optional(row, "minExtensionMinutes", 0) < 0
        || optional(row, "minExtensionMinutes", 0) > 1440) {
      violations.add(
          new Violation(
              row.code(),
              "Overtime extension trigger",
              "Must be between 0 and 1440 minutes (one day)."));
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
    if (maximum < 1 || maximum > 366) {
      violations.add(
          new Violation(
              row.code(), "Maximum", "Maximum must be between 1 and 366 (a year of days)."));
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
    if (in7 < 1 || in7 > 28) {
      violations.add(
          new Violation(
              row.code(), "Max in 7 days", "Maximum must be between 1 and 28 long shifts."));
    }
    if (in28 > 366) {
      violations.add(
          new Violation(
              row.code(), "Max in 28 days", "Maximum can't exceed 366 long shifts."));
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
    double daysOff = row.number("daysOff");
    if (daysOff < 1 || daysOff > 7) {
      violations.add(
          new Violation(row.code(), "Days off required", "Must be between 1 and 7 days."));
    }
    if (row.params().containsKey("minBreakHours")) {
      double breakHours = row.number("minBreakHours");
      if (breakHours < 0 || breakHours > 24) {
        violations.add(
            new Violation(
                row.code(),
                "Minimum length of a day off (hours)",
                "Must be between 0 and 24 hours."));
      }
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
      double threshold = row.number("thresholdHours");
      if (threshold <= 0 || threshold > 168) {
        violations.add(
            new Violation(
                row.code(), "Threshold hours", "Must be above 0 and no more than 168 hours."));
      }
    }
    if ("P-01b".equals(row.code())) {
      double rate = row.number("otRate");
      if (rate < 1 || rate > 3) {
        violations.add(
            new Violation(
                row.code(),
                "Overtime rate",
                "The rate must be between 1.0 and 3.0 times; 1.5 is the documented default."));
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
    if (rawOrder == null) {
      if (row.params().containsKey("orderBy")) {
        violations.add(
            new Violation(row.code(), "Sort order", "Choose the sort keys as a list."));
      }
      // The skip/keep row (O-03) carries no sort order; only the ordering row does.
      return;
    }
    if (!(rawOrder instanceof List<?> order)) {
      violations.add(
          new Violation(row.code(), "Sort order", "Choose the sort keys as a list."));
    } else {
      if (order.isEmpty()) {
        violations.add(
            new Violation(row.code(), "Sort order", "Choose at least one sort key."));
      }
      if (order.size() > MAX_LIST_VALUES) {
        violations.add(
            new Violation(
                row.code(),
                "Sort order",
                "A ranking row lists at most " + MAX_LIST_VALUES + " sort keys."));
      }
      int checked = 0;
      for (Object key : order) {
        if (checked++ >= MAX_LIST_VALUES) {
          break;
        }
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
    boolean hasLengths = row.params().containsKey("allowedLengths");
    boolean hasFlags = row.params().containsKey("requireUnitFlagFor");
    Object rawNight = row.params().get("nightShiftOnly");
    boolean hasNight = row.params().containsKey("nightShiftOnly");
    // Release 4 #10 adds a third kind of SHIFT_LENGTHS row; the three are alternatives, never a
    // combination, so a half-converted row cannot silently disable one of them.
    if ((hasLengths ? 1 : 0) + (hasFlags ? 1 : 0) + (hasNight ? 1 : 0) != 1) {
      violations.add(
          new Violation(
              row.code(),
              "Shift-types row",
              "A shift-types row does one thing: list the allowed lengths, name the lengths that"
                  + " need a local agreement, or warn about an 8-hour officer on a night shift."));
    }
    if (hasNight && !Boolean.TRUE.equals(rawNight)) {
      violations.add(
          new Violation(
              row.code(),
              "Night shift only",
              "The night-shift warning applies only to night shifts; remove the row instead of"
                  + " turning it off."));
    }
    if (hasLengths && rawLengths == null) {
      violations.add(
          new Violation(row.code(), "Allowed lengths", "Choose at least one shift length."));
    } else if (rawLengths != null && !(rawLengths instanceof List<?>)) {
      violations.add(
          new Violation(
              row.code(),
              "Allowed lengths",
              "Choose the allowed shift lengths (8, 12 and 16) as a list."));
    } else if (rawLengths instanceof List<?> lengths) {
      if (lengths.isEmpty()) {
        violations.add(
            new Violation(row.code(), "Allowed lengths", "Choose at least one shift length."));
      }
      if (lengths.size() > MAX_LIST_VALUES) {
        violations.add(
            new Violation(
                row.code(),
                "Allowed lengths",
                "A shift-types row lists at most " + MAX_LIST_VALUES + " lengths."));
      }
      int checked = 0;
      for (Object length : lengths) {
        if (checked++ >= MAX_LIST_VALUES) {
          break;
        }
        if (!(length instanceof Number number)) {
          violations.add(
              new Violation(
                  row.code(), "Allowed lengths", "Every allowed length must be a number of hours."));
          continue;
        }
        if (!SHIFT_LENGTHS.contains(number.intValue())) {
          violations.add(
              new Violation(
                  row.code(),
                  "Allowed lengths",
                  "Only 8, 12 and 16-hour shifts have templates: " + number + " h cannot be"
                      + " scheduled."));
        }
      }
    }
    Object rawFlags = row.params().get("requireUnitFlagFor");
    if (row.params().containsKey("requireUnitFlagFor") && rawFlags == null) {
      violations.add(
          new Violation(
              row.code(),
              "Needs a local agreement on the unit",
              "Choose the 12- and 16-hour patterns as a list."));
    } else if (rawFlags != null && !(rawFlags instanceof List<?>)) {
      violations.add(
          new Violation(
              row.code(),
              "Needs a local agreement on the unit",
              "Choose the 12- and 16-hour patterns as a list."));
    } else if (rawFlags instanceof List<?> flags) {
      if (flags.size() > MAX_LIST_VALUES) {
        violations.add(
            new Violation(
                row.code(),
                "Needs a local agreement on the unit",
                "A shift-types row lists at most " + MAX_LIST_VALUES + " lengths."));
      }
      int checked = 0;
      for (Object flag : flags) {
        if (checked++ >= MAX_LIST_VALUES) {
          break;
        }
        if (!(flag instanceof Number number)) {
          violations.add(
              new Violation(
                  row.code(),
                  "Needs a local agreement on the unit",
                  "Every length must be a number of hours."));
          continue;
        }
        if (!Set.of(12, 16).contains(number.intValue())) {
          violations.add(
              new Violation(
                  row.code(),
                  "Needs a local agreement on the unit",
                  "Only 12- and 16-hour patterns need the unit flag."));
        }
      }
    }
  }

  private static void validatePosts(RuleRow row, List<Violation> violations) {
    Object postKind = row.params().get("postKind");
    if (postKind == null || !POST_KINDS.contains(postKind.toString())) {
      violations.add(
          new Violation(
              row.code(), "Post", "Choose a supervisor post or an officer post."));
    }
    Object raw = row.params().get("allowedPositions");
    if (!(raw instanceof List<?> positions) || positions.isEmpty()) {
      violations.add(
          new Violation(
              row.code(),
              "Who can work it",
              "Choose at least one position: officers, supervisors or both."));
    } else {
      if (positions.size() > MAX_LIST_VALUES) {
        violations.add(
            new Violation(
                row.code(),
                "Who can work it",
                "A post row lists at most " + MAX_LIST_VALUES + " positions."));
      }
      int checked = 0;
      for (Object position : positions) {
        if (checked++ >= MAX_LIST_VALUES) {
          break;
        }
        if (!POSITIONS.contains(String.valueOf(position))) {
          violations.add(
              new Violation(
                  row.code(),
                  "Who can work it",
                  "Unknown position '"
                      + display(String.valueOf(position))
                      + "'. Choose officers (CO) or supervisors (CS)."));
        }
      }
      if (positions.containsAll(POSITIONS)) {
        violations.add(
            new Violation(
                row.code(),
                "Who can work it",
                "Every position may work this post, so the rule can never fire; choose one"
                    + " position."));
      }
    }
    Object acting = row.params().get("actingQualification");
    if (acting != null
        && !acting.toString().isBlank()
        && (!QUALIFICATION.matcher(acting.toString()).matches()
            || !ACTING_QUALIFICATIONS.contains(acting.toString()))) {
      violations.add(
          new Violation(
              row.code(),
              "Acting qualification",
              "Only the Acting supervisor qualification (ACTING_SUP) can turn this block into a"
                  + " warning; choose it or leave it empty."));
    }
  }

  private static String resultLabel(ca.shiftcircle.rules.facts.RuleOutcome outcome) {
    return switch (outcome) {
      case BLOCK -> "Block";
      case WARN -> "Warn";
      case INFO -> "Info";
    };
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
    return value instanceof Number number ? number.doubleValue() : fallback;
  }

  private static String optionalText(RuleRow row, String key, String fallback) {
    Object value = row.params().get(key);
    return value == null ? fallback : value.toString();
  }
}
