/**
 * Demo data for Time and attendance (docs/ui/build-notes.md §2.2).
 *
 * Two pay periods: the open one the supervisor is working on, and a locked
 * one from earlier so the read-only state and the payroll export can be
 * seen. The entries follow the planning board's shifts, so the two screens
 * agree about who is working when.
 *
 * ADR-017: a shift that has ended and has no actual is flagged, and the
 * period cannot be locked while any of them is missing.
 */

import type { PayCode, PayPeriod, TimeEntry } from '../types';
import { demoSchedule } from './schedule';

export const DEMO_AS_OF = '2026-11-19';

export const demoPayPeriods: PayPeriod[] = [
  {
    id: 'period-2026-11-09',
    label: '9 – 22 Nov 2026',
    from: '2026-11-09',
    to: '2026-11-22',
    status: 'OPEN',
    totals: { officers: 10, workedHours: 801, overtimeHours: 31 },
    overtimeThresholdHours: 80,
  },
  {
    id: 'period-2026-10-26',
    label: '26 Oct – 8 Nov 2026',
    from: '2026-10-26',
    to: '2026-11-08',
    status: 'LOCKED',
    lockedBy: 'M. Ellis',
    lockedAt: '9 Nov 08:12',
    lastExport: { at: '9 Nov 08:14', fileHash: '9f2c4b1e8a' },
    totals: { officers: 10, workedHours: 764, overtimeHours: 24 },
    overtimeThresholdHours: 80,
  },
];

/** The same instant, a number of days earlier. */
function shiftInstant(instant: string, days: number): string {
  const parsed = new Date(`${instant.slice(0, 10)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return `${parsed.toISOString().slice(0, 10)}T${instant.slice(11)}`;
}

function payCodesFor(hours: number): PayCode[] {
  return [{ code: 'REG', hours, multiplier: 1 }];
}

/** The short unit code the payroll CSV uses, from the fixture's unit id. */
export function unitCodeFor(unitId: string): string {
  const codes: Record<string, string> = { 'unit-b': 'B', control: 'CTL', escort: 'ESC' };
  return codes[unitId] ?? unitId.slice(0, 3).toUpperCase();
}

/** The shifts that have ended with nothing recorded. */
const MISSING = new Set(['a-marc-16', 'a-kari-17', 'a-sam-18']);

/** A shift that was worked longer than scheduled, and one short extension. */
const ADJUSTED = new Set(['a-leah-16']);
const SHORT_EXTENSION = new Set(['a-tara-17']);

/** The unit an officer works in, from their qualifications. */
function unitFor(qualifications: string[]): { id: string; name: string } {
  if (qualifications.includes('CONTROL')) {
    return { id: 'control', name: 'Control' };
  }
  if (qualifications.includes('ESCORT') && !qualifications.includes('FIRST_AID')) {
    return { id: 'escort', name: 'Escort & transport' };
  }
  return { id: 'unit-b', name: 'Unit B · Living unit' };
}

function entryFor(
  assignmentId: string,
  employeeId: string,
  employeeName: string,
  unit: { id: string; name: string },
  date: string,
  shiftTemplate: string,
  startAt: string,
  endAt: string,
): TimeEntry {
  const past = date < DEMO_AS_OF;
  const hours = Math.round(
    (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000,
  );

  if (MISSING.has(assignmentId)) {
    return {
      assignmentId,
      employeeId,
      employeeName,
      unitId: unit.id,
      unitName: unit.name,
      date,
      shiftTemplate,
      startAt,
      endAt,
      worked: false,
      needsActual: true,
    };
  }

  if (!past) {
    return {
      assignmentId,
      employeeId,
      employeeName,
      unitId: unit.id,
      unitName: unit.name,
      date,
      shiftTemplate,
      startAt,
      endAt,
      worked: false,
    };
  }

  if (ADJUSTED.has(assignmentId)) {
    const adjustedEnd = new Date(new Date(endAt).getTime() + 90 * 60_000).toISOString();
    return {
      assignmentId,
      employeeId,
      employeeName,
      unitId: unit.id,
      unitName: unit.name,
      date,
      shiftTemplate,
      startAt,
      endAt,
      actualStart: startAt,
      actualEnd: adjustedEnd,
      worked: true,
      payCodes: payCodesFor(hours + 1.5),
    };
  }

  if (SHORT_EXTENSION.has(assignmentId)) {
    const adjustedEnd = new Date(new Date(endAt).getTime() + 20 * 60_000).toISOString();
    return {
      assignmentId,
      employeeId,
      employeeName,
      unitId: unit.id,
      unitName: unit.name,
      date,
      shiftTemplate,
      startAt,
      endAt,
      actualStart: startAt,
      actualEnd: adjustedEnd,
      worked: true,
      unpaidExtensionMinutes: 20,
      payCodes: payCodesFor(hours),
    };
  }

  return {
    assignmentId,
    employeeId,
    employeeName,
    unitId: unit.id,
    unitName: unit.name,
    date,
    shiftTemplate,
    startAt,
    endAt,
    actualStart: startAt,
    actualEnd: endAt,
    worked: true,
    payCodes: payCodesFor(hours),
  };
}

function isShift(item: { type: string }): boolean {
  return item.type === 'SHIFT';
}

/** Every scheduled shift in the pay period, with what was recorded for it. */
export const demoTimeEntries: TimeEntry[] = demoSchedule.officers.flatMap((officer) =>
  officer.cells.flatMap((cell) =>
    cell.items.filter(isShift).flatMap((item) => {
      if (item.type !== 'SHIFT') return [];
      const unit = unitFor(officer.qualifications);
      const entry = entryFor(
        item.assignmentId,
        officer.employeeId,
        officer.name,
        unit,
        cell.date,
        item.shiftTemplate,
        item.startAt,
        item.endAt,
      );
      // The weeks before are the same rotation, so both pay periods have data:
      // 26 Oct – 1 Nov, 2 – 8 Nov, 9 – 15 Nov, then this week.
      const earlier = [-21, -14, -7].map((days) =>
        entryFor(
          `${item.assignmentId}-w${Math.abs(days) / 7}`,
          officer.employeeId,
          officer.name,
          unit,
          shiftInstant(item.startAt, days).slice(0, 10),
          item.shiftTemplate,
          shiftInstant(item.startAt, days),
          shiftInstant(item.endAt, days),
        ),
      );
      return [...earlier, entry];
    }),
  ),
);
