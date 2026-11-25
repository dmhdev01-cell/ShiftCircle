import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAN_OPTIONS,
  draftDeltaWords,
  draftOptions,
  optionsForRequest,
  planOptionsWords,
  stillShortWords,
} from './planOptions';

describe('plan options', () => {
  it('reads an older draft with no options as made with the defaults', () => {
    expect(draftOptions({})).toEqual(DEFAULT_PLAN_OPTIONS);
    expect(draftOptions(null)).toEqual(DEFAULT_PLAN_OPTIONS);
    // A draft from before crossUnitFill existed reads it as off.
    expect(draftOptions({ options: { staffTypes: ['FULL_TIME'], partTimeFill: 'AFTER_FULL_TIME' } })).toEqual({
      staffTypes: ['FULL_TIME'],
      partTimeFill: 'AFTER_FULL_TIME',
      crossUnitFill: 'OFF',
    });
  });

  it('copies a draft’s options so editing them never changes the draft or the defaults', () => {
    const draft = { options: { ...DEFAULT_PLAN_OPTIONS, staffTypes: [...DEFAULT_PLAN_OPTIONS.staffTypes] } };
    draftOptions(draft).staffTypes.pop();
    draftOptions(null).staffTypes.pop();
    expect(draft.options.staffTypes).toEqual(['FULL_TIME', 'PART_TIME']);
    expect(DEFAULT_PLAN_OPTIONS.staffTypes).toEqual(['FULL_TIME', 'PART_TIME']);
  });

  it('sends part-time fill as before when part-time officers are left out', () => {
    expect(optionsForRequest({ staffTypes: ['FULL_TIME'], partTimeFill: 'UP_TO_FTE', crossUnitFill: 'ON' })).toEqual({
      staffTypes: ['FULL_TIME'],
      partTimeFill: 'AFTER_FULL_TIME',
      crossUnitFill: 'ON',
    });
  });

  it('says what a draft was made with in words', () => {
    expect(planOptionsWords(DEFAULT_PLAN_OPTIONS)).toBe('full-time and part-time officers · part-time fills gaps only');
    expect(
      planOptionsWords({ staffTypes: ['FULL_TIME', 'PART_TIME'], partTimeFill: 'UP_TO_FTE', crossUnitFill: 'OFF' }),
    ).toBe('full-time and part-time officers · part-time filled up to FTE');
    expect(planOptionsWords({ staffTypes: ['FULL_TIME'], partTimeFill: 'AFTER_FULL_TIME', crossUnitFill: 'ON' })).toBe(
      'full-time officers only · gaps covered from other units',
    );
  });

  it('compares a replaced draft figure by figure, saying what did not change', () => {
    expect(
      draftDeltaWords(
        { gaps: 100, warnings: 39, unusedPartTime: 3515, shifts: 5414, coveredFromOtherUnits: 0 },
        { gaps: 72, warnings: 76, unusedPartTime: 3337, shifts: 5455, coveredFromOtherUnits: 28 },
      ),
    ).toBe(
      'Compared with the previous draft: gaps 100 → 72 · rule warnings 39 → 76 · unused part-time hours 3,515 h → 3,337 h · shifts 5,414 → 5,455 · gaps covered from other units 0 → 28.',
    );
    expect(
      draftDeltaWords(
        { gaps: 38, warnings: 7, unusedPartTime: 5472, shifts: 5103, coveredFromOtherUnits: 0 },
        { gaps: 38, warnings: 17, unusedPartTime: 260, shifts: 5667, coveredFromOtherUnits: 0 },
      ),
    ).toBe(
      'Compared with the previous draft: gaps unchanged at 38 · rule warnings 7 → 17 · unused part-time hours 5,472 h → 260 h · shifts 5,103 → 5,667 · gaps covered from other units unchanged at 0.',
    );
  });

  const names: Record<string, string> = { ESC: 'Escort & transport', CTL: 'Control', B: 'Unit B' };
  const unitName = (code: string) => names[code] ?? code;

  it('says why the gaps left after the cross-unit fill are still short (Dataset 150)', () => {
    const words = stillShortWords(
      {
        gapsCovered: 28,
        shifts: 41,
        officers: 26,
        stillShortReasons: { NOT_QUALIFIED: 46, NO_HOURS_LEFT: 14, RULE_BLOCK: 12 },
        stillShortByUnitBlock: { 'ESC EVENING': 16, 'CTL EVENING': 14, 'B EVENING': 11, 'CTL NIGHT': 8 },
      },
      unitName,
    );
    expect(words.zero).toBeNull();
    expect(words.reasons).toBe('Still short: 46 not qualified · 14 no hours left · 12 would break a rule.');
    expect(words.where).toBe('Most are Escort & transport evenings (16), Control evenings (14), Unit B evenings (11).');
  });

  it('says why nothing was covered instead of "0 shifts by 0 officers" (Dataset 120)', () => {
    const words = stillShortWords(
      {
        gapsCovered: 0,
        shifts: 0,
        officers: 0,
        stillShortReasons: { NOT_QUALIFIED: 38 },
        stillShortByUnitBlock: { 'ESC EVENING': 38 },
      },
      unitName,
    );
    expect(words.zero).toBe(
      'No gap could be covered from another unit: no free officer in another unit holds the post’s qualification.',
    );
    expect(words.reasons).toBe('Still short: 38 not qualified.');
    expect(words.where).toBe('Most are Escort & transport evenings (38).');
  });

  it('words a reason it does not know rather than dropping it', () => {
    expect(
      stillShortWords({ gapsCovered: 1, shifts: 1, officers: 1, stillShortReasons: { NO_SHIFT_FITS: 2, NEW_REASON: 1 } }, unitName)
        .reasons,
    ).toBe('Still short: 2 no shift that fits · 1 new reason.');
  });
});
