import type { AbsenceType } from '../api/types';
import { addDays, dateWords, weekdayDateWords } from './unitDates';

/** The most days one entry writes (one POST per day). Dataset 150's longest block is 14. */
export const MAX_LEAVE_DAYS = 31;

export const LEAVE_TYPE_WORDS: Record<AbsenceType, string> = {
  VACATION: 'Vacation',
  SICK: 'Sick',
  OTHER: 'Other',
};

export interface LeaveForm {
  employeeId: string;
  from: string;
  to: string;
}

/**
 * Every date from `from` to `to`, both included (YYYY-MM-DD, calendar days).
 * Stops at MAX_LEAVE_DAYS + 1 on purpose: one past the cap is enough for
 * leaveProblem to see "too long" without walking a mistyped year.
 */
export function leaveDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to && dates.length <= MAX_LEAVE_DAYS; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** "Mon 8 Feb 2027" or "Mon 8 Feb – Sun 14 Feb 2027 (7 days)". */
export function leaveRangeWords(from: string, to: string): string {
  if (from === to) return weekdayDateWords(from);
  const days = leaveDates(from, to).length;
  return `${weekdayDateWords(from)} – ${weekdayDateWords(to)} (${days} days)`;
}

/** The first problem with the form, in words, or null when it can be saved. */
export function leaveProblem(form: LeaveForm, window: { from: string; to: string } | null): string | null {
  if (!form.employeeId) return 'Choose an officer.';
  if (!form.from || !form.to) return 'Enter the first and the last day of the leave.';
  if (form.to < form.from) return 'The last day is before the first day.';
  if (window && (form.from < window.from || form.to > window.to)) {
    return `Leave must be inside the plan quarter (${dateWords(window.from)} – ${dateWords(window.to)}).`;
  }
  if (leaveDates(form.from, form.to).length > MAX_LEAVE_DAYS) {
    return `Enter at most ${MAX_LEAVE_DAYS} days at a time.`;
  }
  return null;
}
