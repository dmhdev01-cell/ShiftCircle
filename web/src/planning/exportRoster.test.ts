import { describe, expect, it } from 'vitest';

import { demoSchedule } from '../api/fixtures/schedule';
import type { SchedulePayload } from '../api/types';
import { cellWords, dayHeading, exportFileName, guardFormula, rosterRows, toCsv, toTsv } from './exportRoster';

describe('A3 roster export', () => {
  it('guards every formula-looking cell with an apostrophe', () => {
    for (const value of ['=SUM(A1)', '+1', '-2+3', '@cmd', '\t=1', '\r=1']) {
      expect(guardFormula(value)).toBe(`'${value}`);
    }
    for (const value of ['Nia Thompson', '72', 'D8 extra', '4 of 5', '']) {
      expect(guardFormula(value)).toBe(value);
    }
  });

  it('writes CSV for Excel: BOM, CRLF, quoting and the formula guard', () => {
    const csv = toCsv([
      ['Officer', 'Note'],
      ['=HYPERLINK("http://x")', 'a, b'],
      ['O"Brien', 'line\nbreak'],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1)).toBe(
      'Officer,Note\r\n' + `"'=HYPERLINK(""http://x"")","a, b"\r\n` + '"O""Brien","line\nbreak"\r\n',
    );
  });

  it('writes TSV for the clipboard without breaking the grid', () => {
    expect(toTsv([['a\tb', '@x'], ['c\nd', '-1']])).toBe("a b\t'@x\nc d\t'-1");
  });

  it('builds the roster rows from what is on screen', () => {
    const rows = rosterRows(demoSchedule, demoSchedule.officers.slice(0, 2));
    const days = demoSchedule.days.length;
    expect(rows[0].slice(0, 7)).toEqual([
      'Officer',
      'Rotation',
      'Qualifications',
      'Shifts in view',
      'Hours in view',
      'Pay-period hours',
      'Overtime status',
    ]);
    expect(rows[0][7]).toBe('Mon 16 Nov');
    rows.forEach((row) => expect(row).toHaveLength(7 + days));
    // Header, three coverage rows, two officers, two total rows.
    expect(rows).toHaveLength(1 + 3 + 2 + 2);
    expect(rows[1][0]).toMatch(/^Days coverage/);
    // Coverage is "n of m", never "n/m", which Excel would read as a date.
    rows.slice(1, 4).forEach((row) => row.slice(7).forEach((value) => expect(value).toMatch(/^(\d+ of \d+)?$/)));
    expect(rows[4][0]).toBe('Tara Nakamura');
    expect(rows[4][2]).toBe('Control');
    expect(rows[4][7]).toBe('A12');
    expect(rows[6][0]).toBe('On duty');
    expect(rows[7][0]).toBe('Hours on duty');
  });

  it('marks extra shifts, offers, proposals and absences in a cell', () => {
    expect(cellWords([])).toBe('');
    expect(
      cellWords([
        {
          type: 'SHIFT',
          assignmentId: 'a',
          shiftTemplate: 'D8',
          startAt: '',
          endAt: '',
          kind: 'EXTRA',
          worked: false,
          version: 0,
          offer: true,
        },
        { type: 'ABSENCE', absenceType: 'SICK' },
      ]),
    ).toBe('D8 extra offer / Sick');
    expect(dayHeading('2026-11-22')).toBe('Sun 22 Nov');
  });

  it('names the file after the unit and the range', () => {
    const payload = { ...demoSchedule, unit: { ...demoSchedule.unit, name: 'Unit B · Living unit' } } as SchedulePayload;
    expect(exportFileName(payload, false)).toBe('roster-unit-b-living-unit-2026-11-16-to-2026-11-22.csv');
    expect(exportFileName(payload, true)).toBe('roster-unit-b-living-unit-2026-11-16-to-2026-11-22-filtered.csv');
  });
});
