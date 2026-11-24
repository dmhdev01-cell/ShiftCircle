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

/**
 * The one-line headline: "Planning 150 officers in 6 units · 120 full-time,
 * 30 part-time or casual · 138 FTE against about 123 needed · 4 Jan – 11 Apr 2027".
 */
export function inputsHeadline(inputs: PlanInputs): string {
  const { officers, window } = inputs;
  const parts = [
    `Planning ${count(officers.total)} ${officers.total === 1 ? 'officer' : 'officers'} in ${officers.units} ${officers.units === 1 ? 'unit' : 'units'}`,
    officers.partTime > 0
      ? `${count(officers.fullTime)} full-time, ${count(officers.partTime)} part-time or casual`
      : `all ${count(officers.fullTime)} full-time`,
    officers.neededFte !== null && officers.neededFte !== undefined
      ? `${fte(officers.fte)} FTE against about ${count(officers.neededFte)} needed`
      : `${fte(officers.fte)} FTE`,
    inputWindowWords(window.from, window.to),
  ];
  return parts.join(' · ');
}

/** "Seed 20261001 · 8 h officers on their own pattern · rule set v3". */
export function optionsLine(inputs: PlanInputs): string {
  const pattern =
    inputs.options.pattern8h === null || inputs.options.pattern8h === undefined
      ? '8 h officers on their own pattern'
      : `every 8 h officer on ${PATTERN_WORDS[inputs.options.pattern8h] ?? inputs.options.pattern8h}`;
  return `Seed ${inputs.options.seed} · ${pattern} · rule set v${inputs.rules.ruleSetVersion}`;
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
