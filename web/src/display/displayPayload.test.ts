import { describe, expect, it } from 'vitest';

import { toDisplayToday } from './displayPayload';

/**
 * The wall's payload mapper whitelists fields (the display endpoint is the one
 * hostile-payload-tolerant reader). Release 3 added closedToday/closedNote; a
 * gate run on a0d4f6f found the mapper dropped them, so a closed unit rendered
 * as if it were open.
 */
describe('the wall display payload mapper', () => {
  const raw = {
    asOf: '2026-11-19',
    generatedAt: '2026-11-19T20:32:00Z',
    totalOpenShifts: 0,
    totalOfficersInOvertime: 0,
    units: [
      {
        unit: { id: 'unit-b', name: 'Unit B · Living unit' },
        coverage: [],
        openShifts: 0,
        officersInOvertime: 0,
        closedToday: true,
        closedNote: 'No reopening date is set.',
      },
      {
        unit: { id: 'unit-a', name: 'Unit A · Living unit' },
        coverage: [],
        openShifts: 0,
        officersInOvertime: 0,
        closedToday: false,
        closedNote: null,
      },
    ],
  };

  it('keeps closedToday and closedNote from the api payload', () => {
    const mapped = toDisplayToday(raw);
    expect(mapped.units[0].closedToday).toBe(true);
    expect(mapped.units[0].closedNote).toBe('No reopening date is set.');
    expect(mapped.units[1].closedToday).toBe(false);
    expect(mapped.units[1].closedNote).toBeNull();
  });

  it('treats a missing closedNote as null and a non-true flag as open', () => {
    const mapped = toDisplayToday({
      ...raw,
      units: [
        {
          unit: { id: 'unit-c', name: 'Unit C · Living unit' },
          coverage: [],
          openShifts: 0,
          officersInOvertime: 0,
        },
      ],
    });
    expect(mapped.units[0].closedToday).toBe(false);
    expect(mapped.units[0].closedNote).toBeNull();
  });
});
