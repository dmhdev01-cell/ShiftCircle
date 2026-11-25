import { describe, expect, it } from 'vitest';

import { rotationWords } from './rotationWords';

describe('rotation words for the My schedule header', () => {
  it('words the seeded crew, relief and casual codes', () => {
    expect(rotationWords('D12_DAY_4ON4OFF')).toBe('12 h day crew, 4 on, 4 off');
    expect(rotationWords('N12_NIGHT_4ON4OFF')).toBe('12 h night crew, 4 on, 4 off');
    expect(rotationWords('E8_EVENING_5ON2OFF')).toBe('8 h evening crew, 5 on, 2 off');
    expect(rotationWords('N12_NIGHT_RELIEF')).toBe('12 h night relief');
    expect(rotationWords('CASUAL_12')).toBe('12 h relief pool, no fixed rotation');
  });

  it('keeps words as they are and never shows underscores', () => {
    expect(rotationWords('8 h rotation')).toBe('8 h rotation');
    expect(rotationWords('')).toBe('');
    expect(rotationWords(null)).toBe('');
    expect(rotationWords('SOME_NEW_PATTERN')).toBe('Some new pattern');
  });
});
