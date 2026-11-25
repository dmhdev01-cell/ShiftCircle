import { describe, expect, it } from 'vitest';

import type { OpenShift } from '../api/types';
import { orderOpenShifts } from './openShiftOrder';

function shift(id: string, date: string, status: OpenShift['status']): OpenShift {
  return { id, date, status } as OpenShift;
}

describe('the open-shift order', () => {
  const shifts = [shift('sat', '2026-11-21', 'FILLED'), shift('fri', '2026-11-20', 'OPEN')];

  it('puts a filled shift behind the current needs', () => {
    const { current, others } = orderOpenShifts(shifts, '2026-11-19');
    expect(current.map((entry) => entry.id)).toEqual(['fri']);
    expect(others.map((entry) => entry.id)).toEqual(['sat']);
  });

  it('keeps a shift just confirmed in its place, now filled (v1.2 walk D5)', () => {
    const { current, others } = orderOpenShifts(shifts, '2026-11-19', 'sat');
    expect(current.map((entry) => entry.id)).toEqual(['fri', 'sat']);
    expect(others).toEqual([]);
  });
});
