package ca.shiftcircle.rules.rows;

import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import java.util.List;
import java.util.Map;

/**
 * Rule set v1 from docs/05-union-rules.md, as code.
 *
 * <p>This is the same data as {@code V2__reference_data.sql}. The database is the runtime source
 * (step 11 replaces this with rows loaded from PostgreSQL); this fixture is what the rule tests and
 * the boot-time rule base use, and an infrastructure test asserts the two cannot drift apart.
 *
 * <p>Severity and override policy are per row so a rules admin can change them without a code change.
 */
public final class RuleRowsV1 {

  public static final String VERSION = "v1";

  private RuleRowsV1() {}

  public static RuleSet ruleSet() {
    return new RuleSet(VERSION, List.of(u01(), u02(), u03(), u04(), u05(), u08(), u09(), u10(),
        u11(), u12(), u14(), p01(), p01b(), p04(), o01(), o02(), o03(), l01(), s03(), u16()));
  }

  // A. Rest and fatigue ------------------------------------------------------------------------

  public static RuleRow u01() {
    return new RuleRow(
        "U-01",
        RuleTableCode.REST,
        true,
        Map.of("afterShiftKind", ".*", "windowHours", 24, "minExtensionMinutes", 0,
            "minRestHours", 8),
        RuleOutcome.BLOCK,
        OverridePolicy.EMERGENCY,
        "Less than 8 hours rest in 24 hours (Employment Act minimum).",
        "SEA",
        false,
        10);
  }

  public static RuleRow u02() {
    return new RuleRow(
        "U-02",
        RuleTableCode.REST,
        true,
        Map.of("afterShiftKind", "(D8|E8|N8|A12|P12|D12|N12)", "windowHours", 24,
            "minExtensionMinutes", 0, "minRestHours", 12),
        RuleOutcome.WARN,
        OverridePolicy.ACKNOWLEDGE,
        "Less than the 12-hour rest target between shifts.",
        "MOCK",
        true,
        20);
  }

  public static RuleRow u03() {
    return new RuleRow(
        "U-03",
        RuleTableCode.REST,
        true,
        Map.of("afterShiftKind", "L16", "windowHours", 24, "minExtensionMinutes", 0,
            "minRestHours", 12),
        RuleOutcome.BLOCK,
        OverridePolicy.EMERGENCY,
        "Needs 12 hours off after a 16-hour shift.",
        "MOCK",
        true,
        30);
  }

  public static RuleRow u04() {
    return new RuleRow(
        "U-04",
        RuleTableCode.REST,
        true,
        Map.of("afterShiftKind", ".*", "windowHours", 24, "minExtensionMinutes", 240,
            "minRestHours", 10),
        RuleOutcome.WARN,
        OverridePolicy.ACKNOWLEDGE,
        "Short rest after an overtime extension of 4 hours or more.",
        "MOCK",
        true,
        40);
  }

  // C. Hours over a period ---------------------------------------------------------------------

  public static RuleRow u05() {
    return new RuleRow(
        "U-05",
        RuleTableCode.MAX_HOURS,
        true,
        Map.of("windowHours", 24, "maxHours", 16),
        RuleOutcome.BLOCK,
        OverridePolicy.EMERGENCY,
        "More than 16 hours worked in 24 hours (Employment Act limit).",
        "SEA",
        false,
        50);
  }

  public static RuleRow u14() {
    return new RuleRow(
        "U-14",
        RuleTableCode.MAX_HOURS,
        true,
        Map.of("windowHours", 168, "warnAtHours", 48, "maxHours", 60),
        RuleOutcome.BLOCK,
        OverridePolicy.ACKNOWLEDGE,
        "Weekly hours above the 48-hour warning level or the 60-hour ceiling.",
        "MOCK",
        true,
        60);
  }

  // B. Consecutive work ------------------------------------------------------------------------

  public static RuleRow u08() {
    return new RuleRow(
        "U-08",
        RuleTableCode.CONSECUTIVE,
        true,
        Map.of("counts", "DAYS", "max", 7, "overtimeSeverity", "WARN"),
        RuleOutcome.BLOCK,
        OverridePolicy.ACKNOWLEDGE,
        "More than 7 consecutive work days.",
        "NWT; NU",
        true,
        80);
  }

  public static RuleRow u09() {
    return new RuleRow(
        "U-09",
        RuleTableCode.CONSECUTIVE,
        true,
        Map.of("counts", "SHIFTS_12H", "max", 4, "overtimeSeverity", "WARN"),
        RuleOutcome.BLOCK,
        OverridePolicy.ACKNOWLEDGE,
        "More than 4 consecutive 12-hour shifts.",
        "MOCK",
        true,
        90);
  }

  public static RuleRow u10() {
    return new RuleRow(
        "U-10",
        RuleTableCode.CONSECUTIVE,
        true,
        Map.of("counts", "SHIFTS_NIGHT_12H", "max", 4, "overtimeSeverity", "WARN"),
        RuleOutcome.WARN,
        OverridePolicy.ACKNOWLEDGE,
        "More than 4 consecutive overnight (00-12 or 19-07) shifts.",
        "MOCK",
        true,
        100);
  }

  public static RuleRow u11() {
    return new RuleRow(
        "U-11",
        RuleTableCode.LONG_SHIFTS,
        true,
        Map.of("maxIn7Days", 3, "maxIn28Days", 10),
        RuleOutcome.WARN,
        OverridePolicy.ACKNOWLEDGE,
        "Too many 16-hour shifts in a rolling window.",
        "MOCK",
        true,
        110);
  }

  public static RuleRow u12() {
    return new RuleRow(
        "U-12",
        RuleTableCode.DAYS_OFF,
        true,
        Map.of("daysOff", 2, "withinDays", 7),
        RuleOutcome.WARN,
        OverridePolicy.ACKNOWLEDGE,
        "Fewer than 2 consecutive days off in 7 days.",
        "CX; PSGE; NU",
        true,
        120);
  }

  // D. Pay classification ----------------------------------------------------------------------

  public static RuleRow p01() {
    return new RuleRow(
        "P-01",
        RuleTableCode.PAY,
        true,
        Map.of("thresholdWindow", "PAY_PERIOD", "thresholdHours", 80, "paidLeaveCounts", false),
        RuleOutcome.INFO,
        OverridePolicy.NONE,
        "Hours beyond 80 in a two-week pay period are overtime.",
        "SEA; PSGE",
        true,
        130);
  }

  public static RuleRow p01b() {
    return new RuleRow(
        "P-01b",
        RuleTableCode.PAY,
        true,
        Map.of("otRate", 1.5),
        RuleOutcome.INFO,
        OverridePolicy.NONE,
        "Overtime hours are paid at 1.5 times the regular rate.",
        "MOCK",
        true,
        140);
  }

  public static RuleRow p04() {
    return new RuleRow(
        "P-04",
        RuleTableCode.PAY,
        true,
        Map.of("ignoreUnderMinutes", 30),
        RuleOutcome.INFO,
        OverridePolicy.NONE,
        "Overtime under 30 minutes is not paid.",
        "PSGE",
        true,
        150);
  }

  // F. Overtime allocation ---------------------------------------------------------------------

  public static RuleRow o01() {
    return new RuleRow(
        "O-01",
        RuleTableCode.OT_RANKING,
        true,
        Map.of("orderBy", List.of("OT_HOURS_QUARTER_ASC", "SENIORITY_ASC"),
            "skipIfBlocked", true, "keepPlace", true),
        RuleOutcome.INFO,
        OverridePolicy.NONE,
        "Offer overtime equitably among available, qualified officers.",
        "CX",
        true,
        160);
  }

  public static RuleRow o02() {
    return new RuleRow(
        "O-02",
        RuleTableCode.OT_RANKING,
        true,
        Map.of("orderBy", List.of("OT_HOURS_QUARTER_ASC", "SENIORITY_ASC")),
        RuleOutcome.INFO,
        OverridePolicy.NONE,
        "Fewest overtime hours this quarter first, ties broken by seniority.",
        "MOCK",
        true,
        170);
  }

  public static RuleRow o03() {
    return new RuleRow(
        "O-03",
        RuleTableCode.OT_RANKING,
        true,
        Map.of("skipIfBlocked", true, "keepPlace", true),
        RuleOutcome.INFO,
        OverridePolicy.NONE,
        "Officers who would break a block rule are skipped and not penalised.",
        "MOCK",
        true,
        180);
  }

  // G. Shift lengths ---------------------------------------------------------------------------

  public static RuleRow l01() {
    return new RuleRow(
        "L-01",
        RuleTableCode.SHIFT_LENGTHS,
        true,
        Map.of("allowedLengths", List.of(8, 12, 16)),
        RuleOutcome.BLOCK,
        OverridePolicy.NONE,
        "Only 8, 12 and 16-hour shifts; longer patterns need a local agreement on the unit.",
        "Lead direction; PSGE",
        false,
        190);
  }

  public static RuleRow s03() {
    return new RuleRow(
        "S-03",
        RuleTableCode.SHIFT_LENGTHS,
        true,
        Map.of("requireUnitFlagFor", List.of(12, 16)),
        RuleOutcome.BLOCK,
        OverridePolicy.NONE,
        "12- and 16-hour patterns are allowed only on units with a local agreement.",
        "PSGE",
        true,
        200);
  }

  /**
   * Release 4 #10: the planner never puts an 8-hour officer on a night shift (nights are 12-hour
   * crews), so this row guards a supervisor's manual assignment. It is published as rule-set v3 by
   * V12; the fixture carries it so the boot-time rule base and the rule tests see the same rows as
   * the database.
   */
  public static RuleRow u16() {
    return new RuleRow(
        "U-16",
        RuleTableCode.SHIFT_LENGTHS,
        true,
        Map.of("nightShiftOnly", true),
        RuleOutcome.WARN,
        OverridePolicy.ACKNOWLEDGE,
        "An 8-hour officer is assigned to a night shift; 8-hour officers work day or evening.",
        "Person (release 4 #10)",
        true,
        205);
  }
}
