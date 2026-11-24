/**
 * PR-O: the words and checks the rostered shift dialog uses. Times are read in
 * the centre's zone (Regina, no daylight saving), whatever the browser's zone.
 */
import type { ShiftItem } from '../api/types';
import { weekdayDateWords } from '../planner/unitDates';

const ZONE = 'America/Regina';

const PARTS = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: ZONE,
});

/** The Regina calendar date (YYYY-MM-DD) and 24-hour time of an instant. */
export function reginaParts(instant: string): { date: string; time: string } | null {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(
    PARTS.formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** "Tue 17 Nov 2026, 23:00 – 07:00 next day"; a shift ending at midnight ends at 24:00. */
export function scheduledWords(startAt: string, endAt: string): string {
  const start = reginaParts(startAt);
  const end = reginaParts(endAt);
  if (!start || !end) return `${startAt} – ${endAt}`;
  let endText = end.time;
  if (end.date !== start.date) {
    endText = end.time === '00:00' ? '24:00' : `${end.time} next day`;
  }
  return `${weekdayDateWords(start.date)}, ${start.time} – ${endText}`;
}

/** "Tue 17 Nov at 23:00", the start in the words of the started-shift notice. */
export function startedWords(startAt: string): string {
  const start = reginaParts(startAt);
  if (!start) return startAt;
  const day = weekdayDateWords(start.date).replace(/ \d{4}$/, '');
  return `${day} at ${start.time}`;
}

/** "Mon 21 Dec 2026 at 15:00": a start in words with the year. */
export function startWords(instant: string): string {
  const parts = reginaParts(instant);
  if (!parts) return instant;
  return `${weekdayDateWords(parts.date)} at ${parts.time}`;
}

/** "Thu 19 Nov 2026, 12:00": an instant in words with the year. */
export function instantWords(instant: string): string {
  const parts = reginaParts(instant);
  if (!parts) return instant;
  return `${weekdayDateWords(parts.date)}, ${parts.time}`;
}

/**
 * True when the shift has started by the business clock's "now", the same
 * test the api makes (start <= now) before it refuses a move or cancel.
 */
export function hasStarted(startAt: string, now: string | undefined): boolean {
  if (!now) return false;
  const start = new Date(startAt).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(start) || Number.isNaN(at)) return false;
  return start <= at;
}

/**
 * The board's "now": the api sends the business clock's instant; an older api
 * sends only the demo day, and the business clock reads noon on it (BusinessClock).
 */
export function boardNow(payload: { now?: string | null; asOf?: string }): string | undefined {
  if (payload.now) return payload.now;
  return payload.asOf ? `${payload.asOf}T12:00:00-06:00` : undefined;
}

/** A refusal the api would give, in its own words (AssignmentProblemException). */
export interface KnownRefusal {
  slug: 'shift-started' | 'fills-open-shift' | 'actual-recorded' | 'absence-recorded';
  title: string;
  detail: string;
  /** True when the fix is made in Time & attendance. */
  timeAndAttendance: boolean;
}

export const REFUSALS: Record<KnownRefusal['slug'], KnownRefusal> = {
  'shift-started': {
    slug: 'shift-started',
    title: 'This shift has started',
    detail: 'Past shifts are corrected in Time & attendance, not on the schedule.',
    timeAndAttendance: true,
  },
  'fills-open-shift': {
    slug: 'fills-open-shift',
    title: 'This shift fills an open shift',
    detail: 'Cancel it and assign the open shift again instead of moving it.',
    timeAndAttendance: false,
  },
  'actual-recorded': {
    slug: 'actual-recorded',
    title: 'This shift has actual time recorded',
    detail: 'Correct the actual in Time & attendance instead of cancelling the shift.',
    timeAndAttendance: true,
  },
  'absence-recorded': {
    slug: 'absence-recorded',
    title: 'This shift has an absence recorded',
    detail: 'Correct the absence in Time & attendance instead of cancelling the shift.',
    timeAndAttendance: true,
  },
};

/**
 * What the api would refuse before the request, in its own check order
 * (AssignmentService.move and .cancel). A cancelled shift is not on the board,
 * so "already cancelled" can only come back as an answer.
 */
export function knownRefusals(
  item: Pick<ShiftItem, 'startAt' | 'actualRecorded' | 'absenceRecorded' | 'fillsOpenShift'>,
  now: string | undefined,
): { move: KnownRefusal | null; cancel: KnownRefusal | null } {
  const started = hasStarted(item.startAt, now);
  const move = started
    ? REFUSALS['shift-started']
    : item.fillsOpenShift
      ? REFUSALS['fills-open-shift']
      : null;
  const cancel = started
    ? REFUSALS['shift-started']
    : item.actualRecorded
      ? REFUSALS['actual-recorded']
      : item.absenceRecorded
        ? REFUSALS['absence-recorded']
        : null;
  return { move, cancel };
}

/** The Time & attendance screen opened on one shift (TimeAttendancePage reads these). */
export function timeAttendanceLink(item: Pick<ShiftItem, 'assignmentId' | 'startAt'>, unitId: string): string {
  const date = reginaParts(item.startAt)?.date ?? item.startAt.slice(0, 10);
  const query = new URLSearchParams({ date, unit: unitId, shift: item.assignmentId });
  return `/time?${query.toString()}`;
}
