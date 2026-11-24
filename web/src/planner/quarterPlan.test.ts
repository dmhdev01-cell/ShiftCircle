import { describe, expect, it } from 'vitest';

import type { PlannerGap, PlannerScorecard } from '../api/types';
import {
  gapRuns,
  partTimeCapacity,
  quarterWeeks,
  reasonWords,
  shortWords,
  staffedWords,
  warningIndex,
} from './quarterPlan';

const REASON = 'No eligible officer left without a Block rule; a supervisor fills this';

function gap(date: string, overrides: Partial<PlannerGap> = {}): PlannerGap {
  return {
    unitId: 'esc',
    unitCode: 'ESC',
    unitName: 'Escort & transport',
    date,
    block: 'EVENING',
    required: 4,
    placed: 3,
    reason: REASON,
    ...overrides,
  };
}

describe('gap runs (A7)', () => {
  it('groups the same unit and block on days in a row, and breaks on a missing day', () => {
    const runs = gapRuns([
      gap('2027-01-15'),
      gap('2027-01-13'),
      gap('2027-01-14', { placed: 2 }),
      gap('2027-01-17'),
      gap('2027-01-13', { block: 'DAY' }),
      gap('2027-01-13', { unitId: 'adm', unitCode: 'ADM', unitName: 'Admissions' }),
    ]);
    expect(runs.map((run) => [run.unitName, run.block, run.from, run.to, run.gaps.length])).toEqual([
      ['Admissions', 'EVENING', '2027-01-13', '2027-01-13', 1],
      ['Escort & transport', 'DAY', '2027-01-13', '2027-01-13', 1],
      ['Escort & transport', 'EVENING', '2027-01-13', '2027-01-15', 3],
      ['Escort & transport', 'EVENING', '2027-01-17', '2027-01-17', 1],
    ]);
    const long = runs[2];
    expect(shortWords(long)).toBe('1–2');
    expect(staffedWords(long)).toBe('2–3 / 4');
    expect(shortWords(runs[3])).toBe('1');
    expect(staffedWords(runs[3])).toBe('3 / 4');
  });

  it('joins a run across a month end', () => {
    const runs = gapRuns([gap('2027-01-31'), gap('2027-02-01')]);
    expect(runs).toHaveLength(1);
    expect(runs[0].to).toBe('2027-02-01');
  });

  it('says the reason plainly, and keeps any other reason as the api sent it', () => {
    const [run] = gapRuns([gap('2027-01-13')]);
    expect(reasonWords(run)).toBe(
      'No eligible officer was free without breaking a blocking rule. A supervisor fills it on the planning board.',
    );
    expect(reasonWords(gapRuns([gap('2027-01-13', { reason: 'Unit closed' })])[0])).toBe('Unit closed');
    expect(reasonWords(gapRuns([gap('2027-01-13', { reason: null })])[0])).toBe('—');
  });

  it('counts the 14 weeks of the 4 Jan – 11 Apr 2027 quarter', () => {
    const weeks = quarterWeeks('2027-01-04', '2027-04-11');
    expect(weeks).toHaveLength(14);
    expect(weeks[0]).toBe('2027-01-04');
    expect(weeks[13]).toBe('2027-04-05');
  });
});

describe('draft warnings by chip (A8)', () => {
  it('keys each warning by officer, date and shift code, joining two on one chip', () => {
    const index = warningIndex([
      {
        ruleName: 'Week over 48 hours',
        count: 1,
        items: [{ unitCode: 'A', date: '2027-01-16', employeeName: 'Nia Thompson', shift: 'A12', message: '62 hours this week' }],
      },
      {
        ruleName: 'Fewer than 12 hours between shifts',
        count: 2,
        items: [
          { unitCode: 'A', date: '2027-01-16', employeeName: 'Nia Thompson', shift: 'A12 00:00–12:00', message: '9 h between shifts' },
          { unitCode: 'B', date: '2027-01-09', employeeName: 'Kai Lindqvist', shift: 'D8', message: '10 h between shifts' },
        ],
      },
    ]);
    expect(index.get('Nia Thompson|2027-01-16|A12')).toBe(
      'Week over 48 hours: 62 hours this week; Fewer than 12 hours between shifts: 9 h between shifts',
    );
    expect(index.get('Kai Lindqvist|2027-01-09|D8')).toBe('Fewer than 12 hours between shifts: 10 h between shifts');
    expect(index.size).toBe(2);
  });
});

describe('unused part-time capacity (scorecard line)', () => {
  const card = (bands: NonNullable<PlannerScorecard['fteBands']>['bands']) =>
    ({ fteBands: { bands, note: '' } }) as unknown as PlannerScorecard;

  it('adds the part-time bands, planned against target', () => {
    // Dataset 150's shape: 6,564 h planned of a 10,080 h target.
    expect(
      partTimeCapacity(
        card([
          { band: 'FULL_TIME', officers: 120, targetHours: 560, plannedMin: 500, plannedAvg: 580, plannedMax: 620 },
          { band: '0.7_TO_0.9', officers: 10, targetHours: 448, plannedMin: 200, plannedAvg: 300, plannedMax: 448 },
          { band: 'UNDER_0.7', officers: 20, targetHours: 280, plannedMin: 0, plannedAvg: 178.2, plannedMax: 280 },
        ]),
      ),
    ).toEqual({ planned: 6564, target: 10080, unused: 3516 });
  });

  it('never reports negative capacity, and says nothing without part-time officers', () => {
    expect(
      partTimeCapacity(
        card([{ band: 'UNDER_0.7', officers: 2, targetHours: 100, plannedMin: 100, plannedAvg: 120, plannedMax: 140 }]),
      ),
    ).toEqual({ planned: 240, target: 200, unused: 0 });
    expect(
      partTimeCapacity(
        card([{ band: 'FULL_TIME', officers: 100, targetHours: 560, plannedMin: 1, plannedAvg: 560, plannedMax: 600 }]),
      ),
    ).toBeNull();
    expect(partTimeCapacity({} as PlannerScorecard)).toBeNull();
  });
});
