/**
 * Demo fixtures for the quarter planner (docs/ui/planner.md §10).
 *
 * Small but honest: one window, a deterministic draft built from the seed, a
 * few gaps and two warning groups, so the screens can be built and tested
 * against the same shapes the real api sends. The real generator lives in the
 * api; this one never tries to be it.
 */

import type {
  Block,
  PlannerCommitPreview,
  PlannerCompare,
  PlannerCommitResult,
  PlannerDraft,
  PlannerGap,
  PlannerPlan,
  PlannerWarningGroup,
  MyPreferences,
  MyPreferencesInput,
  PlannerPreferenceRow,
  PlannerUnitCoverage,
  SchedulePayload,
} from '../types';
import { scheduleForRange } from './schedule';

export const PLANNER_WINDOW = { from: '2027-01-04', to: '2027-04-11', periods: 7 };
export const PLANNER_DEFAULT_SEED = 20261001;
export const PLANNER_PATTERNS = ['ROTATING_5_2', '5_ON_2_OFF', '7_ON_3_OFF'];

let draft: PlannerDraft | null = null;
let committed: PlannerPlan['lastCommitted'] = null;

function scorecard(seed: number) {
  // The seed changes the figures a little, so "same seed, same plan" is visible
  // and a different seed is visible too.
  const nudge = seed % 7;
  return {
    coverage: { shortBlockDays: 37 + nudge, totalBlockDays: 1764 },
    warnings: {
      total: 112 + nudge * 2,
      note: 'About one rest warning and one week-hours warning per officer, from the rotating pattern. Warnings never block a shift.',
      byRule: [
        { ruleName: 'Fewer than 12 hours between shifts', count: 74 + nudge },
        { ruleName: 'Week over 60 hours', count: 38 + nudge },
      ],
    },
    preferences: {
      asked: 530,
      met: 412 - nudge,
      byKind: [
        { kind: 'SHIFT_LENGTH' as const, asked: 100, met: 88 },
        { kind: 'TIME_OF_DAY' as const, asked: 230, met: 162 - nudge },
        { kind: 'DAYS_OFF' as const, asked: 200, met: 162 },
      ],
    },
    nights: {
      bands: [
        {
          label: 'Newest third',
          hiredFrom: '2020',
          hiredTo: '2025',
          officers: 33,
          nightShare: 61,
          avoidNightsAsked: 14,
          avoidNightsGivenNights: 9,
          nightShiftsAgainstWish: 41,
        },
        {
          label: 'Middle third',
          hiredFrom: '2013',
          hiredTo: '2019',
          officers: 33,
          nightShare: 29,
          avoidNightsAsked: 6,
          avoidNightsGivenNights: 2,
          nightShiftsAgainstWish: 9,
        },
        {
          label: 'Most senior third',
          hiredFrom: '2006',
          hiredTo: '2012',
          officers: 34,
          nightShare: 10,
          avoidNightsAsked: 3,
          avoidNightsGivenNights: 1,
          nightShiftsAgainstWish: 4,
        },
      ],
      newestFirstHeld: true,
      check: 'Newest first held in all 6 units.',
    },
    overtime: { officersOver: 18, hoursOver: 640, thresholdHours: 80 },
    generatedMs: 2400,
    quarterHours: { min: 480, avg: 512, max: 546 },
    weekends: { min: 4, avg: 7.2, max: 11 },
  };
}

export function plannerPlan(): PlannerPlan {
  return {
    window: PLANNER_WINDOW,
    defaultSeed: PLANNER_DEFAULT_SEED,
    patterns8h: PLANNER_PATTERNS,
    state: draft ? 'DRAFT' : committed ? 'COMMITTED' : 'NONE',
    draft,
    lastCommitted: committed,
  };
}

export function generatePlannerDraft(seed: number, pattern8h?: string): PlannerDraft {
  draft = {
    id: `draft-${seed}`,
    version: 1,
    seed,
    pattern8h: pattern8h ?? 'ROTATING_5_2',
    status: 'DRAFT',
    createdAt: '2026-11-21T09:14:00-06:00',
    createdBy: 'P. Planner',
    generatedMs: 2400,
    scorecard: scorecard(seed),
  };
  return draft;
}

export function plannerDraft(): PlannerDraft {
  if (!draft) throw new Error('no fixture draft');
  return draft;
}

const BLOCKS: Block[] = ['DAY', 'EVENING', 'NIGHT'];

export function plannerGaps(): PlannerGap[] {
  const rows: PlannerGap[] = [];
  const units = [
    { unitId: 'unit-a', unitCode: 'A', unitName: 'Unit A · Living unit' },
    { unitId: 'unit-b', unitCode: 'B', unitName: 'Unit B · Living unit' },
    { unitId: 'control', unitCode: 'CTL', unitName: 'Control' },
  ];
  for (let index = 0; index < 5; index += 1) {
    const unit = units[index % units.length];
    const day = 9 + index * 4;
    rows.push({
      unitId: unit.unitId,
      unitCode: unit.unitCode,
      unitName: unit.unitName,
      date: `2027-01-${String(day).padStart(2, '0')}`,
      block: BLOCKS[index % BLOCKS.length],
      required: index % 2 === 0 ? 3 : 5,
      placed: index % 2 === 0 ? 2 : 4,
      reason:
        index === 0 ? 'No officer with Control training had enough rest' : null,
    });
  }
  return rows;
}

export function plannerWarnings(): PlannerWarningGroup[] {
  return [
    {
      ruleName: 'Fewer than 12 hours between shifts',
      count: 74,
      items: [
        {
          unitCode: 'B',
          date: '2027-01-09',
          employeeName: 'K. Lindqvist',
          shift: 'D8 07:00–15:00',
          message: '9 h between shifts',
        },
      ],
    },
    {
      ruleName: 'Week over 60 hours',
      count: 38,
      items: [
        {
          unitCode: 'A',
          date: '2027-01-16',
          employeeName: 'N. Thompson',
          shift: 'A12 00:00–12:00',
          message: '62 hours this week',
        },
      ],
    },
  ];
}

let myPreferences: MyPreferences = {
  shiftLength: null,
  timeOfDay: null,
  daysOff: [],
  maxDaysOff: 2,
  allowedLengths: [8, 12, 16],
  updatedAt: null,
};

export function fixtureMyPreferences(): MyPreferences {
  return myPreferences;
}

export function saveMyPreferences(input: MyPreferencesInput): MyPreferences {
  myPreferences = {
    ...myPreferences,
    ...input,
    daysOff: input.daysOff.slice(0, myPreferences.maxDaysOff),
    updatedAt: '2026-11-21T08:55:00-06:00',
  };
  return myPreferences;
}

export function clearMyPreferences(): void {
  myPreferences = { ...myPreferences, shiftLength: null, timeOfDay: null, daysOff: [], updatedAt: null };
}

/** Everyone's preferences as the planner reads them; Tara has given some. */
export function fixturePlannerPreferences(): PlannerPreferenceRow[] {
  return [
    {
      employeeId: 'emp-tara',
      name: 'Tara Nakamura',
      employeeNo: 'E-0004',
      unitName: 'Unit B · Living unit',
      seniorityDate: '2019-04-01',
      shiftLength: 8,
      timeOfDay: 'DAY',
      daysOff: ['SAT', 'SUN'],
      maxDaysOff: 2,
      inDraft: draft ? 'MET' : 'NO_DRAFT',
      unmet: [],
      updatedAt: '2026-11-21T08:55:00-06:00',
    },
    {
      employeeId: 'emp-sam',
      name: 'Sam Abara',
      employeeNo: 'E-0007',
      unitName: 'Control',
      seniorityDate: '2016-01-11',
      shiftLength: null,
      timeOfDay: 'NIGHT',
      daysOff: ['WED'],
      maxDaysOff: 2,
      inDraft: draft ? 'PARTLY' : 'NO_DRAFT',
      unmet: draft ? ['time of day: 9 night shifts'] : [],
      updatedAt: '2026-11-20T14:00:00-06:00',
    },
    {
      employeeId: 'emp-ruth',
      name: 'Ruth Okafor',
      employeeNo: 'E-0012',
      unitName: 'Unit B · Living unit',
      seniorityDate: '2009-06-01',
      shiftLength: 12,
      timeOfDay: 'DAY',
      daysOff: ['SAT', 'SUN'],
      maxDaysOff: 2,
      inDraft: draft ? 'MET' : 'NO_DRAFT',
      unmet: [],
      updatedAt: null,
    },
  ];
}

/** The draft's own roster, in the board's shape (no EXTRA, no offers). */
export function plannerSchedule(query: { unitId: string; from: string; to: string }): SchedulePayload {
  const base = scheduleForRange(query.from, query.to);
  return {
    ...base,
    unit: base.unit.id === query.unitId ? base.unit : base.unit,
    period: null,
    publishedState: { published: false, unpublishedChanges: null },
  };
}

export function plannerCoverage(range: { from: string; to: string }): PlannerUnitCoverage[] {
  const base = scheduleForRange(range.from, range.to);
  return [
    { unitId: base.unit.id, unitName: base.unit.name, coverage: base.coverage },
    ...['unit-a', 'control'].map((unitId) => ({
      unitId,
      unitName: unitId === 'control' ? 'Control' : 'Unit A · Living unit',
      coverage: base.coverage.map((entry) => ({ ...entry, required: Math.max(1, entry.required - 1) })),
    })),
  ];
}

export function plannerCompare(): PlannerCompare {
  const current = plannerDraft();
  return {
    draftShifts: 4212,
    draftGaps: current.scorecard.coverage.shortBlockDays,
    committedShifts: committed?.shiftsWritten ?? 0,
    rows: [
      { key: 'shifts', label: 'Shifts', board: committed?.shiftsWritten ?? 0, draft: 4212, unit: 'count', direction: 'NEUTRAL' },
      { key: 'gaps', label: 'Block-days short', board: 52, draft: current.scorecard.coverage.shortBlockDays, unit: 'count', direction: 'LOWER_IS_BETTER' },
      { key: 'warnings', label: 'Rule warnings', board: 140, draft: current.scorecard.warnings.total, unit: 'count', direction: 'LOWER_IS_BETTER' },
      { key: 'overtime', label: 'Overtime hours built in', board: 702, draft: current.scorecard.overtime.hoursOver, unit: 'hours', direction: 'LOWER_IS_BETTER' },
    ],
  };
}

export function plannerCommitPreview(): PlannerCommitPreview {
  const current = plannerDraft();
  return {
    version: current.version,
    shiftsToWrite: 4212,
    officers: 100,
    shortBlockDays: current.scorecard.coverage.shortBlockDays,
    warningCount: current.scorecard.warnings.total,
    from: PLANNER_WINDOW.from,
    to: PLANNER_WINDOW.to,
  };
}

export function commitPlannerDraft(): PlannerCommitResult {
  const current = plannerDraft();
  committed = {
    draftId: current.id,
    at: '2026-11-21T09:40:00-06:00',
    by: 'P. Planner',
    shiftsWritten: 4212,
  };
  draft = null;
  return {
    shiftsWritten: 4212,
    committedAt: committed.at,
    auditEventId: 1,
    units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC'],
    firstWeek: PLANNER_WINDOW.from,
  };
}

export function discardPlannerDraft(): void {
  draft = null;
}

/** Put the planner fixtures back, so one test cannot change what the next sees. */
export function resetPlannerFixtures(): void {
  draft = null;
  committed = null;
  myPreferences = {
    shiftLength: null,
    timeOfDay: null,
    daysOff: [],
    maxDaysOff: 2,
    allowedLengths: [8, 12, 16],
    updatedAt: null,
  };
}
