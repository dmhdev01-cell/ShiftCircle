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
  OfficerPattern,
  PlannerCommitPreview,
  PlannerCompare,
  PlannerCommitResult,
  PlannerDraft,
  PlannerGap,
  PlannerPlan,
  PlannerWarningGroup,
  PlanInputs,
  MyPreferences,
  MyPreferencesInput,
  PlannerPreferenceRow,
  PlannerUnitCoverage,
  SchedulePayload,
} from '../types';
import { PATTERN_WORDS } from '../../planner/patternWords';
import { scheduleForRange } from './schedule';
import { PLAN_INPUTS_120 } from './planInputs';

export const PLANNER_WINDOW = { from: '2027-01-04', to: '2027-04-11', periods: 7 };
export const PLANNER_DEFAULT_SEED = 20261001;
export const PLANNER_PATTERNS = ['ROTATING_5_2', '5_ON_2_OFF', '7_ON_3_OFF'];

let draft: PlannerDraft | null = null;
let committed: PlannerPlan['lastCommitted'] = null;
let committedDraft: PlannerDraft | null = null;

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
        { ruleName: 'Week over 48 hours', count: 38 + nudge },
      ],
    },
    preferences: {
      asked: 530,
      met: 412 - nudge,
      byKind: [
        { kind: 'SHIFT_LENGTH' as const, asked: 100, met: 88 },
        { kind: 'TIME_OF_DAY' as const, asked: 230, met: 162 - nudge },
        // Nobody asked for particular days off in the demo plan (the real 120
        // plan's shape): the table must say 'none asked', not 0%.
        { kind: 'DAYS_OFF' as const, asked: 0, met: 0 },
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
      n12Officers: 38,
      n12NightShifts: 456,
      crewNote:
        'D12 and N12 are fixed separate crews; the night crew is seeded from the newest officers, so nights are not re-picked day by day.',
    },
    fteBands: {
      bands: [
        { band: 'FULL_TIME', officers: 100, targetHours: 560, plannedMin: 548, plannedAvg: 560, plannedMax: 572 },
        { band: 'PART_TIME', officers: 12, targetHours: 448, plannedMin: 392, plannedAvg: 430, plannedMax: 466 },
        { band: 'CASUAL', officers: 8, targetHours: 224, plannedMin: 96, plannedAvg: 210, plannedMax: 300 },
      ],
      note: 'Part-time and casual officers are not guaranteed hours; they fill what is left.',
    },
    warningNote:
      'At the weekend-rotation changeover an officer has one rest-day warning and one weekly-hours warning, and the changeover pay period is 72 hours.',
    qualification: {
      failingBlockDays: 346,
      checkedBlockDays: 1470,
      passes: false,
      from: '2027-01-04',
      to: '2027-04-11',
      byUnitBlock: [
        { unitCode: 'A', unitName: 'Unit A · Living unit', block: 'DAY' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'A', unitName: 'Unit A · Living unit', block: 'EVENING' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 1, checkedBlockDays: 98 },
        { unitCode: 'A', unitName: 'Unit A · Living unit', block: 'NIGHT' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 98, checkedBlockDays: 98 },
        { unitCode: 'B', unitName: 'Unit B · Living unit', block: 'DAY' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'B', unitName: 'Unit B · Living unit', block: 'EVENING' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'B', unitName: 'Unit B · Living unit', block: 'NIGHT' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 13, checkedBlockDays: 98 },
        { unitCode: 'C', unitName: 'Unit C · Living unit', block: 'DAY' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'C', unitName: 'Unit C · Living unit', block: 'EVENING' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'C', unitName: 'Unit C · Living unit', block: 'NIGHT' as const, qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 13, checkedBlockDays: 98 },
        { unitCode: 'CTL', unitName: 'Control', block: 'DAY' as const, qualification: 'CONTROL', minimum: 3, failingBlockDays: 1, checkedBlockDays: 98 },
        { unitCode: 'CTL', unitName: 'Control', block: 'EVENING' as const, qualification: 'CONTROL', minimum: 3, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'CTL', unitName: 'Control', block: 'NIGHT' as const, qualification: 'CONTROL', minimum: 3, failingBlockDays: 98, checkedBlockDays: 98 },
        { unitCode: 'ESC', unitName: 'Escort & transport', block: 'DAY' as const, qualification: 'ESCORT', minimum: 6, failingBlockDays: 24, checkedBlockDays: 98 },
        { unitCode: 'ESC', unitName: 'Escort & transport', block: 'EVENING' as const, qualification: 'ESCORT', minimum: 4, failingBlockDays: 0, checkedBlockDays: 98 },
        { unitCode: 'ESC', unitName: 'Escort & transport', block: 'NIGHT' as const, qualification: 'ESCORT', minimum: 2, failingBlockDays: 98, checkedBlockDays: 98 },
      ],
      validFromRespected: false,
      validFromNote: 'Qualification start dates are not checked: an officer with a qualification counts as qualified for the whole quarter.',
      sentence: '346 block-days are below the qualified minimum. The planner does not enforce this.',
    },
    patterns: {
      officers: [
        { employeeNo: 'E-0004', name: 'Tara Nakamura', unitCode: 'B', pattern: 'ROTATING_5_2', words: 'Rotating 5 on, 2 off (weekends rotate)' },
        { employeeNo: 'E-0007', name: 'Sam Abara', unitCode: 'CTL', pattern: '5_ON_2_OFF', words: 'Fixed 5 on, 2 off' },
        { employeeNo: 'E-0012', name: 'Ruth Okafor', unitCode: 'B', pattern: '4_ON_4_OFF', words: '4 on, 4 off' },
      ],
      note: 'Each officer keeps their own pattern: 8-hour officers use the planner’s choice, 12-hour officers the crew’s 4 on, 4 off.',
    },
    pattern8h: 'ROTATING_5_2',
    overtime: { officersOver: 18, hoursOver: 640, thresholdHours: 80 },
    generatedMs: 2400,
    quarterHours: { min: 480, avg: 512, max: 546 },
    weekends: { min: 4, avg: 7.2, max: 11 },
  };
}

/** What Generate would use now: Dataset 120's captured inputs (PR-M). */
export function plannerInputs(): PlanInputs {
  return JSON.parse(JSON.stringify(PLAN_INPUTS_120)) as PlanInputs;
}

export function plannerPlan(): PlannerPlan {
  return {
    window: PLANNER_WINDOW,
    defaultSeed: PLANNER_DEFAULT_SEED,
    patterns8h: PLANNER_PATTERNS,
    state: draft ? 'DRAFT' : committed ? 'COMMITTED' : 'NONE',
    draft,
    lastCommitted: committed,
    committedDraft,
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
    scorecard: {
      ...scorecard(seed),
      inputs: { ...plannerInputs(), options: { seed, pattern8h: pattern8h ?? null } },
    },
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
        index === 0
          ? 'No officer with Control training had enough rest'
          : index === 1
            ? // The real api's one generic reason, as PlanGenerator writes it.
              'No eligible officer left without a Block rule; a supervisor fills this'
            : null,
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
      ruleName: 'Week over 48 hours',
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
  timesOfDay: [],
  daysOff: [],
  maxDaysOff: 2,
  allowedLengths: [8, 12],
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
  myPreferences = { ...myPreferences, shiftLength: null, timesOfDay: [], daysOff: [], updatedAt: null };
}

let patternOverrides: Record<string, { pattern: OfficerPattern; words: string }> = {};

/**
 * The planner changes an 8 h officer's pattern (option C). The fixtures apply
 * the same rule the api does: a 12 h officer keeps the crew pattern.
 */
export function savePlannerPattern(employeeId: string, pattern: string): PlannerPreferenceRow {
  const row = fixturePlannerPreferences().find((entry) => entry.employeeId === employeeId);
  if (!row) throw new Error('That officer is not on the list.');
  if (!row.patternEditable) throw new Error("A 12-hour officer keeps the crew's 4 on, 4 off pattern");
  const words = PATTERN_WORDS[pattern as OfficerPattern];
  if (!words) throw new Error('That is not a pattern this planner can set.');
  patternOverrides = { ...patternOverrides, [employeeId]: { pattern: pattern as OfficerPattern, words } };
  return fixturePlannerPreferences().find((entry) => entry.employeeId === employeeId)!;
}

/** Everyone's preferences as the planner reads them; Tara has given some. */
export function fixturePlannerPreferences(): PlannerPreferenceRow[] {
  const rows: PlannerPreferenceRow[] = [
    {
      employeeId: 'emp-tara',
      name: 'Tara Nakamura',
      employeeNo: 'E-0004',
      unitName: 'Unit B · Living unit',
      seniorityDate: '2019-04-01',
      shiftLength: 8,
      timesOfDay: ['DAY'],
      daysOff: ['SAT', 'SUN'],
      maxDaysOff: 2,
      pattern: 'ROTATING_5_2',
      patternWords: 'Rotating 5 on, 2 off (weekends rotate)',
      patternEditable: true,
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
      timesOfDay: ['EVENING', 'NIGHT'],
      daysOff: ['WED'],
      maxDaysOff: 2,
      pattern: '5_ON_2_OFF',
      patternWords: 'Fixed 5 on, 2 off',
      patternEditable: true,
      inDraft: draft ? 'PARTLY' : 'NO_DRAFT',
      unmet: draft ? ['time of day: 9 night shifts'] : [],
      updatedAt: '2026-11-20T14:00:00-06:00',
    },
    {
      employeeId: 'emp-devon',
      name: 'Devon Clarke',
      employeeNo: 'E-0015',
      unitName: 'Unit A · Living unit',
      seniorityDate: '2024-02-01',
      shiftLength: 8,
      timesOfDay: ['DAY'],
      daysOff: [],
      maxDaysOff: 2,
      pattern: 'ROTATING_5_2',
      patternWords: 'Rotating 5 on, 2 off (weekends rotate)',
      patternEditable: true,
      inDraft: 'NOT_ROSTERED',
      unmet: [],
      updatedAt: null,
    },
    {
      employeeId: 'emp-ruth',
      name: 'Ruth Okafor',
      employeeNo: 'E-0012',
      unitName: 'Unit B · Living unit',
      seniorityDate: '2009-06-01',
      shiftLength: 12,
      timesOfDay: ['DAY'],
      daysOff: ['SAT', 'SUN'],
      maxDaysOff: 2,
      pattern: '4_ON_4_OFF',
      patternWords: '4 on, 4 off',
      patternEditable: false,
      inDraft: draft ? 'MET' : 'NO_DRAFT',
      unmet: [],
      updatedAt: null,
    },
  ];
  return rows.map((row) => {
    const override = patternOverrides[row.employeeId];
    return override ? { ...row, pattern: override.pattern, patternWords: override.words } : row;
  });
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
  // After a commit the open draft is gone and the committed summary answers.
  const current = draft ?? committedDraft;
  if (!current) throw new Error('no fixture draft');
  return {
    draftShifts: 4212,
    draftGaps: current.scorecard.coverage.shortBlockDays,
    draftStatus: 'DRAFT',
    basis: 'The draft is compared with the plan already on the board.',
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
  committedDraft = { ...current, status: 'COMMITTED' };
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
  patternOverrides = {};
  draft = null;
  committed = null;
  committedDraft = null;
  myPreferences = {
    shiftLength: null,
    timesOfDay: [],
    daysOff: [],
    maxDaysOff: 2,
    allowedLengths: [8, 12],
    updatedAt: null,
  };
}
