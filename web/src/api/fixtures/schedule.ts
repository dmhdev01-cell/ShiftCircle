/**
 * Demo data for the planning board.
 *
 * Unit B, the week of 16 - 22 Nov 2026, "today" 19 Nov 2026 - the window the
 * UI mockup shows, with the corrections from docs/ui/build-notes.md §1:
 * ADR-015 shift codes (A12 / P12 / L16), Unit B at 5 / 5 / 4 per
 * docs/10-testing.md §6.2, hourly coverage with the lowest count and the
 * short hours (ADR-017), and the PC-01 case for the rule check.
 *
 * This is a typed fixture, not the generator's output. When the demo data
 * generator exists it replaces this file and the screens do not change.
 */

import { shiftTemplates } from '../shiftTemplates';
import type {
  AbsenceItem,
  BlockCoverage,
  CellItem,
  DayCell,
  OfficerRow,
  SchedulePayload,
  ShiftItem,
} from '../types';

export const DEMO_TODAY = '2026-11-19';
export const DEMO_UNIT = { id: 'unit-b', name: 'Unit B · Living unit' };

const TZ = '-06:00';

function nextDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

interface ShiftOptions {
  kind?: 'ROSTERED' | 'EXTRA';
  worked?: boolean;
  offer?: boolean;
  proposed?: boolean;
}

/** A rostered shift on the given start date. */
export function shift(
  assignmentId: string,
  templateCode: string,
  date: string,
  options: ShiftOptions = {},
): ShiftItem {
  const template = shiftTemplates[templateCode];
  const endsNextDay = template.endsNextDay || template.end === '24:00';
  const endDate = endsNextDay ? nextDate(date) : date;
  const endTime = template.end === '24:00' ? '00:00' : template.end;

  return {
    type: 'SHIFT',
    assignmentId,
    shiftTemplate: templateCode,
    startAt: `${date}T${template.start}:00${TZ}`,
    endAt: `${endDate}T${endTime}:00${TZ}`,
    kind: options.kind ?? 'ROSTERED',
    worked: options.worked ?? date < DEMO_TODAY,
    ...(options.offer ? { offer: true } : {}),
    ...(options.proposed ? { proposed: true } : {}),
  };
}

function absence(absenceType: AbsenceItem['absenceType']): AbsenceItem {
  return { type: 'ABSENCE', absenceType };
}

function cell(date: string, ...items: CellItem[]): DayCell {
  return { date, items };
}

const WEEK = [
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
];

const OFF: CellItem[] = [];

/** The hours of each shift template. */
const SHIFT_HOURS: Record<string, number> = {
  D8: 8,
  E8: 8,
  N8: 8,
  A12: 12,
  P12: 12,
  L16: 16,
};

/** The pay period's overtime threshold (ADR-016). */
const OVERTIME_THRESHOLD = 80;

const rawOfficers: OfficerRow[] = [
  {
    employeeId: 'emp-tara',
    name: 'Tara Nakamura',
    rotation: '12 h · 2 × 00–12, 2 × 12–24, 4 off · Control',
    qualifications: ['CONTROL'],
    payPeriodHours: 72,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: [
      cell('2026-11-16', shift('a-tara-16', 'A12', '2026-11-16')),
      cell('2026-11-17', shift('a-tara-17', 'A12', '2026-11-17')),
      cell('2026-11-18', shift('a-tara-18', 'P12', '2026-11-18')),
      cell('2026-11-19', shift('a-tara-19', 'P12', '2026-11-19')),
      cell('2026-11-20', ...OFF),
      cell('2026-11-21', ...OFF),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-ruth',
    name: 'Ruth Okafor',
    rotation: '12 h · 2 × 00–12, 2 × 12–24, 4 off · Escort',
    qualifications: ['ESCORT'],
    payPeriodHours: 84,
    payPeriodThreshold: 80,
    overtimeStatus: 'IN_OVERTIME',
    cells: [
      cell('2026-11-16', ...OFF),
      cell('2026-11-17', ...OFF),
      cell('2026-11-18', shift('a-ruth-18', 'A12', '2026-11-18')),
      cell('2026-11-19', shift('a-ruth-19', 'A12', '2026-11-19')),
      cell('2026-11-20', shift('a-ruth-20', 'P12', '2026-11-20')),
      cell('2026-11-21', shift('a-ruth-21', 'P12', '2026-11-21')),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-marc',
    name: 'Marc Desjardins',
    rotation: '8 h · Control, First aid',
    qualifications: ['CONTROL', 'FIRST_AID'],
    payPeriodHours: 64,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: [
      cell('2026-11-16', shift('a-marc-16', 'D8', '2026-11-16')),
      cell('2026-11-17', shift('a-marc-17', 'D8', '2026-11-17')),
      cell('2026-11-18', absence('SICK')),
      cell('2026-11-19', shift('a-marc-19', 'D8', '2026-11-19')),
      cell('2026-11-20', shift('a-marc-20', 'D8', '2026-11-20')),
      cell('2026-11-21', ...OFF),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-kari',
    name: 'Kari Lindqvist',
    rotation: '8 h · First aid',
    qualifications: ['FIRST_AID'],
    payPeriodHours: 78,
    payPeriodThreshold: 80,
    overtimeStatus: 'APPROACHING',
    cells: [
      cell('2026-11-16', shift('a-kari-16', 'E8', '2026-11-16')),
      cell('2026-11-17', shift('a-kari-17', 'E8', '2026-11-17')),
      // A double: a rostered shift plus an extra shift back to back.
      cell('2026-11-18', shift('a-kari-18', 'D8', '2026-11-18'), shift('a-kari-18x', 'E8', '2026-11-18', { kind: 'EXTRA' })),
      cell('2026-11-19', ...OFF),
      cell('2026-11-20', shift('a-kari-20', 'E8', '2026-11-20')),
      cell('2026-11-21', shift('a-kari-21', 'E8', '2026-11-21')),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-sam',
    name: 'Sam Abara',
    rotation: '8 h · Escort',
    qualifications: ['ESCORT'],
    payPeriodHours: 72,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: [
      cell('2026-11-16', shift('a-sam-16', 'N8', '2026-11-16')),
      cell('2026-11-17', shift('a-sam-17', 'N8', '2026-11-17')),
      cell('2026-11-18', shift('a-sam-18', 'N8', '2026-11-18')),
      cell('2026-11-19', shift('a-sam-19', 'N8', '2026-11-19')),
      cell('2026-11-20', ...OFF),
      cell('2026-11-21', ...OFF),
      cell('2026-11-22', shift('a-sam-22', 'N8', '2026-11-22')),
    ],
  },
  {
    employeeId: 'emp-piotr',
    name: 'Piotr Kowalczyk',
    rotation: '12 h · 2 × 00–12, 2 × 12–24, 4 off · Control',
    qualifications: ['CONTROL'],
    payPeriodHours: 80,
    payPeriodThreshold: 80,
    overtimeStatus: 'APPROACHING',
    cells: [
      cell('2026-11-16', shift('a-piotr-16', 'A12', '2026-11-16')),
      cell('2026-11-17', shift('a-piotr-17', 'A12', '2026-11-17')),
      cell('2026-11-18', ...OFF),
      cell('2026-11-19', ...OFF),
      cell('2026-11-20', shift('a-piotr-20', 'P12', '2026-11-20')),
      cell('2026-11-21', shift('a-piotr-21', 'P12', '2026-11-21')),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-leah',
    name: 'Leah Morin',
    rotation: '8 h · First aid',
    qualifications: ['FIRST_AID'],
    payPeriodHours: 56,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: [
      cell('2026-11-16', shift('a-leah-16', 'D8', '2026-11-16')),
      cell('2026-11-17', shift('a-leah-17', 'D8', '2026-11-17')),
      cell('2026-11-18', shift('a-leah-18', 'D8', '2026-11-18')),
      cell('2026-11-19', absence('VACATION')),
      cell('2026-11-20', absence('VACATION')),
      cell('2026-11-21', ...OFF),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-devon',
    name: 'Devon Clarke',
    rotation: '8 h · Control',
    qualifications: ['CONTROL'],
    payPeriodHours: 88,
    payPeriodThreshold: 80,
    overtimeStatus: 'IN_OVERTIME',
    cells: [
      cell('2026-11-16', ...OFF),
      cell('2026-11-17', shift('a-devon-17', 'E8', '2026-11-17')),
      cell('2026-11-18', shift('a-devon-18', 'E8', '2026-11-18')),
      cell('2026-11-19', shift('a-devon-19', 'E8', '2026-11-19')),
      cell('2026-11-20', shift('a-devon-20', 'E8', '2026-11-20')),
      cell('2026-11-21', shift('a-devon-21x', 'E8', '2026-11-21', { kind: 'EXTRA' })),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-nia',
    name: 'Nia Thompson',
    rotation: '12 h · Escort, First aid',
    qualifications: ['ESCORT', 'FIRST_AID'],
    payPeriodHours: 84,
    payPeriodThreshold: 80,
    overtimeStatus: 'IN_OVERTIME',
    cells: [
      cell('2026-11-16', shift('a-nia-16', 'A12', '2026-11-16')),
      cell('2026-11-17', ...OFF),
      cell('2026-11-18', ...OFF),
      cell('2026-11-19', shift('a-nia-19', 'A12', '2026-11-19')),
      // PC-01: P12 Fri 20 Nov 12:00-24:00, then the blocked D8 proposal.
      cell('2026-11-20', shift('a-nia-20', 'P12', '2026-11-20')),
      cell('2026-11-21', shift('a-nia-21p', 'D8', '2026-11-21', { proposed: true })),
      cell('2026-11-22', ...OFF),
    ],
  },
  {
    employeeId: 'emp-aiden',
    name: 'Aiden Bergeron',
    rotation: '8 h · General duty',
    qualifications: [],
    payPeriodHours: 72,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: [
      cell('2026-11-16', shift('a-aiden-16', 'E8', '2026-11-16')),
      cell('2026-11-17', shift('a-aiden-17', 'E8', '2026-11-17')),
      cell('2026-11-18', ...OFF),
      cell('2026-11-19', ...OFF),
      cell('2026-11-20', shift('a-aiden-20', 'N8', '2026-11-20')),
      cell('2026-11-21', shift('a-aiden-21', 'N8', '2026-11-21')),
      cell('2026-11-22', shift('a-aiden-22', 'N8', '2026-11-22')),
    ],
  },
];

function coverage(
  block: BlockCoverage['block'],
  date: string,
  required: number,
  lowestHourly: number,
  maxHourly: number,
  shortHours: BlockCoverage['scheduled']['shortHours'] = [],
  actual?: BlockCoverage['actual'],
): BlockCoverage {
  return {
    block,
    date,
    required,
    scheduled: { lowestHourly, shortHours, maxHourly },
    ...(actual ? { actual } : {}),
    covered: shortHours.length === 0 && lowestHourly >= required,
  };
}

const SHORT_15_17 = [{ from: '15:00', to: '17:00', count: 4 }];

const coverageRows: BlockCoverage[] = [
  // Day block, required 5 (docs/10-testing.md §6.2, Unit B).
  coverage('DAY', '2026-11-16', 5, 5, 5, [], { lowestHourly: 5, shortHours: [], maxHourly: 5 }),
  coverage('DAY', '2026-11-17', 5, 5, 6, [], { lowestHourly: 5, shortHours: [], maxHourly: 6 }),
  coverage('DAY', '2026-11-18', 5, 5, 5, [], { lowestHourly: 5, shortHours: [], maxHourly: 5 }),
  coverage('DAY', '2026-11-19', 5, 5, 5),
  coverage('DAY', '2026-11-20', 5, 5, 5),
  coverage('DAY', '2026-11-21', 5, 4, 5, SHORT_15_17),
  coverage('DAY', '2026-11-22', 5, 5, 5),
  // Evening block, required 5.
  coverage('EVENING', '2026-11-16', 5, 5, 5, [], { lowestHourly: 5, shortHours: [], maxHourly: 5 }),
  coverage('EVENING', '2026-11-17', 5, 5, 5, [], { lowestHourly: 5, shortHours: [], maxHourly: 5 }),
  coverage('EVENING', '2026-11-18', 5, 5, 5, [], { lowestHourly: 5, shortHours: [], maxHourly: 5 }),
  coverage('EVENING', '2026-11-19', 5, 5, 5),
  coverage('EVENING', '2026-11-20', 5, 4, 5, SHORT_15_17),
  coverage('EVENING', '2026-11-21', 5, 5, 5),
  coverage('EVENING', '2026-11-22', 5, 6, 6),
  // Night block, required 4.
  coverage('NIGHT', '2026-11-16', 4, 4, 4, [], { lowestHourly: 4, shortHours: [], maxHourly: 4 }),
  coverage('NIGHT', '2026-11-17', 4, 4, 4, [], { lowestHourly: 4, shortHours: [], maxHourly: 4 }),
  coverage('NIGHT', '2026-11-18', 4, 4, 4, [], { lowestHourly: 4, shortHours: [], maxHourly: 4 }),
  coverage('NIGHT', '2026-11-19', 4, 4, 4),
  coverage('NIGHT', '2026-11-20', 4, 4, 4),
  coverage('NIGHT', '2026-11-21', 4, 4, 4),
  coverage('NIGHT', '2026-11-22', 4, 5, 5),
];

/**
 * The period hours come from the shifts themselves, so the planning board and
 * the time and attendance screen count the same hours. The pay period is two
 * weeks, and the board shows the second one.
 */
const officers: OfficerRow[] = rawOfficers.map((officer) => {
  const week = officer.cells.reduce(
    (total, cell) =>
      total +
      cell.items.reduce(
        (sum, item) => sum + (item.type === 'SHIFT' ? (SHIFT_HOURS[item.shiftTemplate] ?? 0) : 0),
        0,
      ),
    0,
  );
  const hours = week * 2;
  return {
    ...officer,
    payPeriodHours: hours,
    payPeriodThreshold: OVERTIME_THRESHOLD,
    overtimeStatus:
      hours > OVERTIME_THRESHOLD
        ? ('IN_OVERTIME' as const)
        : hours > OVERTIME_THRESHOLD - 8
          ? ('APPROACHING' as const)
          : ('UNDER' as const),
  };
});

/** The demo planning board payload. */
export const demoSchedule: SchedulePayload = {
  unit: DEMO_UNIT,
  from: WEEK[0],
  to: WEEK[WEEK.length - 1],
  days: WEEK,
  asOf: DEMO_TODAY,
  coverage: coverageRows,
  officers,
  warnings: 5,
  overridesThisPeriod: 1,
  publishedState: {
    published: true,
    unpublishedChanges: 3,
  },
  period: {
    id: 'period-2026-11-09',
    label: '9 – 22 Nov 2026',
  },
};

/** PC-01: the assignment the rule check is about. */
export const PC01_CHANGE = {
  employeeId: 'emp-nia',
  unitId: DEMO_UNIT.id,
  shiftTemplate: 'D8',
  startAt: '2026-11-21T07:00:00-06:00',
} as const;
