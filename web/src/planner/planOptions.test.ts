import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAN_OPTIONS, draftOptions, isDefault, optionsForRequest, planOptionsWords } from './planOptions';

describe('plan options', () => {
  it('reads an older draft with no options as made with the defaults', () => {
    expect(draftOptions({})).toEqual(DEFAULT_PLAN_OPTIONS);
    expect(draftOptions(null)).toEqual(DEFAULT_PLAN_OPTIONS);
    expect(isDefault(draftOptions(undefined))).toBe(true);
  });

  it('copies a draft’s options so editing them never changes the draft', () => {
    const draft = { options: { ...DEFAULT_PLAN_OPTIONS, staffTypes: [...DEFAULT_PLAN_OPTIONS.staffTypes] } };
    const copy = draftOptions(draft);
    copy.staffTypes.pop();
    expect(draft.options.staffTypes).toEqual(['FULL_TIME', 'PART_TIME']);
  });

  it('sends part-time fill as before when part-time officers are left out', () => {
    expect(
      optionsForRequest({ staffTypes: ['FULL_TIME'], partTimeFill: 'UP_TO_FTE', preferences: 'OFF' }),
    ).toEqual({ staffTypes: ['FULL_TIME'], partTimeFill: 'AFTER_FULL_TIME', preferences: 'OFF' });
  });

  it('says what a draft was made with in words', () => {
    expect(planOptionsWords(DEFAULT_PLAN_OPTIONS)).toBe(
      'full-time and part-time officers · part-time fills gaps only · time-of-day wishes honoured',
    );
    expect(
      planOptionsWords({ staffTypes: ['FULL_TIME', 'PART_TIME'], partTimeFill: 'UP_TO_FTE', preferences: 'OFF' }),
    ).toBe('full-time and part-time officers · part-time filled up to FTE · time-of-day wishes ignored');
    expect(planOptionsWords({ staffTypes: ['FULL_TIME'], partTimeFill: 'AFTER_FULL_TIME', preferences: 'ON' })).toBe(
      'full-time officers only · time-of-day wishes honoured',
    );
  });
});
