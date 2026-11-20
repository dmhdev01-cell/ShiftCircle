package ca.shiftcircle.rules.model;

/** What a supervisor may do about a rule result (docs/05 §2 severities). */
public enum OverridePolicy {
  /** Blocked unless a supervisor records an emergency reason. */
  EMERGENCY,
  /** Can be saved after an explicit acknowledgement. */
  ACKNOWLEDGE,
  /** Guidance only; nothing to override. */
  NONE
}
