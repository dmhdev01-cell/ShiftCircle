import { describe, expect, it } from 'vitest';

import type { BlockCoverage, CellItem, OfficerRow, SchedulePayload, ShiftItem } from '../api/types';
import { shift as fixtureShift } from '../api/fixtures/schedule';
import { gapCandidates, hintsFor, isFillable } from './gapFill';

const DAYS = [
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
];
const GAP_DAY = '2026-11-21';

function shift(code: string, date: string): ShiftItem {
  return fixtureShift(`${code}-${date}`, code, date);
}

function officer(
  name: string,
  hours: number,
  byDate: Record<string, CellItem[]>,
  overtimeStatus: OfficerRow['overtimeStatus'] = 'UNDER',
): OfficerRow {
  return {
    employeeId: name.toLowerCase().replace(/\s/g, '-'),
    name,
    rotation: '8 h rotation',
    qualifications: [],
    payPeriodHours: hours,
    payPeriodThreshold: 80,
    overtimeStatus,
    cells: DAYS.map((date) => ({ date, items: byDate[date] ?? [] })),
  };
}

function gap(overrides: Partial<BlockCoverage> = {}): BlockCoverage {
  return {
    block: 'DAY',
    date: GAP_DAY,
    required: 5,
    scheduled: { lowestHourly: 3, shortHours: [{ from: '07:00', to: '15:00', count: 3 }], maxHourly: 3 },
    covered: false,
    ...overrides,
  };
}

function payload(officers: OfficerRow[]): SchedulePayload {
  return {
    unit: { id: 'unit-b', name: 'Unit B · Living unit' },
    from: DAYS[0],
    to: DAYS[6],
    days: DAYS,
    asOf: '2026-11-19',
    coverage: [gap()],
    officers,
    warnings: 0,
    overridesThisPeriod: 0,
    publishedState: { published: true, unpublishedChanges: null },
  } as unknown as SchedulePayload;
}

describe('A2 gap fill: who is free and the hints', () => {
  it('lists only officers with nothing that day, lowest pay-period hours first', () => {
    const list = gapCandidates(
      payload([
        officer('Busy Bee', 10, { [GAP_DAY]: [shift('D8', GAP_DAY)] }),
        officer('On Leave', 12, { [GAP_DAY]: [{ type: 'ABSENCE', absenceType: 'VACATION' }] }),
        officer('Zed High', 88, {}, 'IN_OVERTIME'),
        officer('Amy Low', 24, {}),
        officer('Bob Low', 24, {}),
        officer('Mid Way', 76, {}, 'APPROACHING'),
      ]),
      gap(),
      'D8',
    );
    expect(list.map((entry) => entry.officer.name)).toEqual(['Amy Low', 'Bob Low', 'Mid Way', 'Zed High']);
    expect(list.map((entry) => entry.status)).toEqual(['under', 'under', 'near', 'ot']);
    expect(list[0].hints).toEqual([]);
  });

  // M1: rest is a neutral fact measured to the chosen start; the rule check
  // gives the verdict (U-01 passes at exactly its 8 h floor, PC-02).
  const restText = (prev: string, template: string) =>
    hintsFor(officer('Rested', 40, { '2026-11-20': [shift(prev, '2026-11-20')] }), GAP_DAY, template, DAYS)
      .map((hint) => hint.text)
      .filter((text) => /rest|overlaps/.test(text));

  it('gives the hours of rest before the chosen start, with no verdict', () => {
    // P12 ends Sat 00:00; D8 starts Sat 07:00.
    expect(restText('P12', 'D8')).toEqual(['7 h rest after a shift ending Sat 00:00']);
    // N8 ends Sat 07:00; E8 starts Sat 15:00: exactly 8 h.
    expect(restText('N8', 'E8')).toEqual(['8 h rest after a shift ending Sat 07:00']);
    // N8 ends Sat 07:00; P12 starts Sat 12:00: 5 h.
    expect(restText('N8', 'P12')).toEqual(['5 h rest after a shift ending Sat 07:00']);
    // N8 ends Sat 07:00; D8 starts Sat 07:00: back to back.
    expect(restText('N8', 'D8')).toEqual(['0 h rest after a shift ending Sat 07:00']);
    // N8 ends Sat 07:00; A12 starts Sat 00:00: the shifts overlap.
    expect(restText('N8', 'A12')).toEqual(['overlaps a shift ending Sat 07:00']);
    // D8 ends Fri 15:00; D8 starts Sat 07:00: 16 h, nothing to say.
    expect(restText('D8', 'D8')).toEqual([]);
    for (const text of [...restText('P12', 'D8'), ...restText('N8', 'E8')]) {
      expect(text).not.toMatch(/Block/);
    }
  });

  it('says when the board starts on the gap day, so earlier shifts are not visible', () => {
    const hints = hintsFor(officer('First', 40, {}), DAYS[0], 'D8', DAYS);
    expect(hints.map((hint) => hint.text)).toEqual([
      'the board starts this day: the rule check also sees earlier shifts',
    ]);
  });

  it('ranks with the gap period\'s own hours when they are given (a month view)', () => {
    const list = gapCandidates(
      payload([officer('Was Low', 10, {}), officer('Was High', 90, {}, 'IN_OVERTIME'), officer('Absent', 50, {})]),
      gap(),
      'D8',
      new Map([
        ['was-low', { payPeriodHours: 84, overtimeStatus: 'IN_OVERTIME' as const, payPeriodThreshold: 80 }],
        ['was-high', { payPeriodHours: 16, overtimeStatus: 'UNDER' as const, payPeriodThreshold: 80 }],
      ]),
    );
    expect(list.map((entry) => [entry.officer.name, entry.officer.payPeriodHours, entry.status])).toEqual([
      ['Absent', 0, 'under'],
      ['Was High', 16, 'under'],
      ['Was Low', 84, 'ot'],
    ]);
    expect(list[1].hints).toEqual([]);
    expect(list[2].hints.map((hint) => hint.text)).toContain('in overtime: this shift is paid at OT');
  });

  it('counts the run of work days the shift would make, as far as the board shows', () => {
    const run: Record<string, CellItem[]> = {};
    for (const date of DAYS.slice(0, 5)) run[date] = [shift('E8', date)];
    const hints = hintsFor(officer('Steady', 40, run), GAP_DAY, 'D8', DAYS);
    // Mon to Fri on the board, the run may start earlier: "at least".
    expect(hints.map((hint) => hint.text)).toContain('would make at least 6 work days in a row');

    run['2026-11-16'] = [];
    run['2026-11-22'] = [shift('E8', '2026-11-22')];
    expect(hintsFor(officer('Steady', 40, run), GAP_DAY, 'D8', DAYS).map((hint) => hint.text)).toContain(
      'would make 6 work days in a row',
    );
  });

  it('names overtime: already in it, or taken over the threshold by this shift', () => {
    expect(hintsFor(officer('Over', 88, {}, 'IN_OVERTIME'), GAP_DAY, 'D8', DAYS)[0].text).toBe(
      'in overtime: this shift is paid at OT',
    );
    expect(hintsFor(officer('Near', 76, {}, 'APPROACHING'), GAP_DAY, 'D8', DAYS)[0].text).toBe(
      'this shift takes them over 80 h: paid at OT',
    );
    expect(hintsFor(officer('Near', 72, {}, 'APPROACHING'), GAP_DAY, 'D8', DAYS)).toEqual([]);
    expect(hintsFor(officer('Near', 72, {}, 'APPROACHING'), GAP_DAY, 'D12', DAYS)[0].text).toBe(
      'this shift takes them over 80 h: paid at OT',
    );
  });

  it('offers to fill only short blocks today or later', () => {
    expect(isFillable(gap(), '2026-11-19')).toBe(true);
    expect(isFillable(gap(), '2026-11-21')).toBe(true);
    expect(isFillable(gap(), '2026-11-22')).toBe(false);
    expect(
      isFillable(
        gap({ covered: true, scheduled: { lowestHourly: 5, shortHours: [], maxHourly: 5 } }),
        '2026-11-19',
      ),
    ).toBe(false);
  });
});
