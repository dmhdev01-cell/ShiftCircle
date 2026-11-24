/**
 * One way to read the planner's times: an instant in Regina time, a date-only
 * value as the calendar date it is. The api's commit result sends the Regina
 * date; parsing it as UTC midnight showed the previous evening ("20 Nov 18:00").
 */

/** "4 Jan 2027" for a date-only value, read as a calendar date (no UTC shift). */
export function plainDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`);
  // en-GB gives the house order "4 Jan 2027" (en-CA gives "Jan 4, 2027").
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** "21 Nov, 09:14": one format for generated/committed lines (Regina time). */
export function whenWords(instant: string): string {
  // A date-only value is a Regina calendar date, not an instant.
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return plainDate(instant);
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return instant;
  const zone = 'America/Regina';
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: zone }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: zone }).format(parsed);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(parsed);
  return `${day} ${month}, ${time}`;
}

/**
 * "24 Nov 2026, 09:08": an api instant (ISO, UTC) read in Regina time, with the
 * year, for lines that can be weeks old (the rule-set version history). A
 * date-only value reads as its calendar date; anything else is shown as sent.
 */
export function dateTimeWords(instant: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return plainDate(instant);
  // Only an ISO instant: Date also parses loose text like "20 Nov 13:50".
  if (!/^\d{4}-\d{2}-\d{2}T/.test(instant)) return instant;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return instant;
  const zone = 'America/Regina';
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: zone,
  }).format(parsed);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(parsed);
  return `${date}, ${time}`;
}
