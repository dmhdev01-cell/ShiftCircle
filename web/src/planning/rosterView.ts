/**
 * The planning board's span and totals (A1), kept apart from the components
 * so they can be tested on their own and reused (PR-B's filters and export).
 *
 * Every date is an ISO day (YYYY-MM-DD) read as UTC, like the rest of the
 * board: the API sends calendar days, not instants.
 */

import type { OfficerRow, ShiftItem } from '../api/types';

/** What the board shows: a week, a 14-day pay period or a calendar month. */
export type BoardView = 'week' | 'period' | 'month';

/** Comfortable is the original board; compact fits a pay period on a laptop. */
export type RosterDensity = 'comfortable' | 'compact';

export const BOARD_VIEWS: { id: BoardView; label: string; unit: string }[] = [
  { id: 'week', label: 'Week', unit: 'week' },
  { id: 'period', label: 'Pay period', unit: 'period' },
  { id: 'month', label: 'Month', unit: 'month' },
];

/** Read ?view=; anything unknown is the default week. */
export function parseView(value: string | null): BoardView {
  return value === 'period' || value === 'month' ? value : 'week';
}

/** Read ?density=; without one, a week is comfortable and a longer span compact. */
export function parseDensity(value: string | null, view: BoardView): RosterDensity {
  if (value === 'compact' || value === 'comfortable') return value;
  return view === 'week' ? 'comfortable' : 'compact';
}

/**
 * A Monday that starts a pay period. Pay periods are 14 days, Monday to
 * Sunday, and every dataset seeds them on this cadence (26 Oct – 8 Nov and
 * 9 – 22 Nov 2026; the planner's 4 – 17 Jan 2027). The board only uses it to
 * choose what to show; the hours and overtime still come from the API.
 */
export const PAY_PERIOD_ANCHOR = '2026-10-12';
export const PAY_PERIOD_DAYS = 14;

const DAY_MS = 24 * 3600 * 1000;

function toTime(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function fromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromTime(toTime(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

/** The Monday of the week a date falls in. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/** The 14-day pay period a date falls in. */
export function payPeriodOf(date: string): { from: string; to: string } {
  const offset = daysBetween(PAY_PERIOD_ANCHOR, date);
  const index = Math.floor(offset / PAY_PERIOD_DAYS);
  const from = addDays(PAY_PERIOD_ANCHOR, index * PAY_PERIOD_DAYS);
  return { from, to: addDays(from, PAY_PERIOD_DAYS - 1) };
}

/** The calendar month a date falls in. */
export function monthOf(date: string): { from: string; to: string } {
  const parsed = new Date(`${date}T00:00:00Z`);
  const first = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  const last = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0));
  return { from: fromTime(first.getTime()), to: fromTime(last.getTime()) };
}

/**
 * The range a view shows around a focus Monday (the ?week= the address
 * keeps). Month is at most 31 days, inside the API's limit.
 */
export function rangeFor(view: BoardView, focusMonday: string): { from: string; to: string } {
  if (view === 'period') return payPeriodOf(focusMonday);
  if (view === 'month') return monthOf(focusMonday);
  return { from: focusMonday, to: addDays(focusMonday, 6) };
}

/**
 * The focus Monday one step before or after the range on screen. A month
 * steps to the first Monday on or after the 1st of the next (or previous)
 * month, so the month of that Monday is the month wanted.
 */
export function stepFocus(view: BoardView, focusMonday: string, step: number): string {
  if (view === 'week') return addDays(focusMonday, step * 7);
  if (view === 'period') return addDays(payPeriodOf(focusMonday).from, step * PAY_PERIOD_DAYS);
  const parsed = new Date(`${focusMonday}T00:00:00Z`);
  const first = fromTime(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + step, 1));
  const monday = mondayOf(first);
  return monday < first ? addDays(monday, 7) : monday;
}

/** True for Saturday and Sunday. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** "16 – 22 Nov 2026", "26 Oct – 8 Nov 2026" or "1 – 30 Nov 2026". */
export function rangeWords(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return '';
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const fmt = (options: Intl.DateTimeFormatOptions, value: Date) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(value);
  const startDay = fmt({ day: 'numeric' }, start);
  const endWords = `${fmt({ day: 'numeric' }, end)} ${fmt({ month: 'short' }, end)} ${fmt({ year: 'numeric' }, end)}`;
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${startDay} ${fmt({ month: 'short' }, start)} ${fmt({ year: 'numeric' }, start)} – ${endWords}`;
  }
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${startDay} – ${endWords}`
    : `${startDay} ${fmt({ month: 'short' }, start)} – ${endWords}`;
}

/**
 * Whether a shift counts toward the totals: a rostered or extra shift does;
 * an unanswered offer and a proposal the rules blocked do not.
 */
export function countsTowardTotals(item: ShiftItem): boolean {
  return !item.offer && !item.proposed;
}

/** A shift's length in hours, from its start and end instants. */
export function shiftHours(item: ShiftItem): number {
  const hours = (new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 3600000;
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

function countedShifts(officer: OfficerRow, date?: string): ShiftItem[] {
  return officer.cells
    .filter((cell) => date === undefined || cell.date === date)
    .flatMap((cell) => cell.items)
    .filter((item): item is ShiftItem => item.type === 'SHIFT' && countsTowardTotals(item));
}

function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/** One officer's shifts and hours over the days on screen. */
export function officerTotals(officer: OfficerRow): { shifts: number; hours: number } {
  const shifts = countedShifts(officer);
  return { shifts: shifts.length, hours: roundHours(shifts.reduce((sum, item) => sum + shiftHours(item), 0)) };
}

/** One day's officers on duty (at least one shift) and their hours. */
export function dayTotals(officers: OfficerRow[], date: string): { onDuty: number; hours: number } {
  let onDuty = 0;
  let hours = 0;
  for (const officer of officers) {
    const shifts = countedShifts(officer, date);
    if (shifts.length > 0) onDuty += 1;
    hours += shifts.reduce((sum, item) => sum + shiftHours(item), 0);
  }
  return { onDuty, hours: roundHours(hours) };
}
