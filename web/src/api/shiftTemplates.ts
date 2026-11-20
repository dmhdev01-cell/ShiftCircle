/**
 * Shift templates (docs/ui/build-notes.md §1.1).
 *
 * The chip text comes from the template code: the three 8 hour defaults show
 * a single letter, every other template shows its code. The times are the
 * ADR-015 defaults, so the 12 hour codes are A12 (00-12) and P12 (12-24).
 */

export interface ShiftTemplate {
  code: string;
  /** What the chip shows. */
  chipText: string;
  /** The words used in copy, e.g. "Day 8 h". */
  label: string;
  start: string;
  end: string;
  /** True when the shift ends on the following day. */
  endsNextDay: boolean;
  /** False for overtime-only templates. */
  regular: boolean;
}

export const shiftTemplates: Record<string, ShiftTemplate> = {
  D8: { code: 'D8', chipText: 'D', label: 'Day 8 h', start: '07:00', end: '15:00', endsNextDay: false, regular: true },
  E8: { code: 'E8', chipText: 'E', label: 'Evening 8 h', start: '15:00', end: '23:00', endsNextDay: false, regular: true },
  N8: { code: 'N8', chipText: 'N', label: 'Night 8 h', start: '23:00', end: '07:00', endsNextDay: true, regular: true },
  A12: { code: 'A12', chipText: 'A12', label: '12 h 00-12', start: '00:00', end: '12:00', endsNextDay: false, regular: true },
  P12: { code: 'P12', chipText: 'P12', label: '12 h 12-24', start: '12:00', end: '24:00', endsNextDay: false, regular: true },
  L16: { code: 'L16', chipText: 'L16', label: '16 h shift', start: '20:00', end: '12:00', endsNextDay: true, regular: true },
};

/** The chip text for a template code, or the code itself when it is unknown. */
export function chipTextFor(code: string): string {
  return shiftTemplates[code]?.chipText ?? code;
}

/**
 * The times on screen: 24-hour times with an en dash, and "+1" when the shift
 * ends the next day (docs/ui/build-notes.md §1.2). A P12 end time is shown as
 * 24:00 on the same date.
 */
export function formatShiftTimes(code: string): string {
  const template = shiftTemplates[code];
  if (!template) return code;
  const suffix = template.endsNextDay ? ' +1' : '';
  return `${template.start} – ${template.end}${suffix}`;
}

/**
 * Short rule names, so the rule-check panel can say "U-01 · Minimum rest"
 * without the api having to send a display name. From docs/05-union-rules.md.
 */
export const ruleNames: Record<string, string> = {
  'U-01': 'Minimum rest',
  'U-02': 'Rest window',
  'U-03': 'Rest after a 16 h shift',
  'U-04': 'Rest exceptions',
  'U-05': 'Max 16 h in 24 h',
  'U-06': 'Max hours in a week',
  'U-08': 'Consecutive work days',
  'U-09': 'Consecutive 12 h shifts',
  'U-10': 'Consecutive nights',
  'U-11': '16 h shifts in a window',
  'U-12': 'Days off',
  'U-14': 'Weekly ceiling',
  'U-15': 'Overtime threshold',
};

export function ruleNameFor(code: string): string | undefined {
  return ruleNames[code];
}
