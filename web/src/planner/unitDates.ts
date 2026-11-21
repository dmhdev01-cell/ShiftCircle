/**
 * Release 3 date words: "15 Feb 2027" and "Mon 15 Feb 2027" for a date-only
 * value (the closure dates), and "21 Nov 23:40" for a creation instant in
 * Regina. Read as calendar values, never as UTC midnight.
 */

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const WEEKDAY_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function dateWords(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return DAY.format(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`));
}

export function weekdayDateWords(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return WEEKDAY_DAY.format(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`));
}

/** The date so many days later, as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function createdAtWords(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const zone = 'America/Regina';
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: zone }).format(parsed);
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: zone }).format(parsed);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(parsed);
  return `${day} ${month} ${time}`;
}
