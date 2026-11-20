/**
 * Demo data for the overtime board (docs/ui/README.md §5.3).
 *
 * The open shifts are the ones in the mockup, with the ADR-015 shift times,
 * and the ranked candidates are the sample rows from the mockup. The reasons
 * come from the api in the real build; here the fixture carries them, so the
 * screen shows what it is given and never makes one up
 * (docs/ui/build-notes.md §1.4).
 */

import type { Candidate, OfferRecord, OpenShift } from '../types';

export const demoOpenShifts: OpenShift[] = [
  {
    id: 'os-sat-days',
    date: '2026-11-21',
    startAt: '2026-11-21T07:00:00-06:00',
    endAt: '2026-11-21T15:00:00-06:00',
    unit: { id: 'unit-b', name: 'Unit B · Living unit' },
    shiftTemplate: 'D8',
    needs: 1,
    status: 'OPEN',
    reason: 'Proposed officer blocked (rest)',
  },
  {
    id: 'os-fri-evenings',
    date: '2026-11-20',
    startAt: '2026-11-20T15:00:00-06:00',
    endAt: '2026-11-20T23:00:00-06:00',
    unit: { id: 'unit-b', name: 'Unit B · Living unit' },
    shiftTemplate: 'E8',
    needs: 1,
    status: 'OFFERS_SENT',
    reason: 'Vacation cover',
  },
  {
    id: 'os-sun-nights',
    date: '2026-11-22',
    startAt: '2026-11-22T23:00:00-06:00',
    endAt: '2026-11-23T07:00:00-06:00',
    unit: { id: 'admissions', name: 'Admissions' },
    shiftTemplate: 'N8',
    needs: 0,
    status: 'FILLED',
    reason: 'Sick call',
  },
  {
    id: 'os-cancelled',
    date: '2026-11-24',
    startAt: '2026-11-24T07:00:00-06:00',
    endAt: '2026-11-24T15:00:00-06:00',
    unit: { id: 'unit-b', name: 'Unit B · Living unit' },
    shiftTemplate: 'D8',
    needs: 1,
    status: 'CANCELLED',
    reason: 'Coverage no longer needed',
  },
];

/**
 * The candidates for the Saturday day shift, in the api's ranking order.
 * Officers who would break a Block rule are skipped and keep their place.
 */
export const demoCandidates: Candidate[] = [
  {
    employeeId: 'emp-leah',
    name: 'Leah Morin',
    qualifications: ['FIRST_AID'],
    overtimeHoursThisQuarter: 4,
    seniorityDate: 'Mar 2014',
    eligibility: 'UNAVAILABLE',
    reason: 'On vacation 19 – 21 Nov',
  },
  {
    employeeId: 'emp-aiden',
    name: 'Aiden Bergeron',
    qualifications: [],
    overtimeHoursThisQuarter: 6.5,
    seniorityDate: 'Aug 2019',
    eligibility: 'SKIPPED',
    reason: 'Night shift ends Sat 07:00: no rest. Keeps their place.',
  },
  {
    employeeId: 'emp-sam',
    name: 'Sam Abara',
    qualifications: ['ESCORT'],
    overtimeHoursThisQuarter: 8,
    seniorityDate: 'Nov 2016',
    eligibility: 'ELIGIBLE',
    reason: 'All rules pass',
  },
  {
    employeeId: 'emp-marc',
    name: 'Marc Desjardins',
    qualifications: ['CONTROL', 'FIRST_AID'],
    overtimeHoursThisQuarter: 9.5,
    seniorityDate: 'May 2011',
    eligibility: 'ELIGIBLE',
    reason: 'All rules pass',
  },
  {
    employeeId: 'emp-tara',
    name: 'Tara Nakamura',
    qualifications: ['CONTROL'],
    overtimeHoursThisQuarter: 18.5,
    seniorityDate: 'Feb 2017',
    eligibility: 'WARN',
    reason: 'U-14: 56 h that week (warns at 48 h)',
  },
  {
    employeeId: 'emp-piotr',
    name: 'Piotr Kowalczyk',
    qualifications: ['CONTROL'],
    overtimeHoursThisQuarter: 21,
    seniorityDate: 'Sep 2009',
    eligibility: 'UNAVAILABLE',
    reason: 'Working 12 h 12–24 on Sat in Unit B',
  },
  {
    employeeId: 'emp-devon',
    name: 'Devon Clarke',
    qualifications: ['CONTROL'],
    overtimeHoursThisQuarter: 31,
    seniorityDate: 'Jan 2020',
    eligibility: 'WARN',
    reason: 'U-11: would make a 16 h shift with their Sat evening',
  },
  {
    employeeId: 'emp-ruth',
    name: 'Ruth Okafor',
    qualifications: ['ESCORT'],
    overtimeHoursThisQuarter: 34.5,
    seniorityDate: 'Jun 2012',
    eligibility: 'SKIPPED',
    reason: 'P12 Fri 12:00–24:00: only 7 hours’ rest before this shift. Keeps their place.',
  },
];

/** The offers already recorded, as the mockup shows them. */
export const demoOfferHistory: OfferRecord[] = [
  { id: 'offer-kari-fri', at: '14:30', employeeId: 'emp-kari', employeeName: 'Fri evenings → Kari Lindqvist', status: 'OFFERED' },
  { id: 'offer-sam-fri', at: '14:30', employeeId: 'emp-sam', employeeName: 'Fri evenings → Sam Abara', status: 'DECLINED' },
  {
    id: 'offer-ruth-fri',
    at: '14:30',
    employeeId: 'emp-ruth',
    employeeName: 'Fri evenings → Ruth Okafor',
    status: 'ACCEPTED',
  },
  {
    id: 'offer-sam-sun',
    at: '09:15',
    employeeId: 'emp-sam',
    employeeName: 'Sun nights (Admissions) → Sam Abara',
    status: 'CONFIRMED',
  },
];

/**
 * Offers recorded in this session (E2). They carry the open shift so the
 * supervisor's board shows them under the right shift, and the offer id so the
 * employee's answer can update the same row.
 */
export interface RecordedOffer extends OfferRecord {
  offerId: string;
  openShiftId: string;
}

export const recordedOffers: RecordedOffer[] = [];

const SEEDED_HISTORY = demoOfferHistory.map((entry) => ({ ...entry }));

/** Put the offer history back, so one test cannot change what the next one sees. */
export function resetOfferHistory(): void {
  demoOfferHistory.splice(0, demoOfferHistory.length, ...SEEDED_HISTORY.map((entry) => ({ ...entry })));
  recordedOffers.length = 0;
}

