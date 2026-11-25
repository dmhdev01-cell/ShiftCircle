import type { PlanInputs } from '../api/types';

/** "4 Jan – 11 Apr 2027". */
export function inputWindowWords(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const part = (value: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(value);
  return `${part(start, { day: 'numeric' })} ${part(start, { month: 'short' })} – ${part(end, { day: 'numeric' })} ${part(end, { month: 'short' })} ${part(end, { year: 'numeric' })}`;
}

function count(value: number): string {
  return value.toLocaleString('en-CA');
}

function fte(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "4 Jan – 14 Feb" (the year only when the window's last day is shown elsewhere). */
function stretchWords(from: string, to: string): string {
  const part = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  return `${part(from, { day: 'numeric' })} ${part(from, { month: 'short' })} – ${part(to, { day: 'numeric' })} ${part(to, { month: 'short' })}`;
}

/**
 * The staffing floor in words. One stretch (no unit closes): "about 127 needed".
 * Several stretches (a unit closes part-way): the stretch that needs the most
 * officers, with its dates, so the figure is never passed off as the whole
 * quarter. On a tie the api keeps the earliest stretch.
 */
export function neededWords(inputs: PlanInputs): string | null {
  const { officers } = inputs;
  if (officers.neededFte === null || officers.neededFte === undefined) return null;
  const base = `about ${count(officers.neededFte)} needed`;
  if ((officers.neededPeriods ?? 1) > 1 && officers.neededFrom && officers.neededTo) {
    return `${base} for the stretch that needs the most (${stretchWords(officers.neededFrom, officers.neededTo)})`;
  }
  return base;
}

function plural(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/**
 * "107 officers and 10 supervisors", or "107 officers" when there are no
 * supervisors (release v1.3 S7).
 */
export function peopleWords(officers: number, supervisors?: number): string {
  const line = plural(officers, 'officer', 'officers');
  return supervisors ? `${line} and ${plural(supervisors, 'supervisor', 'supervisors')}` : line;
}

/**
 * "5,595 shifts (5,103 officer + 492 supervisor)", or "5,595 shifts" when no
 * supervisor shift is in it (release v1.3 S7).
 */
export function shiftsWords(total: number, officerShifts?: number, supervisorShifts?: number): string {
  const line = plural(total, 'shift', 'shifts');
  if (!supervisorShifts || officerShifts === undefined) return line;
  return `${line} (${count(officerShifts)} officer + ${count(supervisorShifts)} supervisor)`;
}

/**
 * Who the plan is for: "150 officers + 12 supervisors in 6 units + 2 supervisor
 * posts" (release v1.3 S7), or "150 officers in 6 units" with no supervisors.
 * A full-time-only draft counts the full-time people of each rank.
 */
function plannedWords(inputs: PlanInputs, fullTimeOnly: boolean): string {
  const { officers } = inputs;
  const officerRow = officers.byPosition?.find((row) => !row.supervisory);
  const supervisorRows = officers.byPosition?.filter((row) => row.supervisory) ?? [];
  const posts = officers.posts ?? 0;
  const supervisors = supervisorRows.reduce((sum, row) => sum + (fullTimeOnly ? row.fullTime : row.total), 0);
  if (!officerRow || (supervisors === 0 && posts === 0)) {
    const planned = fullTimeOnly ? officers.fullTime : officers.total;
    return `${plural(planned, 'officer', 'officers')} in ${plural(officers.units, 'unit', 'units')}`;
  }
  const lineUnits = officers.lineUnits ?? officers.units - posts;
  const people = plural(fullTimeOnly ? officerRow.fullTime : officerRow.total, 'officer', 'officers');
  const ranks = supervisors > 0 ? `${people} + ${plural(supervisors, 'supervisor', 'supervisors')}` : people;
  const places = posts > 0
    ? `${plural(lineUnits, 'unit', 'units')} + ${plural(posts, 'supervisor post', 'supervisor posts')}`
    : plural(lineUnits, 'unit', 'units');
  return `${ranks} in ${places}`;
}

/**
 * The one-line headline: "Planning 150 officers + 12 supervisors in 6 units +
 * 2 supervisor posts · 131 full-time, 31 part-time or casual · 149.6 FTE against
 * about 137 needed · 4 Jan – 11 Apr 2027". The full-time, part-time and FTE
 * figures count both ranks.
 */
export function inputsHeadline(inputs: PlanInputs): string {
  const { officers, window } = inputs;
  const needed = neededWords(inputs);
  // PR-N: a full-time-only draft plans with the full-time officers alone; say who is left out.
  const staffTypes = inputs.options.staffTypes;
  const fullTimeOnly =
    Array.isArray(staffTypes) && !staffTypes.includes('PART_TIME') && officers.partTime > 0;
  const plannedFte =
    fullTimeOnly && officers.partTimeFte !== undefined ? officers.fte - officers.partTimeFte : officers.fte;
  const parts = [
    `Planning ${plannedWords(inputs, fullTimeOnly)}`,
    fullTimeOnly
      ? `full-time only, ${count(officers.partTime)} part-time or casual left out`
      : officers.partTime > 0
        ? `${count(officers.fullTime)} full-time, ${count(officers.partTime)} part-time or casual`
        : `all ${count(officers.fullTime)} full-time`,
    needed ? `${fte(plannedFte)} FTE against ${needed}` : `${fte(plannedFte)} FTE`,
    inputWindowWords(window.from, window.to),
  ];
  return parts.join(' · ');
}

/** One generate option in words: a label for the detail and a phrase for the summary line. */
export interface OptionWords {
  key: string;
  label: string;
  value: string;
  phrase: string;
}

const OPTION_LABELS: Record<string, string> = {
  seed: 'Seed',
  pattern8h: '8 h pattern',
  staffTypes: 'Staff to include',
  partTimeFill: 'Part-time fill',
  crossUnitFill: 'Cover gaps from other units',
};

const VALUE_WORDS: Record<string, Record<string, string>> = {
  // The same words as the Generate options (PR-N).
  partTimeFill: { AFTER_FULL_TIME: 'fill gaps only', UP_TO_FTE: 'up to each officer’s FTE' },
  crossUnitFill: { OFF: 'off', ON: 'on' },
};

function humanize(code: string): string {
  const spaced = code.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function valueWords(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (key === 'staffTypes' && Array.isArray(value)) {
    const types = [...value].map(String);
    if (types.length === 1 && types[0] === 'FULL_TIME') return 'full-time only';
    if (types.includes('FULL_TIME') && types.includes('PART_TIME')) return 'full-time and part-time or casual';
  }
  if (Array.isArray(value)) return value.map((item) => humanize(String(item)).toLowerCase()).join(', ');
  if (typeof value === 'string') return VALUE_WORDS[key]?.[value] ?? humanize(value).toLowerCase();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Every option the draft (or Generate) carries, in the order the api sent
 * them, seed first. Unknown options still show, in plain words from their
 * names, so a new Generate option appears here without a change.
 */
export function optionWords(options: PlanInputs['options'], fromDraft: boolean): OptionWords[] {
  const keys = Object.keys(options).sort((a, b) => (a === 'seed' ? -1 : b === 'seed' ? 1 : 0));
  return keys.map((key) => {
    const raw = options[key];
    if (key === 'seed') {
      const label = fromDraft ? 'Seed' : 'Default seed';
      return { key, label, value: String(raw), phrase: `${label} ${String(raw)}` };
    }
    if (key === 'pattern8h') {
      const value =
        raw === null || raw === undefined ? 'each officer’s own' : (PATTERN_WORDS[String(raw)] ?? String(raw));
      const phrase =
        raw === null || raw === undefined ? '8 h officers on their own pattern' : `every 8 h officer on ${value}`;
      return { key, label: OPTION_LABELS[key], value, phrase };
    }
    const label = OPTION_LABELS[key] ?? humanize(key);
    const value = valueWords(key, raw);
    return { key, label, value, phrase: `${label.toLowerCase()}: ${value}` };
  });
}

/** The Generate options at the value that makes the plan as before (PR-N). */
const DEFAULT_OPTION_VALUES: Record<string, string> = {
  staffTypes: 'FULL_TIME,PART_TIME',
  partTimeFill: 'AFTER_FULL_TIME',
  crossUnitFill: 'OFF',
};

/**
 * "Seed 20261001 · 8 h officers on their own pattern · rule set v3". A
 * tailoring option at its default is left out of this line (the detail still
 * lists it); a changed one is named, e.g. "cover gaps from other units: on".
 */
export function optionsLine(inputs: PlanInputs, fromDraft = true): string {
  const shown = optionWords(inputs.options, fromDraft).filter((option) => {
    const preset = DEFAULT_OPTION_VALUES[option.key];
    if (preset === undefined) return true;
    const raw = inputs.options[option.key];
    return String(Array.isArray(raw) ? raw.join(',') : raw) !== preset;
  });
  return [...shown.map((option) => option.phrase), `rule set v${inputs.rules.ruleSetVersion}`].join(' · ');
}

export const PATTERN_WORDS: Record<string, string> = {
  ROTATING_5_2: 'rotating 5 on, 2 off',
  '5_ON_2_OFF': 'fixed 5 on, 2 off',
  '7_ON_3_OFF': '7 on, 3 off',
};

/** What changed between the draft's snapshot and the staff now, in words; null when nothing did. */
export function changedSince(snapshot: PlanInputs, live: PlanInputs): string | null {
  const before = snapshot.officers;
  const now = live.officers;
  const changes: string[] = [];
  if (before.total !== now.total) changes.push(`${count(now.total)} officers (was ${count(before.total)})`);
  if (before.fullTime !== now.fullTime) changes.push(`${count(now.fullTime)} full-time (was ${count(before.fullTime)})`);
  if (before.partTime !== now.partTime)
    changes.push(`${count(now.partTime)} part-time or casual (was ${count(before.partTime)})`);
  if (before.fte !== now.fte) changes.push(`${fte(now.fte)} FTE (was ${fte(before.fte)})`);
  if (snapshot.leave.days !== live.leave.days)
    changes.push(`${count(live.leave.days)} planned leave days (was ${count(snapshot.leave.days)})`);
  if (snapshot.preferences.officers !== live.preferences.officers)
    changes.push(
      `${count(live.preferences.officers)} officers with preferences (was ${count(snapshot.preferences.officers)})`,
    );
  return changes.length === 0 ? null : changes.join(', ');
}

export const LEAVE_WORDS: Record<string, string> = {
  VACATION: 'Vacation',
  SICK: 'Sick',
  OTHER: 'Other',
};

export const TIME_WORDS: Record<string, string> = {
  DAY: 'Days',
  EVENING: 'Evenings',
  NIGHT: 'Nights',
};
