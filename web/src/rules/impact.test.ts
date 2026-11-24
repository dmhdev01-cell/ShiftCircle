import { describe, expect, it } from 'vitest';

import type { Unit } from '../api/types';
import { impactSentence, unitLabel } from './impact';

const units = [
  { id: '1', code: 'A', name: 'Unit A · Living unit' },
  { id: '2', code: 'ESC', name: 'Escort & transport' },
] as Unit[];

describe('impactSentence', () => {
  // Demo §4: the api sent {ruleCode: U-02, unit: A, from: PASS, to: WARN, count: 1},
  // and the checklist read "1 published shifts in A, PASS – WARN, would now break U-02".
  it('reads the demo §4 dry run in plain words', () => {
    expect(
      impactSentence({ ruleCode: 'U-02', unit: 'A', from: 'PASS', to: 'WARN', count: 1 }, units),
    ).toBe('1 officer in Unit A goes from Pass to Warn under U-02');
  });

  it('uses the plural for more than one officer', () => {
    expect(
      impactSentence({ ruleCode: 'U-03', unit: 'C', from: 'PASS', to: 'BLOCK', count: 3 }, units),
    ).toBe('3 officers in Unit C go from Pass to Block under U-03');
  });

  it('says a rule that stops firing in sentence case too', () => {
    expect(
      impactSentence({ ruleCode: 'U-14', unit: 'ESC', from: 'BLOCK', to: 'PASS', count: 2 }, units),
    ).toBe('2 officers in Escort & transport go from Block to Pass under U-14');
    expect(
      impactSentence({ ruleCode: 'P-01', unit: 'A', from: 'INFO', to: 'PASS', count: 1 }, units),
    ).toBe('1 officer in Unit A goes from Info to Pass under P-01');
  });

  it('never shows the raw enum or a dash', () => {
    const text = impactSentence({ ruleCode: 'U-02', unit: 'A', from: 'PASS', to: 'WARN', count: 1 });
    expect(text).not.toMatch(/PASS|WARN|–/);
  });
});

describe('unitLabel', () => {
  it('takes the short name from the units list', () => {
    expect(unitLabel('A', units)).toBe('Unit A');
    expect(unitLabel('ESC', units)).toBe('Escort & transport');
  });

  it('falls back to the code while the list is loading or out of scope', () => {
    expect(unitLabel('B')).toBe('Unit B');
    expect(unitLabel('CTL')).toBe('CTL');
    expect(unitLabel('Unit C · Living unit')).toBe('Unit C');
  });
});
