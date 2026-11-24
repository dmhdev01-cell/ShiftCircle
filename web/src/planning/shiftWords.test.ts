import { describe, expect, it } from 'vitest';

import {
  boardNow,
  hasStarted,
  instantWords,
  knownRefusals,
  scheduledWords,
  startedWords,
  startWords,
} from './shiftWords';

describe('the rostered shift words (PR-O)', () => {
  it('writes a day shift, a night shift and a shift ending at midnight in words', () => {
    expect(scheduledWords('2026-11-22T07:00:00-06:00', '2026-11-22T15:00:00-06:00')).toBe(
      'Sun 22 Nov 2026, 07:00 – 15:00',
    );
    expect(scheduledWords('2026-11-17T23:00:00-06:00', '2026-11-18T07:00:00-06:00')).toBe(
      'Tue 17 Nov 2026, 23:00 – 07:00 next day',
    );
    expect(scheduledWords('2026-11-20T12:00:00-06:00', '2026-11-21T00:00:00-06:00')).toBe(
      'Fri 20 Nov 2026, 12:00 – 24:00',
    );
    // An instant in UTC is still read on the centre's clock.
    expect(startedWords('2026-11-18T05:00:00Z')).toBe('Tue 17 Nov at 23:00');
    expect(startWords('2026-12-21T15:00:00-06:00')).toBe('Mon 21 Dec 2026 at 15:00');
    expect(instantWords('2026-11-19T18:00:00Z')).toBe('Thu 19 Nov 2026, 12:00');
  });

  it('takes the business now from the board, or noon on the demo day from an older api', () => {
    expect(boardNow({ now: '2026-11-19T18:00:00Z', asOf: '2026-11-19' })).toBe(
      '2026-11-19T18:00:00Z',
    );
    expect(boardNow({ asOf: '2026-11-19' })).toBe('2026-11-19T12:00:00-06:00');
    expect(boardNow({})).toBeUndefined();
  });

  it('counts start <= now as started, as the api does, and knows nothing without a now', () => {
    expect(hasStarted('2026-11-19T12:00:00-06:00', '2026-11-19T18:00:00Z')).toBe(true);
    expect(hasStarted('2026-11-19T12:01:00-06:00', '2026-11-19T18:00:00Z')).toBe(false);
    expect(hasStarted('2026-11-17T23:00:00-06:00', undefined)).toBe(false);
  });

  it('puts the refusals in the api order: started first, then the cancel and move checks', () => {
    const now = '2026-11-19T18:00:00Z';
    const past = '2026-11-17T23:00:00-06:00';
    const future = '2026-11-22T07:00:00-06:00';
    const started = knownRefusals({ startAt: past, actualRecorded: true }, now);
    expect(started.move?.slug).toBe('shift-started');
    expect(started.cancel?.slug).toBe('shift-started');

    const both = knownRefusals(
      { startAt: future, actualRecorded: true, absenceRecorded: true, fillsOpenShift: true },
      now,
    );
    expect(both.move?.slug).toBe('fills-open-shift');
    expect(both.cancel?.slug).toBe('actual-recorded');

    expect(knownRefusals({ startAt: future }, now)).toEqual({ move: null, cancel: null });

    // The api checks the pay-period lock before "started" and before the rest.
    const locked = knownRefusals({ startAt: past, payPeriodLocked: true, actualRecorded: true }, now);
    expect(locked.move?.slug).toBe('pay-period-locked');
    expect(locked.cancel?.slug).toBe('pay-period-locked');
  });
});
