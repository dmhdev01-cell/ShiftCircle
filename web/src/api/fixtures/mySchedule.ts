/**
 * Demo data for the employee's My schedule (docs/ui/README.md §5.2).
 *
 * The officer is Sam Abara, so the screen agrees with the overtime board:
 * their pay-period hours are the ones the board shows, and their Saturday day
 * shift is the one they are eligible for. The shift times follow ADR-015.
 */

import type { DayCell, MyOffer, MySchedulePayload } from '../types';

export const DEMO_EMPLOYEE_ID = 'emp-sam';

/** The nights Sam works, then the days off: 4 nights on, 2 off, 1 on. */
const CYCLE: ('N8' | 'OFF')[] = ['N8', 'N8', 'N8', 'N8', 'OFF', 'OFF', 'N8'];
const CYCLE_ANCHOR = '2026-11-16';

function dayOffset(date: string): number {
  const start = new Date(`${CYCLE_ANCHOR}T00:00:00Z`).getTime();
  const day = new Date(`${date}T00:00:00Z`).getTime();
  return Math.round((day - start) / 86_400_000);
}

function cycleFor(date: string): 'N8' | 'OFF' {
  const offset = ((dayOffset(date) % 7) + 7) % 7;
  return CYCLE[offset];
}

function novemberDays(): string[] {
  const days: string[] = [];
  for (let day = 1; day <= 30; day += 1) {
    days.push(`2026-11-${String(day).padStart(2, '0')}`);
  }
  return days;
}

const days = novemberDays();

const shifts: DayCell[] = days.map((date) => {
  const code = cycleFor(date);
  return {
    date,
    items:
      code === 'OFF'
        ? []
        : [
            {
              type: 'SHIFT' as const,
              assignmentId: `a-sam-${date}`,
              shiftTemplate: 'N8',
              startAt: `${date}T23:00:00-06:00`,
              endAt: `${date}T23:00:00-06:00`,
              kind: 'ROSTERED' as const,
              worked: date < '2026-11-19',
            },
          ],
  };
});

export const demoMySchedule: MySchedulePayload = {
  asOf: '2026-11-19',
  employee: {
    id: DEMO_EMPLOYEE_ID,
    name: 'Sam Abara',
    role: 'Correctional officer',
    unit: { id: 'unit-b', name: 'Unit B · Living unit' },
    rotation: '8 h rotation',
    qualifications: ['ESCORT'],
  },
  nextShift: {
    date: '2026-11-22',
    startAt: '2026-11-22T23:00:00-06:00',
    endAt: '2026-11-23T07:00:00-06:00',
    shiftTemplate: 'N8',
    unit: { id: 'unit-b', name: 'Unit B · Living unit' },
  },
  payPeriod: {
    label: '9 – 22 Nov 2026',
    workedHours: 60,
    scheduledHours: 12,
    totalHours: 72,
    thresholdHours: 80,
  },
  overtimeThisQuarter: {
    hours: 8,
    rank: 41,
    of: 100,
  },
  days,
  shifts,
};

/** The overtime offer waiting for the officer. */
export const demoMyOffers: MyOffer[] = [
  {
    id: 'offer-sat-evening',
    openShift: {
      id: 'os-sat-evenings',
      date: '2026-11-21',
      startAt: '2026-11-21T15:00:00-06:00',
      endAt: '2026-11-21T23:00:00-06:00',
      unit: { id: 'unit-b', name: 'Unit B · Living unit' },
      shiftTemplate: 'E8',
      needs: 1,
      status: 'OFFERS_SENT',
      reason: 'Vacation cover',
    },
    offeredBy: 'M. Ellis',
    offeredAt: '14:20',
    eligibility: 'ELIGIBLE',
    reason: '56 h rest before · 72 h this pay period',
    ruleResults: [
      {
        ruleCode: 'U-01',
        ruleTable: 'REST',
        outcome: 'PASS',
        overridePolicy: 'EMERGENCY',
        message: '56 hours of rest before the shift. The minimum is 8 consecutive hours.',
      },
    ],
    status: 'OFFERED',
  },
  {
    id: 'offer-sun-night',
    openShift: {
      id: 'os-sun-nights-b',
      date: '2026-11-22',
      startAt: '2026-11-22T23:00:00-06:00',
      endAt: '2026-11-23T07:00:00-06:00',
      unit: { id: 'unit-b', name: 'Unit B · Living unit' },
      shiftTemplate: 'N8',
      needs: 1,
      status: 'OFFERS_SENT',
      reason: 'Sick call',
    },
    offeredBy: 'M. Ellis',
    offeredAt: '15:05',
    eligibility: 'ELIGIBLE',
    reason: '40 h rest before · 72 h this pay period',
    status: 'OFFERED',
  },
];
