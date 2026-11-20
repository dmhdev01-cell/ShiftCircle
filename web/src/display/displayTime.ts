import type { Block } from '../api/types';

/** docs/07 §5: the wall display asks for new counts every 60 s. */
export const REFRESH_MS = 60_000;
/** After 2.5 refresh intervals without an answer, the counts are no longer called live. */
export const STALE_AFTER_MS = 150_000;

/** The centre's clock, whatever the TV's own time zone is. */
const ZONE = 'America/Regina';
const timeFormat = new Intl.DateTimeFormat('en-CA', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: ZONE,
});
const hourFormat = new Intl.DateTimeFormat('en-CA', { hour: '2-digit', hourCycle: 'h23', timeZone: ZONE });

export function clockTime(at: number): string {
  return timeFormat.format(at);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Thursday 19 November 2026" for the demo day, the same in every browser. */
export function dayWords(asOf: string): string {
  const date = new Date(`${asOf}T12:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Coverage blocks (ADR-013), named as blocks, not shifts (docs/ui/build-notes.md). */
export const BLOCK_WORDS: Record<Block, { name: string; hours: string; next: string }> = {
  DAY: { name: 'Days', hours: '07:00 – 15:00', next: '15:00' },
  EVENING: { name: 'Evenings', hours: '15:00 – 23:00', next: '23:00' },
  NIGHT: { name: 'Nights', hours: '23:00 – 07:00', next: '07:00' },
};

export function currentBlock(at: number): Block {
  const hour = Number(hourFormat.format(at));
  if (hour >= 7 && hour < 15) return 'DAY';
  if (hour >= 15 && hour < 23) return 'EVENING';
  return 'NIGHT';
}
