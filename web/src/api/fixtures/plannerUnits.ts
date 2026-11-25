import { ApiError } from '../http';
import type {
  FlaggedShift,
  PlannerUnit,
  StaffingBreakdown,
  StaffingPeriod,
  StaffingReport,
  StaffingUnitRow,
  UnitClosure,
} from '../types';

/**
 * Release 3 fixtures (api contract v2): the six units, their dated closures,
 * flagged published shifts and the staffing periods. The demo closure is Unit
 * C from 15 Feb 2027 (open-ended) - the same one the demo script and the api
 * test fixture use. The demo today is 19 Nov 2026, so a closure starting in
 * February is FUTURE.
 */

interface UnitSeed {
  id: string;
  code: string;
  name: string;
  kind: string;
  allows12h: boolean;
  mins: { DAY: number; EVENING: number; NIGHT: number };
  filled: number;
  allocated: number;
}

const UNITS: UnitSeed[] = [
  { id: 'unit-a', code: 'A', name: 'Unit A · Living unit', kind: 'LIVING', allows12h: false, mins: { DAY: 5, EVENING: 5, NIGHT: 4 }, filled: 23, allocated: 23 },
  { id: 'unit-b', code: 'B', name: 'Unit B · Living unit', kind: 'LIVING', allows12h: false, mins: { DAY: 5, EVENING: 5, NIGHT: 4 }, filled: 23, allocated: 23 },
  { id: 'unit-c', code: 'C', name: 'Unit C · Living unit', kind: 'LIVING', allows12h: true, mins: { DAY: 5, EVENING: 5, NIGHT: 4 }, filled: 21, allocated: 21 },
  { id: 'adm', code: 'ADM', name: 'Admissions', kind: 'ADMIN', allows12h: false, mins: { DAY: 3, EVENING: 3, NIGHT: 2 }, filled: 18, allocated: 18 },
  { id: 'ctl', code: 'CTL', name: 'Control', kind: 'CONTROL', allows12h: true, mins: { DAY: 3, EVENING: 2, NIGHT: 2 }, filled: 18, allocated: 18 },
  { id: 'esc', code: 'ESC', name: 'Escort & transport', kind: 'ESCORT', allows12h: true, mins: { DAY: 4, EVENING: 0, NIGHT: 4 }, filled: 17, allocated: 17 },
];

function demoClosures(): Record<string, UnitClosure[]> {
  return {
    'unit-c': [
      {
        id: 'closure-c-1',
        closedFrom: '2027-02-15',
        reopensOn: null,
        reason: 'Renovation (demo)',
        createdBy: 'P. Planner',
        createdAt: '2026-11-21T23:40:00-06:00',
        state: 'FUTURE',
      },
    ],
  };
}

let closures = demoClosures();
let allocations: Record<string, number> = {};
let leaveAllowance = 0.2;

export function resetPlannerUnitFixtures(): void {
  closures = demoClosures();
  allocations = {};
  leaveAllowance = 0.2;
}

export function fixturePlannerUnits(): PlannerUnit[] {
  return UNITS.map((unit) => {
    const today: PlannerUnit['today'] = unit.id === 'unit-c' ? 'OPEN' : 'OPEN';
    return {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      kind: unit.kind,
      active: true,
      today,
      todayNote: null,
      allows12h: unit.allows12h,
      allows16h: unit.allows12h,
      allocated: allocations[unit.id] ?? unit.allocated,
      filled: unit.filled,
      closures: (closures[unit.id] ?? []).slice().sort((a, b) => a.closedFrom.localeCompare(b.closedFrom)),
    };
  });
}

/** The api's needed formula (ADR-027), used here only to build fixture numbers. */
function breakdownFor(unit: UnitSeed, leave: number): StaffingBreakdown {
  const posts12Day = unit.allows12h ? unit.mins.DAY : 0;
  const posts12Night = unit.allows12h ? unit.mins.NIGHT : 0;
  const posts8 = unit.allows12h
    ? Math.max(0, unit.mins.EVENING - unit.mins.NIGHT)
    : unit.mins.DAY + unit.mins.EVENING + unit.mins.NIGHT;
  const rawNeeded = 2 * (posts12Day + posts12Night) + 1.4 * posts8;
  return {
    posts12Day,
    posts12Night,
    posts8,
    rawNeeded,
    leaveAllowance: leave,
    needed: Math.ceil(rawNeeded / (1 - leave)),
  };
}

function closedWholePeriod(unitId: string, from: string, to: string): boolean {
  const list = closures[unitId] ?? [];
  return list.some(
    (closure) =>
      closure.closedFrom <= from && (closure.reopensOn === null || closure.reopensOn > to),
  );
}

function periodFor(from: string, to: string): StaffingPeriod {
  const units: StaffingUnitRow[] = UNITS.map((unit) => {
    const breakdown = breakdownFor(unit, leaveAllowance);
    const closed = closedWholePeriod(unit.id, from, to);
    const needed = closed ? 0 : breakdown.needed;
    const allocated = allocations[unit.id] ?? unit.allocated;
    return {
      unitId: unit.id,
      unitCode: unit.code,
      unitName: unit.name,
      closed,
      allocated,
      filled: unit.filled,
      needed,
      shortfall: Math.max(0, needed - unit.filled),
      breakdown: { ...breakdown, needed },
    };
  });
  const totals = units.reduce(
    (sum, row) => ({
      allocated: sum.allocated + row.allocated,
      filled: sum.filled + row.filled,
      needed: sum.needed + row.needed,
      shortfall: sum.shortfall + row.shortfall,
    }),
    { allocated: 0, filled: 0, needed: 0, shortfall: 0 },
  );
  return { from, to, units, totals };
}

/** Two periods for the demo closure: before it and from 15 Feb. */
export function fixtureStaffing(): StaffingReport {
  const hasFebruaryClosure = (closures['unit-c'] ?? []).some(
    (closure) => closure.closedFrom > '2027-01-04' && closure.closedFrom < '2027-04-11',
  );
  const periods = hasFebruaryClosure
    ? [periodFor('2027-01-04', '2027-02-14'), periodFor('2027-02-15', '2027-04-11')]
    : [periodFor('2027-01-04', '2027-04-11')];
  return {
    leaveAllowance,
    periods,
    note: 'Do we need more staff? Officers are unit-specific: a surplus in one unit does not cover a shortfall in another.',
    truncated: false,
  };
}

export function fixtureFlaggedShifts(): FlaggedShift[] {
  const unitC = fixturePlannerUnits().find((unit) => unit.id === 'unit-c')!;
  const closure = unitC.closures[0];
  if (!closure) return [];
  return [
    {
      shiftId: 'flagged-1',
      unitId: 'unit-c',
      unitCode: 'C',
      unitName: 'Unit C · Living unit',
      date: '2027-02-16',
      templateCode: 'D12',
      shiftLabel: 'Day 07-19 (12 h)',
      officerName: 'Kari Lindqvist',
      start: '2027-02-16T07:00:00-06:00',
      end: '2027-02-16T19:00:00-06:00',
      closedFrom: closure.closedFrom,
      reason: closure.reason,
    },
    {
      shiftId: 'flagged-2',
      unitId: 'unit-c',
      unitCode: 'C',
      unitName: 'Unit C · Living unit',
      date: '2027-02-18',
      templateCode: 'N12',
      shiftLabel: 'Night 19-07 (12 h)',
      officerName: 'Sam Abara',
      start: '2027-02-18T19:00:00-06:00',
      end: '2027-02-19T07:00:00-06:00',
      closedFrom: closure.closedFrom,
      reason: closure.reason,
    },
  ];
}

function validateReason(reason: string): void {
  if (!reason || reason.trim().length < 5) {
    throw new ApiError('Write a reason of at least 5 characters.', 400);
  }
}

export function addUnitClosure(
  unitId: string,
  input: { closedFrom: string; reopensOn?: string | null; reason: string },
): UnitClosure {
  const unit = fixturePlannerUnits().find((entry) => entry.id === unitId);
  if (!unit) throw new ApiError('That unit is not on the list.', 404);
  validateReason(input.reason);
  if (!input.closedFrom) throw new ApiError('Enter the first day the unit is closed.', 400);
  if (input.reopensOn && input.reopensOn <= input.closedFrom) {
    throw new ApiError('The reopening date must be after the closing date.', 400);
  }
  const overlap = unit.closures.some(
    (closure) =>
      (!closure.reopensOn || closure.reopensOn > input.closedFrom) &&
      (!input.reopensOn || input.reopensOn > closure.closedFrom),
  );
  if (overlap) {
    throw new ApiError('Unit C is already closed from 15 Feb 2027 with no reopening date set. Change that closure instead.', 400);
  }
  const closure: UnitClosure = {
    id: `closure-${unitId}-${Date.now()}`,
    closedFrom: input.closedFrom,
    reopensOn: input.reopensOn ?? null,
    reason: input.reason.trim(),
    createdBy: 'P. Planner',
    createdAt: new Date().toISOString(),
    state: 'FUTURE',
  };
  closures = { ...closures, [unitId]: [...(closures[unitId] ?? []), closure] };
  return closure;
}

export function updateUnitClosure(
  unitId: string,
  closureId: string,
  input: { closedFrom?: string; reopensOn?: string | null; reason: string },
): UnitClosure {
  validateReason(input.reason);
  const list = closures[unitId] ?? [];
  const current = list.find((closure) => closure.id === closureId);
  if (!current) throw new ApiError('That closure is not on the list.', 404);
  const closedFrom = input.closedFrom ?? current.closedFrom;
  const reopensOn = input.reopensOn === undefined ? current.reopensOn : input.reopensOn;
  if (reopensOn && reopensOn <= closedFrom) {
    throw new ApiError('The reopening date must be after the closing date.', 400);
  }
  const updated: UnitClosure = {
    ...current,
    closedFrom,
    reopensOn,
    reason: input.reason.trim(),
    state: current.state,
  };
  closures = { ...closures, [unitId]: list.map((closure) => (closure.id === closureId ? updated : closure)) };
  return updated;
}

export function removeUnitClosure(unitId: string, closureId: string): void {
  closures = { ...closures, [unitId]: (closures[unitId] ?? []).filter((closure) => closure.id !== closureId) };
}

export function previewUnitClosure(
  unitId: string,
  input: { closedFrom: string; reopensOn?: string | null },
): { officersHomed: number; publishedShiftsAffected: number } {
  const unit = fixturePlannerUnits().find((entry) => entry.id === unitId);
  if (!unit) throw new ApiError('That unit is not on the list.', 404);
  return {
    officersHomed: unit.filled,
    publishedShiftsAffected: unitId === 'unit-c' && input.closedFrom <= '2027-02-16' ? 12 : 0,
  };
}

export function setUnitAllocation(unitId: string, allocated: number, reason: string): StaffingUnitRow {
  validateReason(reason);
  if (!Number.isInteger(allocated) || allocated < 0 || allocated > 999) {
    throw new ApiError('Enter a whole number from 0 to 999.', 400);
  }
  allocations = { ...allocations, [unitId]: allocated };
  const period = fixtureStaffing().periods[0];
  return period.units.find((row) => row.unitId === unitId)!;
}

export function setLeaveAllowanceFixture(percent: number, reason: string): { leaveAllowance: number } {
  validateReason(reason);
  if (!Number.isInteger(percent) || percent < 0 || percent > 50) {
    throw new ApiError('Enter a whole number from 0 to 50.', 400);
  }
  leaveAllowance = percent / 100;
  return { leaveAllowance };
}
