import { describe, expect, it } from 'vitest';

import type { OfficerRow, ShiftItem } from '../api/types';
import { shiftChipStyles, colour, focusRing } from '../theme/tokens';
import {
  dayTotals,
  isIsoDate,
  isWeekend,
  monthOf,
  officerTotals,
  parseDensity,
  parseView,
  payPeriodOf,
  rangeFor,
  rangeWords,
  stepFocus,
} from './rosterView';

function shift(date: string, start: string, end: string, extra: Partial<ShiftItem> = {}): ShiftItem {
  return {
    type: 'SHIFT',
    assignmentId: `${date}-${start}`,
    shiftTemplate: 'D8',
    startAt: `${date}T${start}:00-06:00`,
    endAt: end,
    kind: 'ROSTERED',
    worked: false,
    version: 0,
    ...extra,
  };
}

function officer(cells: OfficerRow['cells']): OfficerRow {
  return {
    employeeId: 'e1',
    name: 'Test Officer',
    rotation: '',
    qualifications: [],
    payPeriodHours: 0,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells,
  };
}

describe('the board view (A1)', () => {
  it('reads ?view= and keeps the week as the default', () => {
    expect(parseView(null)).toBe('week');
    expect(parseView('nonsense')).toBe('week');
    expect(parseView('period')).toBe('period');
    expect(parseView('month')).toBe('month');
  });

  it('is comfortable for a week and compact for a longer span, unless the address says', () => {
    expect(parseDensity(null, 'week')).toBe('comfortable');
    expect(parseDensity(null, 'period')).toBe('compact');
    expect(parseDensity('comfortable', 'month')).toBe('comfortable');
    expect(parseDensity('compact', 'week')).toBe('compact');
  });

  it('finds the 14-day pay periods the datasets seed', () => {
    expect(payPeriodOf('2026-11-16')).toEqual({ from: '2026-11-09', to: '2026-11-22' });
    expect(payPeriodOf('2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-22' });
    expect(payPeriodOf('2026-11-08')).toEqual({ from: '2026-10-26', to: '2026-11-08' });
    // The planner's first 2027 period, and a date before the anchor.
    expect(payPeriodOf('2027-01-06')).toEqual({ from: '2027-01-04', to: '2027-01-17' });
    expect(payPeriodOf('2026-10-01')).toEqual({ from: '2026-09-28', to: '2026-10-11' });
  });

  it('gives each view its range around the focus week, a month at most 31 days', () => {
    expect(rangeFor('week', '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(rangeFor('period', '2026-11-16')).toEqual({ from: '2026-11-09', to: '2026-11-22' });
    expect(rangeFor('month', '2026-11-16')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthOf('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthOf('2027-02-10')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('steps by a week, a pay period or a month', () => {
    expect(stepFocus('week', '2026-11-16', -1)).toBe('2026-11-09');
    expect(stepFocus('period', '2026-11-16', 1)).toBe('2026-11-23');
    expect(stepFocus('period', '2026-11-16', -1)).toBe('2026-10-26');
    // A month steps to the first Monday on or after the 1st.
    expect(stepFocus('month', '2026-11-16', 1)).toBe('2026-12-07');
    expect(rangeFor('month', stepFocus('month', '2026-11-16', 1)).from).toBe('2026-12-01');
    expect(stepFocus('month', '2026-11-16', -1)).toBe('2026-10-05');
    expect(stepFocus('month', '2026-12-07', 1)).toBe('2027-01-04');
    expect(stepFocus('month', '2027-01-04', -1)).toBe('2026-12-07');
  });

  it('says the range in the board\'s words', () => {
    expect(rangeWords('2026-11-16', '2026-11-22')).toBe('16 – 22 Nov 2026');
    expect(rangeWords('2026-10-26', '2026-11-08')).toBe('26 Oct – 8 Nov 2026');
    expect(rangeWords('2026-12-21', '2027-01-03')).toBe('21 Dec 2026 – 3 Jan 2027');
  });

  it('knows the weekend', () => {
    expect(isWeekend('2026-11-21')).toBe(true);
    expect(isWeekend('2026-11-22')).toBe(true);
    expect(isWeekend('2026-11-20')).toBe(false);
  });
});

describe('the roster totals (A1)', () => {
  const row = officer([
    { date: '2026-11-20', items: [shift('2026-11-20', '12:00', '2026-11-21T00:00:00-06:00')] },
    {
      date: '2026-11-21',
      items: [
        shift('2026-11-21', '07:00', '2026-11-21T15:00:00-06:00', { kind: 'EXTRA' }),
        // An unanswered offer and a blocked proposal are not worked hours.
        shift('2026-11-21', '15:00', '2026-11-21T23:00:00-06:00', { offer: true }),
        shift('2026-11-21', '23:00', '2026-11-22T07:00:00-06:00', { proposed: true }),
      ],
    },
    { date: '2026-11-22', items: [{ type: 'ABSENCE', absenceType: 'SICK' }] },
  ]);

  it('counts an officer\'s shifts and hours in the view', () => {
    expect(officerTotals(row)).toEqual({ shifts: 2, hours: 20 });
  });

  it('counts each day\'s officers on duty and hours', () => {
    const other = officer([{ date: '2026-11-21', items: [shift('2026-11-21', '19:00', '2026-11-22T07:00:00-06:00')] }]);
    expect(dayTotals([row, other], '2026-11-21')).toEqual({ onDuty: 2, hours: 20 });
    expect(dayTotals([row, other], '2026-11-22')).toEqual({ onDuty: 0, hours: 0 });
  });
});

describe('the colour fixes (A4)', () => {
  it('tells the day and night 12 h crews apart', () => {
    expect(shiftChipStyles.D12).toBeDefined();
    expect(shiftChipStyles.N12).toBeDefined();
    expect(shiftChipStyles.N12.bg).not.toBe(shiftChipStyles.D12.bg);
    expect(shiftChipStyles.D12.bg).not.toBe(shiftChipStyles.D8.bg);
    expect(shiftChipStyles.N12.text).toBe('#FFFFFF');
  });

  it('shows In overtime in the overtime tone, not the pass green', () => {
    expect(colour.status.ot.bg).not.toBe(colour.status.pass.bg);
    expect(colour.status.ot.text).toBe('#8A2C00');
  });
});

describe('the ?week= guard', () => {
  it('accepts only a real calendar day', () => {
    expect(isIsoDate('2026-11-16')).toBe(true);
    expect(isIsoDate('foo')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-11-16T00:00')).toBe(false);
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the focus ring (WCAG 1.4.11)', () => {
  it('has 3:1 on white and on the selected blue', () => {
    expect(contrast(focusRing.onLight, colour.bg.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(focusRing.onDark, colour.brand.link)).toBeGreaterThanOrEqual(3);
  });
});
