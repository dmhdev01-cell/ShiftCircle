import { describe, expect, it } from 'vitest';

import { axisTicks } from './CoverageChart';

/**
 * V2: the labels used to be spread evenly down the side regardless of value,
 * which made 116/100/98/96/98 read like five evenly-spaced steps and put the
 * "Required (100 %)" line near the bottom with no label to match.
 */
describe('the coverage axis', () => {
  it('places every tick where its value is on a linear scale', () => {
    const ticks = axisTicks(94, 116);

    expect(ticks.map((tick) => tick.value)).toEqual([94, 97, 100, 108, 116]);
    // 100 % is 16 points below the top of a 22-point axis, so 72.7 % of the way
    // down - not a quarter of the way, as the evenly-spread labels said.
    expect(ticks.find((tick) => tick.value === 100)!.top).toBeCloseTo((16 / 22) * 100, 5);
    expect(ticks[0].top).toBe(100);
    expect(ticks[ticks.length - 1].top).toBe(0);

    // A higher value is always nearer the top.
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index].top).toBeLessThan(ticks[index - 1].top);
    }
  });

  it('keeps the bottom, the required line and the top on a narrow axis', () => {
    expect(axisTicks(94, 102).map((tick) => tick.value)).toEqual([94, 100, 102]);
  });
});
