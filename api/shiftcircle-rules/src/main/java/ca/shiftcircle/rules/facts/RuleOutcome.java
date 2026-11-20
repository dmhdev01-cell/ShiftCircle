package ca.shiftcircle.rules.facts;

/**
 * Outcome of a single rule evaluation.
 *
 * <p>There is no {@code PASS}: a result only exists when a rule has something to report. The API
 * adds pass entries for rules that did not fire so the UI can show "9 other rules passed".
 */
public enum RuleOutcome {
  /** Change cannot be saved; override only where the rule allows it. */
  BLOCK,
  /** Change can be saved only after an explicit acknowledgement. */
  WARN,
  /** Guidance only; no acknowledgement and no block. */
  INFO
}
