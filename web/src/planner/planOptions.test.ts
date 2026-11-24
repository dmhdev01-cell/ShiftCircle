import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAN_OPTIONS, draftOptions, optionsForRequest, planOptionsWords } from './planOptions';

describe('plan options', () => {
  it('reads an older draft with no options as made with the defaults', () => {
    expect(draftOptions({})).toEqual(DEFAULT_PLAN_OPTIONS);
    expect(draftOptions(null)).toEqual(DEFAULT_PLAN_OPTIONS);
  });

  it('copies a draft’s options so editing them never changes the draft or the defaults', () => {
    const draft = { options: { ...DEFAULT_PLAN_OPTIONS, staffTypes: [...DEFAULT_PLAN_OPTIONS.staffTypes] } };
    draftOptions(draft).staffTypes.pop();
    draftOptions(null).staffTypes.pop();
    expect(draft.options.staffTypes).toEqual(['FULL_TIME', 'PART_TIME']);
    expect(DEFAULT_PLAN_OPTIONS.staffTypes).toEqual(['FULL_TIME', 'PART_TIME']);
  });

  it('sends part-time fill as before when part-time officers are left out', () => {
    expect(optionsForRequest({ staffTypes: ['FULL_TIME'], partTimeFill: 'UP_TO_FTE' })).toEqual({
      staffTypes: ['FULL_TIME'],
      partTimeFill: 'AFTER_FULL_TIME',
    });
  });

  it('says what a draft was made with in words', () => {
    expect(planOptionsWords(DEFAULT_PLAN_OPTIONS)).toBe('full-time and part-time officers · part-time fills gaps only');
    expect(planOptionsWords({ staffTypes: ['FULL_TIME', 'PART_TIME'], partTimeFill: 'UP_TO_FTE' })).toBe(
      'full-time and part-time officers · part-time filled up to FTE',
    );
    expect(planOptionsWords({ staffTypes: ['FULL_TIME'], partTimeFill: 'AFTER_FULL_TIME' })).toBe(
      'full-time officers only',
    );
  });
});
