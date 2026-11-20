/**
 * Demo data for the Reports screen (docs/ui/README.md §5.5).
 *
 * The coverage report is hourly (ADR-013): the share of required staff-hours
 * that were scheduled and that were actually worked. The axis starts at 94%
 * so small gaps are visible, and the last week is planned only.
 */

import type {
  CoverageReport,
  HoursByOfficer,
  HoursReport,
  OvertimeReport,
  OverrideRow,
} from '../types';
import { demoSchedule } from './schedule';

export const demoCoverageReport: CoverageReport = {
  weeks: [
    { label: '9 – 15 Nov', scheduledPercent: 98.6, actualPercent: 97.4, planned: false },
    { label: '16 – 22 Nov', scheduledPercent: 101.2, actualPercent: 99.2, planned: false },
    { label: '23 – 29 Nov', scheduledPercent: 100.4, planned: true },
  ],
  axisFrom: 94,
  axisTo: 102,
  requiredHours: 3920,
  scheduledHours: 3891,
  actualHours: 3848,
};

/** The overtime hours this quarter, from the board's officers. */
const QUARTER_OVERTIME: Record<string, number> = {
  'emp-tara': 18.5,
  'emp-ruth': 34.5,
  'emp-marc': 9.5,
  'emp-kari': 6.5,
  'emp-sam': 8,
  'emp-piotr': 21,
  'emp-leah': 4,
  'emp-devon': 31,
  'emp-nia': 25.5,
  'emp-aiden': 6.5,
};

export const demoOvertimeReport: OvertimeReport = {
  rows: demoSchedule.officers
    .map((officer) => ({
      employeeId: officer.employeeId,
      name: officer.name,
      hours: QUARTER_OVERTIME[officer.employeeId] ?? 0,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8),
  averageHours: 12.4,
};

export const demoHoursReport: HoursReport = {
  period: {
    id: 'period-2026-10-26',
    label: '26 Oct – 8 Nov 2026',
    status: 'LOCKED',
    lockedBy: 'M. Ellis',
    lockedAt: '9 Nov 08:12',
  },
  rows: demoSchedule.officers.map((officer): HoursByOfficer => {
    const scheduled = officer.payPeriodHours;
    const overtime15 = QUARTER_OVERTIME[officer.employeeId] ?? 0;
    const sick = officer.name === 'Marc Desjardins' ? 8 : 0;
    const vacation = officer.name === 'Leah Morin' ? 24 : 0;
    const worked = scheduled + overtime15;
    return {
      employeeId: officer.employeeId,
      name: officer.name,
      scheduled,
      worked,
      regular: worked - overtime15,
      overtime15,
      // The 2x band is off by default, so no officer has hours in it.
      overtime20: 0,
      sick,
      vacation,
    };
  }),
  totalOfficers: 100,
};

/** The emergency overrides, with their reasons. */
export const demoOverrides: OverrideRow[] = [
  {
    id: 'ov-1',
    at: '4 Nov 13:05',
    employeeName: 'Ruth Okafor',
    unitName: 'Unit C · Living unit',
    ruleCode: 'U-05',
    reason: 'Lockdown, relief unavailable',
  },
  {
    id: 'ov-2',
    at: '11 Nov 09:48',
    employeeName: 'Devon Clarke',
    unitName: 'Unit B · Living unit',
    ruleCode: 'U-01',
    reason: 'No relief available for the night block',
  },
  {
    id: 'ov-3',
    at: '15 Nov 22:10',
    employeeName: 'Kari Lindqvist',
    unitName: 'Admissions',
    ruleCode: 'U-03',
    reason: 'Short-staffed after the hospital transfer',
  },
  {
    id: 'ov-4',
    at: '18 Nov 08:30',
    employeeName: 'Sam Abara',
    unitName: 'Control',
    ruleCode: 'U-11',
    reason: 'Approved by the shift commander',
  },
];
