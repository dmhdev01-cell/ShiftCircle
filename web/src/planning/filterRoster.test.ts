import { describe, expect, it } from 'vitest';

import { demoSchedule } from '../api/fixtures/schedule';
import type { OfficerRow, ShiftItem } from '../api/types';
import {
  DEFAULT_FILTERS,
  applyRosterFilters,
  blockOfShift,
  filterWords,
  isFiltered,
  parseFilters,
  rotationKind,
  worksBlocks,
  writeFilters,
} from './filterRoster';

function shift(template: string, start: string, end: string, extra: Partial<ShiftItem> = {}): ShiftItem {
  return {
    type: 'SHIFT',
    assignmentId: `${template}-${start}`,
    shiftTemplate: template,
    startAt: start,
    endAt: end,
    kind: 'ROSTERED',
    worked: false,
    version: 0,
    ...extra,
  };
}

function officer(name: string, items: ShiftItem[], extra: Partial<OfficerRow> = {}): OfficerRow {
  return {
    employeeId: name,
    name,
    rotation: '',
    qualifications: [],
    payPeriodHours: 0,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: items.map((item) => ({ date: item.startAt.slice(0, 10), items: [item] })),
    ...extra,
  };
}

const D8 = shift('D8', '2026-11-16T07:00:00-06:00', '2026-11-16T15:00:00-06:00');
const E8 = shift('E8', '2026-11-17T15:00:00-06:00', '2026-11-17T23:00:00-06:00');
const N12 = shift('N12', '2026-11-18T19:00:00-06:00', '2026-11-19T07:00:00-06:00');
const D12 = shift('D12', '2026-11-19T07:00:00-06:00', '2026-11-19T19:00:00-06:00');

describe('A3 roster filters', () => {
  it('leaves the board as it is by default', () => {
    const officers = demoSchedule.officers;
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(applyRosterFilters(officers, DEFAULT_FILTERS)).toEqual(officers);
    expect(parseFilters(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
  });

  it('reads and writes the address, dropping defaults and unknown values', () => {
    const params = writeFilters(new URLSearchParams('unit=unit-b&week=2026-11-16'), {
      ...DEFAULT_FILTERS,
      query: 'nia',
      overtime: 'IN_OVERTIME',
      works: 'N',
      sort: 'hours-asc',
    });
    expect(params.toString()).toBe('unit=unit-b&week=2026-11-16&q=nia&ot=IN_OVERTIME&works=N&sort=hours-asc');
    expect(parseFilters(params)).toEqual({
      ...DEFAULT_FILTERS,
      query: 'nia',
      overtime: 'IN_OVERTIME',
      works: 'N',
      sort: 'hours-asc',
    });
    expect(parseFilters(new URLSearchParams('ot=BOGUS&sort=x&qual=<b>&rot=9h'))).toEqual(DEFAULT_FILTERS);
    expect(writeFilters(params, DEFAULT_FILTERS).toString()).toBe('unit=unit-b&week=2026-11-16');
  });

  it('puts each template in its block by start time', () => {
    expect(blockOfShift(D8)).toBe('D');
    expect(blockOfShift(D12)).toBe('D');
    expect(blockOfShift(E8)).toBe('E');
    expect(blockOfShift(shift('P12', 'x', 'y'))).toBe('E');
    expect(blockOfShift(shift('N8', 'x', 'y'))).toBe('N');
    expect(blockOfShift(N12)).toBe('N');
    expect(blockOfShift(shift('A12', 'x', 'y'))).toBe('N');
    expect(blockOfShift(shift('ZZ', 'x', 'y'))).toBeNull();
  });

  it('counts only rostered and extra shifts toward "works"', () => {
    const row = officer('A', [D8, { ...E8, offer: true }, { ...N12, proposed: true }]);
    expect([...worksBlocks(row)]).toEqual(['D']);
  });

  it('reads the rotation from its text, else from the shifts on screen', () => {
    expect(rotationKind(officer('A', [], { rotation: '8 h · Control' }))).toBe('8h');
    expect(rotationKind(officer('A', [D8], { rotation: '12 h · 2 × 00–12' }))).toBe('12h');
    expect(rotationKind(officer('A', [D8], { rotation: '8 h casual' }))).toBe('casual');
    expect(rotationKind(officer('A', [D8, E8]))).toBe('8h');
    expect(rotationKind(officer('A', [N12, D12, D8]))).toBe('12h');
    expect(rotationKind(officer('A', []))).toBeNull();
  });

  it('filters by name, overtime, rotation, works and qualification together', () => {
    const rows = [
      officer('Nia Thompson', [N12, D12], { overtimeStatus: 'IN_OVERTIME', qualifications: ['ESCORT'] }),
      officer('Omar Nyberg', [D8], { rotation: '8 h casual', overtimeStatus: 'UNDER' }),
      officer('Greta Iqbal', [D8, E8], { overtimeStatus: 'APPROACHING', qualifications: ['FIRST_AID'] }),
    ];
    const names = (filters: Partial<typeof DEFAULT_FILTERS>) =>
      applyRosterFilters(rows, { ...DEFAULT_FILTERS, ...filters }).map((row) => row.name);

    expect(names({ query: '  NIA ' })).toEqual(['Nia Thompson']);
    expect(names({ overtime: 'APPROACHING' })).toEqual(['Greta Iqbal']);
    expect(names({ rotation: '12h' })).toEqual(['Nia Thompson']);
    expect(names({ rotation: 'casual' })).toEqual(['Omar Nyberg']);
    expect(names({ rotation: '8h' })).toEqual(['Greta Iqbal']);
    expect(names({ works: 'D' })).toEqual(['Nia Thompson', 'Omar Nyberg', 'Greta Iqbal']);
    expect(names({ works: 'E' })).toEqual(['Greta Iqbal']);
    expect(names({ works: 'N' })).toEqual(['Nia Thompson']);
    expect(names({ qualification: 'FIRST_AID' })).toEqual(['Greta Iqbal']);
    expect(names({ works: 'D', overtime: 'UNDER' })).toEqual(['Omar Nyberg']);
    expect(names({ query: 'zzz' })).toEqual([]);
  });

  it('sorts by hours either way, by name and by rotation, ties by name', () => {
    const rows = [
      officer('Cara', [D8], { payPeriodHours: 80 }),
      officer('Abe', [N12, D12], { payPeriodHours: 40 }),
      officer('Bea', [D8], { payPeriodHours: 40, rotation: 'casual' }),
    ];
    const order = (sort: typeof DEFAULT_FILTERS.sort) =>
      applyRosterFilters(rows, { ...DEFAULT_FILTERS, sort }).map((row) => row.name);
    expect(order('board')).toEqual(['Cara', 'Abe', 'Bea']);
    expect(order('hours-asc')).toEqual(['Abe', 'Bea', 'Cara']);
    expect(order('hours-desc')).toEqual(['Cara', 'Abe', 'Bea']);
    expect(order('name')).toEqual(['Abe', 'Bea', 'Cara']);
    expect(order('rotation')).toEqual(['Cara', 'Abe', 'Bea']);
    // The input is never reordered in place.
    expect(rows.map((row) => row.name)).toEqual(['Cara', 'Abe', 'Bea']);
  });

  it('says which filters are on', () => {
    expect(
      filterWords(
        { ...DEFAULT_FILTERS, query: 'ni', overtime: 'UNDER', rotation: '12h', works: 'N', qualification: 'ESCORT' },
        (code) => code.toLowerCase(),
      ),
    ).toBe('name has "ni", under, 12 h rotation, works nights, escort');
  });
});
