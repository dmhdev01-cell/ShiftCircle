package ca.shiftcircle.rules.facts;

/**
 * One rule result, produced by a template rule and returned to the API.
 *
 * @param ruleId rule code from the mock agreement, e.g. {@code U-01}
 * @param ruleTable decision table the row belongs to, e.g. {@code rest-between-shifts}
 * @param outcome block, warn or info
 * @param message plain-language message shown to the user
 * @param required required value in {@code unit}
 * @param actual value measured on the proposed change
 * @param unit unit of {@code required}/{@code actual}, e.g. {@code hours}
 * @param overridePolicy {@code NONE}, {@code REASON} or {@code EMERGENCY}
 * @param ruleSetVersion published rule-set version the row came from
 * @param evidence short human-readable evidence, e.g. the shifts involved
 */
public record RuleResult(
    String ruleId,
    String ruleTable,
    RuleOutcome outcome,
    String message,
    double required,
    double actual,
    String unit,
    String overridePolicy,
    String ruleSetVersion,
    String evidence) {}
