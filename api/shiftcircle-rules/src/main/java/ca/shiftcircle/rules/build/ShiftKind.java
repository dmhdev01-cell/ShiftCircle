package ca.shiftcircle.rules.build;

/** Whether a shift is part of the roster or picked up beyond it (ADR-016: not "overtime"). */
public enum ShiftKind {
  ROSTERED,
  EXTRA
}
