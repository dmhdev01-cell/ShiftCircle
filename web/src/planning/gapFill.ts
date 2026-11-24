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

/** The business offset (Saskatchewan has no daylight saving). */
const OFFSET = '-06:00';

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
 * Rest is shown as a fact, never as a verdict: below this many hours between
 * the previous shift's end and the chosen start (U-02's default 12 h target),
 * the row says how much rest there is. U-01's floor is a live rule-table
 * value, so only the rule check says whether that passes.
 */
export const REST_HINT_BELOW_HOURS = 12;

/** "Sat 07:00" for an instant with its offset ("2026-11-21T07:00-06:00"). */
function endWords(instant: string): string {
  return `${weekdayShort(instant.slice(0, 10))} ${instant.slice(11, 16)}`;
}

function hoursWords(hours: number): string {
  return Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
}

/**
 * The hints for one free officer, read from the days on screen: the rest
 * after the day before, the run of work days the shift would make, and
 * overtime.
 */
export function hintsFor(
  officer: OfficerRow,
  date: string,
  template: string,
  days: string[],
): GapHint[] {
  const hints: GapHint[] = [];

  // The rest between the day before's last shift and the chosen start.
  const previous = addDays(date, -1);
  const start = shiftTemplates[template]?.start;
  if (!days.includes(previous)) {
    hints.push({ tone: 'info', text: 'the board starts this day: the rule check also sees earlier shifts' });
  } else if (start) {
    const startMs = new Date(`${date}T${start}:00${OFFSET}`).getTime();
    const ending = shiftsOn(officer, previous)
      .map((item) => ({ item, endMs: new Date(item.endAt).getTime() }))
      .filter((entry) => Number.isFinite(entry.endMs))
      .sort((a, b) => b.endMs - a.endMs)[0];
    if (ending) {
      const rest = Math.round(((startMs - ending.endMs) / 3600000) * 10) / 10;
      if (rest < 0) {
        hints.push({ tone: 'warn', text: `overlaps a shift ending ${endWords(ending.item.endAt)}` });
      } else if (rest < REST_HINT_BELOW_HOURS) {
        hints.push({
          tone: 'info',
          text: `${hoursWords(rest)} h rest after a shift ending ${endWords(ending.item.endAt)}`,
        });
      }
    }
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

/** An officer's pay-period figures, from the schedule of the gap's own pay period. */
export type PeriodHours = Pick<OfficerRow, 'payPeriodHours' | 'overtimeStatus' | 'payPeriodThreshold'>;

/**
 * The officers on this board (the API lists the unit's officers with a shift
 * in the range shown) who are free on the gap's day, lowest pay-period hours
 * first (then by name), each with the hints for the chosen template.
 *
 * `periodHours` replaces the payload's figures when the gap sits in another
 * pay period than the board's first day (a month): the payload's hours are
 * for the first day's period. An officer missing from it has no shift in
 * that period, so 0 h.
 */
export function gapCandidates(
  payload: SchedulePayload,
  gap: BlockCoverage,
  template: string,
  periodHours?: Map<string, PeriodHours>,
): GapCandidate[] {
  return payload.officers
    .filter((officer) => isFree(officer, gap.date))
    .map((officer) => {
      if (!periodHours) return officer;
      const own = periodHours.get(officer.employeeId);
      return {
        ...officer,
        payPeriodHours: own?.payPeriodHours ?? 0,
        overtimeStatus: own?.overtimeStatus ?? 'UNDER',
        payPeriodThreshold: own?.payPeriodThreshold ?? officer.payPeriodThreshold,
      };
    })
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
