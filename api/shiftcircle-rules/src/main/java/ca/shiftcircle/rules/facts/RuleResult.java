package ca.shiftcircle.rules.facts;

import ca.shiftcircle.rules.model.OverridePolicy;
import java.util.List;

/**
 * One rule result, produced by a template rule and returned to the API.
 *
 * @param ruleId rule code from the mock agreement, e.g. {@code U-01}
 * @param ruleTable decision table the row belongs to, e.g. {@code REST}
 * @param outcome block, warn or info
 * @param message plain-language message shown to the user
 * @param required required value in {@code unit}
 * @param actual value measured on the proposed change
 * @param unit unit of {@code required}/{@code actual}, e.g. {@code hours}
 * @param overridePolicy what a supervisor may do about it
 * @param ruleSetVersion published rule-set version the row came from
 * @param evidence short human-readable evidence naming the shifts involved
 * @param evidenceAssignmentIds machine-only assignment ids behind the evidence; never shown to a
 *     user, used by the demo self-check to match a block to a recorded override
 */
public record RuleResult(
    String ruleId,
    String ruleTable,
    RuleOutcome outcome,
    String message,
    double required,
    double actual,
    String unit,
    OverridePolicy overridePolicy,
    String ruleSetVersion,
    String evidence,
    List<String> evidenceAssignmentIds) {}
