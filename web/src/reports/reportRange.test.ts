import { describe, expect, it } from 'vitest';

import type { DemoUser, PayPeriod, Unit } from '../api/types';
import { defaultRange, MAX_RANGE_DAYS, rangeProblem, rangeWords, unitsInScope } from './reportRange';

const period = (from: string, to: string, status: 'OPEN' | 'LOCKED'): PayPeriod => ({
  id: `${from}`,
  label: from,
  from,
  to,
  status,
  overtimeThresholdHours: 80,
});

describe('defaultRange: the range each report reads when none is asked for', () => {
  // The demo "today" is Thursday 19 Nov 2026 (ReportsService's asOf).
  const asOf = '2026-11-19';

  it('coverage: five weeks before this week to the end of next week', () => {
    expect(defaultRange('coverage', asOf)).toEqual({ from: '2026-10-12', to: '2026-11-29' });
    // A Monday is its own week.
    expect(defaultRange('coverage', '2026-11-16')).toEqual({ from: '2026-10-12', to: '2026-11-29' });
    // A Sunday belongs to the week that started six days before.
    expect(defaultRange('coverage', '2026-11-22')).toEqual({ from: '2026-10-12', to: '2026-11-29' });
  });

  it('hours: the last locked pay period, else the one today falls in, else two weeks', () => {
    const periods = [
      period('2026-10-26', '2026-11-08', 'LOCKED'),
      period('2026-10-12', '2026-10-25', 'LOCKED'),
      period('2026-11-09', '2026-11-22', 'OPEN'),
    ];
    expect(defaultRange('hours', asOf, periods)).toEqual({ from: '2026-10-26', to: '2026-11-08' });
    expect(defaultRange('hours', asOf, [period('2026-11-09', '2026-11-22', 'OPEN')])).toEqual({
      from: '2026-11-09',
      to: '2026-11-22',
    });
    expect(defaultRange('hours', asOf, [])).toEqual({ from: '2026-11-06', to: asOf });
  });

  it('overtime: the quarter so far', () => {
    expect(defaultRange('overtime', asOf)).toEqual({ from: '2026-10-01', to: asOf });
    expect(defaultRange('overtime', '2027-03-31')).toEqual({ from: '2027-01-01', to: '2027-03-31' });
  });

  it('overrides: the last four weeks', () => {
    expect(defaultRange('overrides', asOf)).toEqual({ from: '2026-10-23', to: asOf });
  });

  it('knows nothing without a demo today', () => {
    expect(defaultRange('coverage', undefined)).toBeUndefined();
    expect(defaultRange('coverage', 'not a date')).toBeUndefined();
  });
});

describe('rangeProblem', () => {
  it('accepts a range in order, a single day and the longest span', () => {
    expect(rangeProblem('2026-10-01', '2026-12-29')).toBeNull();
    expect(rangeProblem('2026-11-19', '2026-11-19')).toBeNull();
    expect(rangeProblem('2026-01-01', '2027-01-02')).toBeNull(); // 366 days apart
  });

  it('refuses a missing, invalid, reversed or too long range with a clear message', () => {
    expect(rangeProblem('', '2026-11-19')).toBe('Choose both a From and a To date.');
    expect(rangeProblem('2026-11-19', '')).toBe('Choose both a From and a To date.');
    expect(rangeProblem('2026-02-30', '2026-03-01')).toBe('The From date is not a valid date.');
    expect(rangeProblem('2026-02-01', '2026-13-01')).toBe('The To date is not a valid date.');
    expect(rangeProblem('2026-11-20', '2026-11-19')).toBe(
      'The To date must be on or after the From date.',
    );
    expect(rangeProblem('2026-01-01', '2027-01-03')).toBe(
      `The range can be at most ${MAX_RANGE_DAYS} days. Choose a shorter range.`,
    );
  });
});

describe('rangeWords and unitsInScope', () => {
  it('says a range in the house date words', () => {
    expect(rangeWords({ from: '2026-10-01', to: '2026-12-29' })).toBe('1 Oct 2026 – 29 Dec 2026');
  });

  it("offers the units the account carries, every unit to the auditor or when nobody is signed in", () => {
    const unit = (code: string): Unit => ({
      id: `id-${code}`,
      code,
      name: `Unit ${code}`,
      kind: 'LIVING',
      allows_12h: true,
      allows_16h: false,
    });
    const units = [unit('A'), unit('B'), unit('C')];
    const supervisor = { roles: ['SUPERVISOR', 'EMPLOYEE'], units: ['A', 'B'] } as DemoUser;
    expect(unitsInScope(units, supervisor).map((u) => u.code)).toEqual(['A', 'B']);
    expect(unitsInScope(units, { roles: ['EMPLOYEE'], units: [] as string[] } as DemoUser)).toEqual([]);
    // The api's auditor account carries no unit codes; the role reads every unit.
    expect(unitsInScope(units, { roles: ['AUDITOR'], units: [] as string[] } as DemoUser)).toEqual(units);
    expect(unitsInScope(units, null)).toEqual(units);
  });
});
