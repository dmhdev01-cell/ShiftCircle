import type { DemoUser, DisplayBlock, DisplayPost, DisplayToday, DisplayUnit } from '../types';
import { demoSchedule } from './schedule';

/**
 * Fixture for `GET /display/today` (docs/07 §4.8), in the api's exact shape.
 * Counts only. Unit C's evening block is short one officer from 19:00 to 23:00,
 * so the "short" state can be seen and tested.
 */

function block(
  name: DisplayBlock['block'],
  required: number,
  lowest: number,
  shortHours: DisplayBlock['scheduled']['shortHours'] = [],
): DisplayBlock {
  return {
    block: name,
    required,
    scheduled: { lowestHourly: lowest, shortHours, maxHourly: Math.max(lowest, required) },
    actual: null,
    covered: shortHours.length === 0,
  };
}

interface FixtureUnit {
  code: string;
  display: DisplayUnit;
}

const FIXTURE_UNITS: FixtureUnit[] = [
  {
    code: 'A',
    display: {
      unit: { id: 'u-fixture-a', name: 'Unit A · Living unit' },
      coverage: [block('DAY', 5, 5), block('EVENING', 4, 4), block('NIGHT', 3, 3)],
      openShifts: 0,
      officersInOvertime: 1,
    },
  },
  {
    code: 'B',
    display: {
      unit: { id: demoSchedule.unit.id, name: demoSchedule.unit.name },
      coverage: [block('DAY', 5, 5), block('EVENING', 4, 4), block('NIGHT', 3, 3)],
      openShifts: 1,
      officersInOvertime: 2,
    },
  },
  {
    code: 'C',
    display: {
      unit: { id: 'u-fixture-c', name: 'Unit C · Living unit' },
      coverage: [
        block('DAY', 4, 4),
        block('EVENING', 4, 3, [{ from: '19:00', to: '23:00', count: 3 }]),
        block('NIGHT', 3, 3),
      ],
      openShifts: 1,
      officersInOvertime: 0,
    },
  },
  {
    code: 'ADM',
    display: {
      unit: { id: 'u-fixture-adm', name: 'Admissions' },
      coverage: [block('DAY', 3, 3), block('EVENING', 2, 2), block('NIGHT', 1, 1)],
      openShifts: 0,
      officersInOvertime: 0,
    },
  },
  {
    code: 'CTL',
    display: {
      unit: { id: 'u-fixture-ctl', name: 'Control' },
      coverage: [block('DAY', 3, 3), block('EVENING', 3, 3), block('NIGHT', 2, 2)],
      openShifts: 0,
      officersInOvertime: 1,
    },
  },
  {
    code: 'ESC',
    display: {
      unit: { id: 'u-fixture-esc', name: 'Escort & transport' },
      coverage: [block('DAY', 6, 7), block('EVENING', 2, 2), block('NIGHT', 0, 0)],
      openShifts: 0,
      officersInOvertime: 0,
    },
  },
];

/** The two supervisor posts (release v1.3 S7): one supervisor per block, 24/7. */
const FIXTURE_POSTS: { code: string; display: DisplayPost }[] = [
  {
    code: 'SUP-L',
    display: {
      post: { id: 'u-fixture-sup-l', name: 'Supervision · Living units' },
      area: 'Living units',
      coverage: [block('DAY', 1, 1), block('EVENING', 1, 1), block('NIGHT', 1, 1)],
      openShifts: 0,
    },
  },
  {
    code: 'SUP-O',
    display: {
      post: { id: 'u-fixture-sup-o', name: 'Supervision · Operations' },
      area: 'Operations',
      coverage: [block('DAY', 1, 1), block('EVENING', 1, 1), block('NIGHT', 1, 1)],
      openShifts: 0,
    },
  },
];

/** Like the api: the display device and the auditor see every unit; a supervisor sees their own. */
export function demoDisplayToday(user: DemoUser | null): DisplayToday {
  const facilityWide =
    !user || user.roles.includes('DISPLAY') || user.roles.includes('AUDITOR');
  const units = FIXTURE_UNITS.filter(
    (entry) => facilityWide || user.units.includes(entry.code),
  ).map((entry) => entry.display);
  return {
    asOf: '2026-11-19',
    generatedAt: new Date().toISOString(),
    units,
    totalOpenShifts: units.reduce((sum, entry) => sum + entry.openShifts, 0),
    totalOfficersInOvertime: units.reduce((sum, entry) => sum + entry.officersInOvertime, 0),
    posts: FIXTURE_POSTS.filter((entry) => facilityWide || user.units.includes(entry.code)).map(
      (entry) => entry.display,
    ),
  };
}
