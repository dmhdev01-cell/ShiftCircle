import { describe, expect, it } from 'vitest';

import { chipTextFor, formatShiftTimes, ruleNameFor, shiftTemplates } from './shiftTemplates';

/**
 * V6 (P3 amendments item 18) adds the 12 h crews the person actually runs:
 * D12 07:00-19:00 and N12 19:00-07:00. A committed 2027 plan is full of them,
 * so every chip and legend has to know them.
 */
describe('the 12 h crew templates', () => {
  it('shows D12 and N12 with their own words and times', () => {
    expect(shiftTemplates.D12.label).toBe('Day 12 h');
    expect(shiftTemplates.N12.label).toBe('Night 12 h');
    expect(chipTextFor('D12')).toBe('D12');
    expect(formatShiftTimes('D12')).toBe('07:00 – 19:00');
    // N12 crosses midnight.
    expect(formatShiftTimes('N12')).toBe('19:00 – 07:00 +1');
  });

  it('keeps every template regular, so a proposal may use it', () => {
    for (const code of ['D12', 'N12']) {
      expect(shiftTemplates[code].regular, code).toBe(true);
    }
  });

  it('names the 8 h officer night-shift warning (U-16)', () => {
    // Release 4 #10: a WARN rule, shown by its plain name in the panel.
    expect(ruleNameFor('U-16')).toBe('8-hour officer on a night shift');
  });

  it('keeps L16 for history though it is retired', () => {
    // Release 5: old rows still render their chip and label; new assignments
    // use the assignable list, which excludes it.
    expect(shiftTemplates.L16.chipText).toBe('L16');
    expect(shiftTemplates.L16.label).toBe('16 h shift');
  });
});
