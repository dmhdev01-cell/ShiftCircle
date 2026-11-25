import { describe, expect, it } from 'vitest';

import { unitWords, unitWordsIn } from './unitWords';

describe('unit words', () => {
  it('names the line units and, since release v1.3, the supervisor posts', () => {
    expect(unitWordsIn('ADM coverage gaps')).toBe('Admissions coverage gaps');
    expect(unitWordsIn('SUP-L coverage gaps')).toBe('Supervision · Living units coverage gaps');
    expect(unitWordsIn('SUP-O coverage gaps')).toBe('Supervision · Operations coverage gaps');
    expect(unitWords('C')).toBe('Unit C');
    expect(unitWords('X')).toBe('X');
  });
});
