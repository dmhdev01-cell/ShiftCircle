/**
 * A2: fill a coverage gap from the board. Who is free that day in the unit,
 * ranked by pay-period hours, with plain hints read from the cells already on
 * screen. The ranking is a convenience only: choosing an officer runs the
 * same rule check as an empty cell, and the rules engine decides.
 *
 * Dates are ISO days and instants carry the business offset (-06:00), so the
 * date and the clock time are read straight from the string.
 */

import { shiftTemplates } from '../api/shiftTemplates';
import type { Block, BlockCoverage, OfficerRow, SchedulePayload, ShiftItem } from '../api/types';
import { addDays, countsTowardTotals } from './rosterView';

/** The block's hours, as the overtime board names them ("Days 07:00 – 15:00"). */
export const BLOCK_WORDS: Record<Block, { name: string; start: string; end: string }> = {
  DAY: { name: 'Days', start: '07:00', end: '15:00' },
  EVENING: { name: 'Evenings', start: '15:00', end: '23:00' },
  NIGHT: { name: 'Nights', start: '23:00', end: '07:00' },
};

/**
 * The templates offered for a block: the 8 h shift first (the default), then
 * the 12 h shifts that cover part of it.
 */
export const BLOCK_TEMPLATES: Record<Block, string[]> = {
  DAY: ['D8', 'D12', 'A12'],
  EVENING: ['E8', 'P12'],
  NIGHT: ['N8', 'N12'],
};

export type HintTone = 'warn' | 'info';

export interface GapHint {
  tone: HintTone;
  text: string;
}

export interface GapCandidate {
  officer: OfficerRow;
  /** under, near (approaching) or OT, as the status pill says it. */
  status: 'under' | 'near' | 'ot';
  hints: GapHint[];
}

/** "Sat" for an ISO day. */
function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "Sat 21 Nov" for an ISO day. */
export function dayWords(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(parsed);
  return `${fmt({ weekday: 'short' })} ${fmt({ day: 'numeric' })} ${fmt({ month: 'short' })}`;
}

/** True when the cell is a gap the board can offer to fill: short, today or later. */
export function isFillable(block: BlockCoverage, today: string): boolean {
  return block.date >= today && (!block.covered || block.scheduled.shortHours.length > 0);
}

function templateHours(code: string): number {
  const template = shiftTemplates[code];
  if (!template) return 0;
  const [sh, sm] = template.start.split(':').map(Number);
  const [eh, em] = template.end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

function shiftsOn(officer: OfficerRow, date: string): ShiftItem[] {
  return (officer.cells.find((cell) => cell.date === date)?.items ?? []).filter(
    (item): item is ShiftItem => item.type === 'SHIFT' && countsTowardTotals(item),
  );
}

/** Nothing at all on the day: no shift, no offer or proposal, no absence. */
function isFree(officer: OfficerRow, date: string): boolean {
  const cell = officer.cells.find((entry) => entry.date === date);
  return cell !== undefined && cell.items.length === 0;
}

/**
 * The hints for one free officer, read from the days on screen: a shift
 * ending on the morning of the gap, the run of work days the shift would
 * make, and overtime.
 */
export function hintsFor(
  officer: OfficerRow,
  date: string,
  template: string,
  days: string[],
): GapHint[] {
  const hints: GapHint[] = [];

  // A shift from the day before that ends on the gap's day.
  const previous = addDays(date, -1);
  const ending = shiftsOn(officer, previous).find((item) => item.endAt.slice(0, 10) === date);
  if (ending) {
    const time = ending.endAt.slice(11, 16);
    hints.push({
      tone: 'warn',
      text:
        time === '00:00'
          ? `worked until midnight ${weekdayShort(previous)}: check the rest rule`
          : `worked a night ending ${weekdayShort(date)} ${time}: likely a rest-rule Block`,
    });
  }

  // The run of work days the shift would join, as far as the board shows.
  let back = 0;
  let day = addDays(date, -1);
  while (days.includes(day) && shiftsOn(officer, day).length > 0) {
    back += 1;
    day = addDays(day, -1);
  }
  const openBefore = !days.includes(day);
  let forward = 0;
  day = addDays(date, 1);
  while (days.includes(day) && shiftsOn(officer, day).length > 0) {
    forward += 1;
    day = addDays(day, 1);
  }
  const run = back + 1 + forward;
  if (run >= 6) {
    hints.push({
      tone: 'warn',
      text: `would make ${openBefore && back > 0 ? 'at least ' : ''}${run} work days in a row`,
    });
  }

  // Overtime is pay-period hours over the threshold, not a shift type.
  const after = officer.payPeriodHours + templateHours(template);
  if (officer.overtimeStatus === 'IN_OVERTIME') {
    hints.push({ tone: 'info', text: 'in overtime: this shift is paid at OT' });
  } else if (after > officer.payPeriodThreshold) {
    hints.push({
      tone: 'info',
      text: `this shift takes them over ${officer.payPeriodThreshold} h: paid at OT`,
    });
  }
  return hints;
}

/**
 * The officers in the unit who are free on the gap's day, lowest pay-period
 * hours first (then by name), each with the hints for the chosen template.
 */
export function gapCandidates(
  payload: SchedulePayload,
  gap: BlockCoverage,
  template: string,
): GapCandidate[] {
  return payload.officers
    .filter((officer) => isFree(officer, gap.date))
    .slice()
    .sort((a, b) => a.payPeriodHours - b.payPeriodHours || a.name.localeCompare(b.name))
    .map((officer) => ({
      officer,
      status:
        officer.overtimeStatus === 'IN_OVERTIME'
          ? ('ot' as const)
          : officer.overtimeStatus === 'APPROACHING'
            ? ('near' as const)
            : ('under' as const),
      hints: hintsFor(officer, gap.date, template, payload.days),
    }));
}
