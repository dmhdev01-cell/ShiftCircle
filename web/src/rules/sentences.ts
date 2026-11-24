import type { RuleTableRow } from '../api/types';

/**
 * The plain-language sentence for a rule row.
 *
 * The api sends the sentence with the row (docs/07-api-spec.md §4.7,
 * api RuleSentence.java); this composes the same wording from the values so
 * the panel can update as the admin types, before the draft is saved. It
 * follows the api table by table, so the sentence does not change wording
 * when Build replaces it with the api's, and it never shows a stored pattern
 * such as `(D8|E8|N8)` or `.*`.
 */
export function composeSentence(tableCode: string, row: RuleTableRow): string {
  const params = row.params ?? {};
  const outcome = outcomeText(row.result);
  const override = overrideText(row.override, row.result);

  switch (tableKey(tableCode)) {
    case 'REST':
      return (
        `After ${afterText(params.afterShiftKind ?? row.after)}, an officer needs at least ` +
        `${number(row.minHours)} hours off within ${number(params.windowHours)} hours; ` +
        `otherwise the change is ${outcome}.${override}`
      );
    case 'MAX_HOURS':
      return (
        `No more than ${number(row.minHours)} hours in ${number(params.windowHours)} hours; ` +
        `otherwise the change is ${outcome}.${override}`
      );
    case 'CONSECUTIVE':
      return (
        `No more than ${number(row.minHours)} consecutive ${counted(params.counts)}; ` +
        `a scheduled shift is ${outcome}, and one caused by overtime is ` +
        `${outcomeText(params.overtimeSeverity)}.${override}`
      );
    case 'LONG_SHIFTS':
      return (
        `No more than ${number(row.minHours)} 16-hour shifts in 7 days, and ` +
        `${number(params.maxIn28Days)} in 28 days; otherwise the change is ${outcome}.${override}`
      );
    case 'DAYS_OFF':
      return (
        `At least ${number(row.minHours)} consecutive days off in every ` +
        `${number(params.withinDays)} days; a break of 24 hours or less does not count, ` +
        `and otherwise the change is ${outcome}.${override}`
      );
    default:
      // Pay classification, overtime ranking and shift types: the api's
      // sentence is the row's message, which the grid does not edit.
      return row.sentence;
  }
}

/** The sentence to show: the one the api sent, or the composed one. */
export function sentenceFor(tableCode: string, row: RuleTableRow, edited: boolean): string {
  return edited ? composeSentence(tableCode, row) : row.sentence;
}

/**
 * A stored shift-kind pattern as words for the shift-kind select:
 * `(D8|E8|N8)` reads "D8, E8 or N8". Friendly labels pass through.
 */
export function shiftKindLabel(value: string): string {
  return isPattern(value) ? joinCodes(value) : value;
}

const TABLE_KEYS: Record<string, string> = {
  'rest-between-shifts': 'REST',
  'maximum-hours': 'MAX_HOURS',
  'consecutive-work': 'CONSECUTIVE',
  'sixteen-hour-shifts': 'LONG_SHIFTS',
  'days-off': 'DAYS_OFF',
  'pay-classification': 'PAY',
  'overtime-ranking': 'OT_RANKING',
  'shift-types': 'SHIFT_LENGTHS',
};

/** The web uses slugs; the api's own codes (REST, MAX_HOURS, ...) work too. */
function tableKey(code: string): string {
  return TABLE_KEYS[code] ?? code.toUpperCase();
}

/** "any shift", "a regular shift", or the codes in words; never the stored pattern. */
function afterText(raw: unknown): string {
  const value = raw == null ? '.*' : String(raw).trim();
  switch (value) {
    case '':
    case '.*':
    case 'Any shift':
      return 'any shift';
    case '(D8|E8|N8|A12|P12)':
    case 'Regular shift':
      return 'a regular shift';
    case 'L16':
    case '16 h shift':
      return 'a 16-hour shift';
    case 'A12':
    case '12 h 00–12':
      return 'a 12-hour day shift (00:00–12:00)';
    case 'P12':
    case '12 h 12–24':
      return 'a 12-hour evening shift (12:00–24:00)';
    default:
      return `a ${joinCodes(value)} shift`;
  }
}

function isPattern(value: string): boolean {
  return value.includes('|') || (value.startsWith('(') && value.endsWith(')'));
}

/** `(D8|E8|N8)` or `D8|E8|N8` as "D8, E8 or N8". */
function joinCodes(pattern: string): string {
  const body =
    pattern.startsWith('(') && pattern.endsWith(')') ? pattern.slice(1, -1) : pattern;
  const parts = body.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] ?? body;
  }
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

function outcomeText(raw: unknown): string {
  switch (raw) {
    case 'BLOCK':
      return 'blocked';
    case 'INFO':
      return 'noted';
    default:
      return 'warned';
  }
}

function overrideText(override: RuleTableRow['override'], result: RuleTableRow['result']): string {
  switch (override) {
    case 'EMERGENCY':
      return ' A supervisor may override only in an emergency, with a written reason.';
    case 'ACKNOWLEDGE':
      return result === 'BLOCK'
        ? ' It cannot be saved and has no override.'
        : ' A supervisor must acknowledge it before the change is saved.';
    default:
      return ' It cannot be overridden.';
  }
}

function counted(raw: unknown): string {
  switch (raw) {
    case 'DAYS':
      return 'days';
    case 'SHIFTS_12H':
      return '12-hour shifts';
    case 'SHIFTS_NIGHT_12H':
      return 'overnight 12-hour shifts';
    default:
      return 'shifts';
  }
}

function number(value: unknown): string {
  return typeof value === 'number' ? String(value) : String(value ?? '');
}
