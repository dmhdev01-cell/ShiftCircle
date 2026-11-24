import { describe, expect, it } from 'vitest';

import { dateTimeWords } from './plannerTime';

describe('dateTimeWords', () => {
  it.each([
    // An api instant in UTC reads in Regina time (UTC-6, no daylight saving).
    ['2026-11-24T15:08:19.884657Z', '24 Nov 2026, 09:08'],
    ['2026-11-24T06:00:00Z', '24 Nov 2026, 00:00'],
    // An instant with an offset.
    ['2026-11-20T08:45:47-06:00', '20 Nov 2026, 08:45'],
    // A date-only value is its calendar date.
    ['2026-11-24', '24 Nov 2026'],
    // Anything else is shown as sent.
    ['20 Nov 13:50', '20 Nov 13:50'],
    ['2026-13-99Tnonsense', '2026-13-99Tnonsense'],
    ['', ''],
  ])('%s reads as %s', (value, expected) => {
    expect(dateTimeWords(value)).toBe(expected);
  });
});
