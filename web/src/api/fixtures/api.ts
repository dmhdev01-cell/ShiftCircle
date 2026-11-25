/**
 * The fixture implementation of the API.
 *
 * It answers with the same types the real api answers with, so the planning
 * board can be built and demoed before `GET /schedule` exists. When the real
 * api lands, `web/src/api/client.ts` switches to the HTTP implementation and
 * nothing else changes.
 */

import { ApiError } from '../http';
import { getSessionUser } from '../session';
import type {
  AssignmentChangeResult,
  AuditPage,
  AuditQuery,
  BuildReport,
  CoverageReport,
  DemoUser,
  MockLoginResult,
  MyPreferencesInput,
  DemoResetStatus,
  HoursReport,
  MyOffer,
  MyProposal,
  MySchedulePayload,
  ProposalDecisionInput,
  ProposalDetail,
  ProposalInboxCard,
  ProposalInboxQuery,
  ProposalItemInput,
  ProposalPreview,
  OvertimeReport,
  OverrideRow,
  PayPeriod,
  PublishedPeriod,
  RecordActualInput,
  RecordActualResult,
  TimeEntry,
  Unit,
  OfferRecord,
  OfferResponse,
  OpenShift,
  OpenShiftCandidates,
  OpenShiftQuery,
  ReportQuery,
  RuleCheckChange,
  RuleCheckOutcome,
  RuleCheckRequest,
  RuleResult,
  RuleSetVersion,
  RuleTable,
  RuleTableRow,
  SaveOutcome,
  SaveRequest,
  SchedulePayload,
  ScheduleQuery,
  ShiftCircleApi,
  PlannedAbsence,
  PlannedAbsenceInput,
  PlannerDraftCreation,
  PlanOptions,
} from '../types';

import {
  BLOCKED_BY_RULES,
  MISSING_ACTUALS,
  WARNINGS_NEED_ACKNOWLEDGEMENT,
} from '../types';
import { demoMyOffers, demoMySchedule, resetMyOffers } from './mySchedule';
import {
  myProposalsFixture,
  previewProposalFixture,
  resetMyProposals,
  submitProposalFixture,
  withdrawProposalFixture,
} from './proposals';
import {
  decideProposalFixture,
  proposalCountFixture,
  proposalDetailFixture,
  proposalInboxFixture,
  resetProposalInbox,
} from './proposalInbox';
import {
  demoCandidates,
  demoOfferHistory,
  demoOpenShifts,
  recordedOffers,
  resetOfferHistory,
} from './overtime';
import {
  demoCoverageReport,
  demoHoursReport,
  demoOvertimeReport,
  demoOverrides,
} from './reports';
import { demoAuditEvents } from './audit';
import { demoUsers } from './demoUsers';
import { demoDisplayToday } from './display';
import { toDisplayToday } from '../../display/displayPayload';
import { demoBuildReport, demoRuleSets, demoRuleTables } from './rules';
import {
  changedAfterPublish,
  demoSchedule,
  DEMO_PERIOD_ID,
  fixturePeriod,
  PC01_CHANGE,
  scheduleForRange,
  shift,
} from './schedule';
import {
  commitPlannerDraft,
  discardPlannerDraft,
  generatePlannerDraft,
  plannerCommitPreview,
  plannerCompare,
  plannerCoverage,
  plannerSchedule,
  clearMyPreferences,
  fixtureMyPreferences,
  fixturePlannerPreferences,
  saveMyPreferences,
  plannerDraft,
  plannerGaps,
  plannerInputs,
  plannerPlan,
  plannerWarnings,
  resetPlannerFixtures,
  savePlannerPattern,
} from './planner';
import {
  addUnitClosure,
  fixtureFlaggedShifts,
  fixturePlannerUnits,
  fixtureStaffing,
  previewUnitClosure,
  removeUnitClosure,
  setLeaveAllowanceFixture,
  setUnitAllocation,
  updateUnitClosure,
} from './plannerUnits';
import { demoPayPeriods, demoTimeEntries, unitCodeFor } from './timeAttendance';

/**
 * Planned leave entered in fixtures mode (POST /planner/absences): one row per
 * officer and date, the same idempotent / 409 answers as the api, and shown
 * on the draft roster as ABSENCE items like the api's draft schedule.
 */
const plannedAbsences = new Map<string, PlannedAbsence>();

function recordPlannedAbsence(input: PlannedAbsenceInput): PlannedAbsence {
  if (!['SICK', 'VACATION', 'OTHER'].includes(input.type)) {
    throw new ApiError('type must be SICK, VACATION or OTHER', 400);
  }
  const key = `${input.employeeId}|${input.date}`;
  const existing = plannedAbsences.get(key);
  if (existing) {
    if (existing.type === input.type) return existing;
    throw new ApiError(
      `An absence of type ${existing.type} is already recorded for that date; reset or correct it first`,
      409,
    );
  }
  const saved: PlannedAbsence = { ...input, id: `planned-absence-${plannedAbsences.size + 1}` };
  plannedAbsences.set(key, saved);
  return saved;
}

function withPlannedLeave(payload: SchedulePayload): SchedulePayload {
  if (plannedAbsences.size === 0) return payload;
  return {
    ...payload,
    officers: payload.officers.map((officer) => ({
      ...officer,
      cells: officer.cells.map((cell) => {
        const leave = plannedAbsences.get(`${officer.employeeId}|${cell.date}`);
        return leave
          ? { ...cell, items: [...cell.items, { type: 'ABSENCE' as const, absenceType: leave.type }] }
          : cell;
      }),
    })),
  };
}

/**
 * How long a fixture call takes to answer, so a screen can show its loading
 * state in the demo. The tests build the fixtures with no delay
 * (`VITE_FIXTURE_LATENCY_MS=0` in `vite.config.ts`): a real timer in a test is a
 * wait whose length the test does not control, and a shared build machine makes
 * those longer than the suite's timeouts.
 */
const DEMO_LATENCY_MS = 120;

/** The delay the demo uses, unless the build sets one (the tests set 0). */
function fixtureLatencyMs(): number {
  const configured = import.meta.env.VITE_FIXTURE_LATENCY_MS;
  const ms = configured === undefined || configured === '' ? NaN : Number(configured);
  return Number.isFinite(ms) ? Math.max(0, ms) : DEMO_LATENCY_MS;
}

/** When the demo fixture published the period (the demo clock has no time of day). */
const DEMO_PUBLISHED_AT = '2026-11-19T09:00:00-06:00';

/**
 * A change to a shift of a published period is a change the officers have not
 * seen yet, so the board counts it (docs/07 §4.2).
 */
function countUnpublishedChange(assignmentId: string) {
  if (!demoSchedule.publishedState.published) return;
  changedAfterPublish.add(assignmentId);
  demoSchedule.publishedState = {
    published: true,
    unpublishedChanges: changedAfterPublish.size,
  };
}

/** The officer, day cell and item for a rostered shift in the fixture schedule. */
function findShift(assignmentId: string) {
  for (const officer of demoSchedule.officers) {
    for (const cell of officer.cells) {
      const item = cell.items.find(
        (entry) => entry.type === 'SHIFT' && entry.assignmentId === assignmentId,
      );
      if (item?.type === 'SHIFT') {
        return { officer, cell, item };
      }
    }
  }
  return null;
}
const RULE_SET_VERSION = 7;
const RULE_SET_PUBLISHED_AT = '13:50';

function wait(ms: number): Promise<void> {
  // No timer at all for a zero delay: a promise that is already resolved is
  // deterministic on any machine, a 0 ms timer is still a timer.
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** PC-01: the rule results the api documents for the blocked proposal. */
const PC01_RESULTS: RuleResult[] = [
  {
    ruleCode: 'U-01',
    ruleTable: 'REST',
    outcome: 'BLOCK',
    overridePolicy: 'EMERGENCY',
    message:
      "Only 7 hours' rest after the 12 h shift ending Fri 24:00. The minimum is 8 consecutive hours in any 24 hours.",
    facts: { restHours: 7, minHours: 8 },
    evidence: [{ label: 'Fri 20 P12 12:00–24:00' }],
    source: 'Saskatchewan Employment Act',
  },
  {
    ruleCode: 'U-05',
    ruleTable: 'MAX_HOURS',
    outcome: 'BLOCK',
    overridePolicy: 'EMERGENCY',
    message: '17 hours of work in 24 hours (Fri 12:00 – Sat 12:00).',
    facts: { hours: 17, maxHours: 16 },
  },
  {
    ruleCode: 'U-14',
    ruleTable: 'MAX_HOURS',
    outcome: 'BLOCK',
    overridePolicy: 'ACKNOWLEDGE',
    message: 'Weekly hours above the 48-hour warning level or the 60-hour ceiling.',
    facts: { hours: 61, maxHours: 60 },
  },
];

/**
 * A proposal the rules block: an A12 the day after a P12 leaves no rest
 * (docs/ui/build-notes.md 1.4).
 */
const ZERO_REST_RESULTS: RuleResult[] = [
  {
    ruleCode: 'U-01',
    ruleTable: 'REST',
    outcome: 'BLOCK',
    overridePolicy: 'EMERGENCY',
    message:
      'No rest after the 12 h shift that ends Wed 25 Nov 24:00. The minimum is 8 consecutive hours in any 24 hours.',
    facts: { restHours: 0, minHours: 8 },
    source: 'Saskatchewan Employment Act',
  },
];

const WARN_ONLY_RESULTS: RuleResult[] = [
  {
    ruleCode: 'U-14',
    ruleTable: 'MAX_HOURS',
    outcome: 'WARN',
    overridePolicy: 'ACKNOWLEDGE',
    message: '52 hours this week, over the 48 h warning level.',
  },
];

function isPc01(change: RuleCheckChange): boolean {
  return (
    change.type === 'ASSIGN' &&
    change.employeeId === PC01_CHANGE.employeeId &&
    change.shiftTemplate === PC01_CHANGE.shiftTemplate &&
    change.startAt === PC01_CHANGE.startAt
  );
}

/** An A12 the day after a P12: no rest, so the rules block it. */
function isZeroRest(change: RuleCheckChange): boolean {
  return (
    change.type === 'ASSIGN' &&
    change.employeeId === 'emp-sam' &&
    change.shiftTemplate === 'A12' &&
    change.startAt === '2026-11-26T00:00:00-06:00'
  );
}

/** A change that only warns, so the acknowledge flow can be exercised. */
function isWarnOnly(change: RuleCheckChange): boolean {
  if (change.type !== 'ASSIGN') return false;
  // Tara is eligible with a warning, so the acknowledge path can be exercised
  // with a candidate the supervisor can actually pick.
  if (change.employeeId === 'emp-tara') return true;
  return change.employeeId === 'emp-aiden' && change.startAt === '2026-11-22T07:00:00-06:00';
}

function evaluate(request: RuleCheckRequest): RuleCheckOutcome {
  const base = {
    ruleSetVersion: RULE_SET_VERSION,
    overridable: true,
    passedRules: 9,
    publishedAt: RULE_SET_PUBLISHED_AT,
  };

  if (isPc01(request.change)) {
    // PC-01 matches the real api: U-01 is an emergency block, U-14 is a block
    // whose policy is ACKNOWLEDGE, so the change cannot be overridden.
    return { ...base, overridable: false, outcome: 'BLOCK', ruleResults: PC01_RESULTS };
  }

  if (isZeroRest(request.change)) {
    return { ...base, outcome: 'BLOCK', ruleResults: ZERO_REST_RESULTS };
  }

  if (isWarnOnly(request.change)) {
    return { ...base, outcome: 'WARN', ruleResults: WARN_ONLY_RESULTS, passedRules: 11 };
  }

  return {
    ...base,
    outcome: 'PASS',
    passedRules: 12,
    ruleResults: [
      {
        ruleCode: 'U-01',
        ruleTable: 'REST',
        outcome: 'PASS',
        overridePolicy: 'EMERGENCY',
        message:
          '12 hours of rest after the previous shift. The minimum is 8 consecutive hours in any 24 hours.',
        facts: { restHours: 12, minHours: 8 },
      },
    ],
  };
}

/** The hours of a scheduled shift. */
function shiftHours(entry: TimeEntry): number {
  return Math.round(
    (new Date(entry.endAt).getTime() - new Date(entry.startAt).getTime()) / 3_600_000,
  );
}

let assignmentCounter = 0;
let plannerEditCount = 0;
let plannerEditedIds: string[] = [];

/**
 * Put the fixtures back, so one test cannot change what the next one sees.
 */
let resetStatus: DemoResetStatus = {
  state: 'IDLE',
  step: null,
  startedAt: null,
  elapsedMs: 0,
  checksum: null,
  dataset: '100',
  error: null,
};

export function resetFixtures(): void {
  assignmentCounter = 0;
  resetStatus = { state: 'IDLE', step: null, startedAt: null, elapsedMs: 0, checksum: null, dataset: '100', error: null };
  resetOfferHistory();
  resetMyOffers();
  resetMyProposals();
  resetProposalInbox();
  resetPlannerFixtures();
  demoRuleSets.forEach((entry) => {
    entry.status =
      entry.version === 7 ? 'LIVE' : entry.version === 8 ? 'DRAFT' : ('PUBLISHED' as const);
    entry.live = entry.version === 7;
    entry.approvedBy = undefined;
    entry.approvedAt = undefined;
    entry.publishedAt = entry.version === 7 ? '20 Nov 13:50' : undefined;
  });
}

function draftEditResult(assignmentId: string) {
  const draft = plannerDraft();
  return {
    draftId: draft.id,
    assignmentId,
    version: draft.version + plannerEditCount,
    handEdits: plannerEditCount,
    editedAssignmentIds: plannerEditedIds,
    scorecard: draft.scorecard,
    warnings: plannerWarnings(),
    warningCount: draft.scorecard.warnings.total,
    gaps: plannerGaps(),
  };
}

export function createFixtureApi(latencyMs: number = fixtureLatencyMs()): ShiftCircleApi {
  /** The fixture's answer delay; 0 in the tests, so no test waits on a clock. */
  const pause = () => wait(latencyMs);

  return {
    async getSchedule(query: ScheduleQuery): Promise<SchedulePayload> {
      await pause();
      // The api answers the range it is asked for, with the roster week that
      // covers it.
      return scheduleForRange(query.from, query.to);
    },

    async previewRuleCheck(request: RuleCheckRequest): Promise<RuleCheckOutcome> {
      await pause();
      return evaluate(request);
    },

    async saveChange(request: SaveRequest): Promise<SaveOutcome> {
      await pause();
      const outcome = evaluate({
        change: request.change,
        ...(request.acknowledgeWarnings ? { acknowledgeWarnings: request.acknowledgeWarnings } : {}),
        ...(request.override ? { override: request.override } : {}),
      });

      const blocking = outcome.ruleResults.filter((result) => result.outcome === 'BLOCK');
      if (blocking.length > 0) {
        throw new ApiError('This change breaks 2 rules', 422, {
          type: BLOCKED_BY_RULES,
          title: `This change breaks ${blocking.length} rules`,
          status: 422,
          outcome: 'BLOCK',
          ruleSetVersion: outcome.ruleSetVersion,
          overridable: outcome.overridable,
          ruleResults: outcome.ruleResults,
        });
      }

      const warnings = outcome.ruleResults.filter((result) => result.outcome === 'WARN');
      const acknowledged = new Set(request.acknowledgeWarnings ?? []);
      const unacknowledged = warnings.filter((result) => !acknowledged.has(result.ruleCode));
      // Warnings always have to be acknowledged, including when the change is
      // saved with an emergency override: the api refuses the save otherwise.
      if (unacknowledged.length > 0) {
        throw new ApiError('The warnings need acknowledging', 422, {
          type: WARNINGS_NEED_ACKNOWLEDGEMENT,
          title: 'The warnings need acknowledging',
          status: 422,
          outcome: 'WARN',
          ruleSetVersion: outcome.ruleSetVersion,
          overridable: outcome.overridable,
          ruleResults: outcome.ruleResults,
        });
      }

      assignmentCounter += 1;
      return { assignmentId: `a-fixture-${assignmentCounter}`, ruleOutcome: outcome };
    },

    async moveAssignment(
      assignmentId: string,
      version: number,
      request: SaveRequest,
    ): Promise<AssignmentChangeResult> {
      await pause();
      if (version === undefined || version === null) {
        throw new ApiError('Send the version you read, as If-Match: "3".', 428, {
          type: 'https://shiftcircle.local/problems/if-match-required',
          title: 'If-Match is required',
          status: 428,
          detail: 'Send the version you read, as If-Match: "3".',
        });
      }
      const found = findShift(assignmentId);
      if (!found) {
        throw new ApiError('That shift is not in the fixture.', 404);
      }
      if (found.item.version !== version) {
        throw new ApiError('This shift changed since the board loaded. Reload the board.', 412, {
          type: 'https://shiftcircle.local/problems/stale-version',
          title: 'Stale version',
          status: 412,
          detail: 'This shift changed since the board loaded. Reload the board.',
        });
      }
      if (request.change.employeeId !== found.officer.employeeId) {
        throw new ApiError('The demo fixture can only move a shift within its officer.', 400);
      }
      const date = request.change.startAt.slice(0, 10);
      const target = found.officer.cells.find((cell) => cell.date === date);
      if (!target) {
        throw new ApiError('The demo fixture only moves within the visible week.', 400);
      }
      found.cell.items = found.cell.items.filter(
        (entry) => !(entry.type === 'SHIFT' && entry.assignmentId === assignmentId),
      );
      const moved = shift(assignmentId, request.change.shiftTemplate, date, {
        kind: found.item.kind,
        worked: false,
        offer: found.item.offer,
        proposed: found.item.proposed,
      });
      moved.version = version + 1;
      target.items.push(moved);
      countUnpublishedChange(assignmentId);
      return { id: assignmentId, status: 'PLANNED', version: version + 1 };
    },

    async cancelAssignment(
      assignmentId: string,
      version: number,
      reason: string,
    ): Promise<AssignmentChangeResult> {
      await pause();
      if (reason === undefined || reason === null || reason.trim().length < 10) {
        throw new ApiError('reason is required and must be at least 10 characters', 400, {
          type: 'https://shiftcircle.local/problems/400',
          title: 'Bad request',
          status: 400,
          detail: 'reason is required and must be at least 10 characters',
        });
      }
      const found = findShift(assignmentId);
      if (!found) {
        throw new ApiError('That shift is not in the fixture.', 404);
      }
      if (found.item.version !== version) {
        throw new ApiError('This shift changed since the board loaded. Reload the board.', 412, {
          type: 'https://shiftcircle.local/problems/stale-version',
          title: 'Stale version',
          status: 412,
          detail: 'This shift changed since the board loaded. Reload the board.',
        });
      }
      found.cell.items = found.cell.items.filter(
        (entry) => !(entry.type === 'SHIFT' && entry.assignmentId === assignmentId),
      );
      countUnpublishedChange(assignmentId);
      return { id: assignmentId, status: 'CANCELLED', version: version + 1 };
    },

    async getPlannerPlan() {
      await pause();
      return plannerPlan();
    },

    async getPlannerInputs(options?: PlanOptions) {
      await pause();
      const inputs = plannerInputs();
      return options ? { ...inputs, options: { ...inputs.options, ...options } } : inputs;
    },

    async createPlannerDraft(body: PlannerDraftCreation) {
      await pause();
      plannerEditCount = 0;
      plannerEditedIds = [];
      return generatePlannerDraft(body.seed, body.pattern8h, body);
    },

    async getPlannerDraft() {
      await pause();
      return plannerDraft();
    },

    async getPlannerGaps() {
      await pause();
      return plannerGaps();
    },

    async getPlannerWarnings() {
      await pause();
      return plannerWarnings();
    },

    async getPlannerSchedule(_draftId: string, query: { unitId: string; from: string; to: string }) {
      await pause();
      return withPlannedLeave(plannerSchedule(query));
    },

    async planAbsence(input: PlannedAbsenceInput) {
      await pause();
      return recordPlannedAbsence(input);
    },

    async getPlannerCoverage(_draftId: string, range: { from: string; to: string }) {
      await pause();
      return plannerCoverage(range);
    },

    async previewPlannerAssignment() {
      await pause();
      return { outcome: 'PASS' as const, ruleSetVersion: 3, overridable: false, ruleResults: [] };
    },

    async addPlannerAssignment(_draftId: string, _version: number) {
      await pause();
      plannerEditCount += 1;
      const assignmentId = `draft-edit-${plannerEditCount}`;
      plannerEditedIds = [...plannerEditedIds, assignmentId];
      return draftEditResult(assignmentId);
    },

    async updatePlannerAssignment(_draftId: string, assignmentId: string) {
      await pause();
      plannerEditCount += 1;
      if (!plannerEditedIds.includes(assignmentId)) {
        plannerEditedIds = [...plannerEditedIds, assignmentId];
      }
      return draftEditResult(assignmentId);
    },

    async removePlannerAssignment(_draftId: string, assignmentId: string) {
      await pause();
      plannerEditCount += 1;
      return draftEditResult(assignmentId);
    },

    async resetDemo(_confirm: string, dataset: string) {
      await pause();
      plannedAbsences.clear();
      resetStatus = {
        state: 'DONE',
        step: 'done',
        startedAt: '2026-11-21T10:00:00-06:00',
        elapsedMs: 19800,
        checksum: '3390148255db715844c4df90f553ae342530417621539b23499f638c5b126539',
        dataset,
        error: null,
      };
      return resetStatus;
    },

    async getDemoResetStatus() {
      await pause();
      return resetStatus;
    },

    async getAuditActors() {
      await pause();
      return [
        { username: 'm.ellis', displayName: 'M. Ellis' },
        { username: 'p.singh', displayName: 'P. Singh' },
        { username: 'a.reviewer', displayName: 'A. Reviewer' },
      ];
    },

    async getMyPreferences() {
      await pause();
      return fixtureMyPreferences();
    },

    async putMyPreferences(input: MyPreferencesInput) {
      await pause();
      return saveMyPreferences(input);
    },

    async deleteMyPreferences() {
      await pause();
      clearMyPreferences();
    },

    async getPlannerPreferences() {
      await pause();
      return fixturePlannerPreferences();
    },

    async getPlannerUnits() {
      await pause();
      return fixturePlannerUnits();
    },
    async addUnitClosure(unitId: string, input: { closedFrom: string; reopensOn?: string | null; reason: string }) {
      await pause();
      return addUnitClosure(unitId, input);
    },
    async updateUnitClosure(unitId: string, closureId: string, input: { closedFrom?: string; reopensOn?: string | null; reason: string }) {
      await pause();
      return updateUnitClosure(unitId, closureId, input);
    },
    async removeUnitClosure(unitId: string, closureId: string) {
      await pause();
      removeUnitClosure(unitId, closureId);
    },
    async previewUnitClosure(unitId: string, input: { closedFrom: string; reopensOn?: string | null }) {
      await pause();
      return previewUnitClosure(unitId, input);
    },
    async getFlaggedShifts() {
      await pause();
      return fixtureFlaggedShifts();
    },
    async getStaffing() {
      await pause();
      return fixtureStaffing();
    },
    async setUnitAllocation(unitId: string, allocated: number, reason: string) {
      await pause();
      return setUnitAllocation(unitId, allocated, reason);
    },
    async setLeaveAllowance(percent: number, reason: string) {
      await pause();
      return setLeaveAllowanceFixture(percent, reason);
    },
    async setPlannerOfficerPattern(employeeId: string, pattern: string) {
      await pause();
      try {
        return savePlannerPattern(employeeId, pattern);
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : 'The pattern could not be set.', 400);
      }
    },

    async getPlannerCompare() {
      await pause();
      return plannerCompare();
    },

    async getPlannerCommitPreview() {
      await pause();
      return plannerCommitPreview();
    },

    async commitPlannerDraft() {
      await pause();
      return commitPlannerDraft();
    },

    async discardPlannerDraft() {
      await pause();
      discardPlannerDraft();
    },

    async publishSchedulePeriod(periodId: string): Promise<PublishedPeriod> {
      await pause();
      const period = fixturePeriod(periodId);
      if (!period) {
        throw new ApiError('That period is not in the demo fixture.', 404);
      }
      if (period.status === 'PUBLISHED') {
        throw new ApiError('This period is already published.', 409, {
          type: 'https://shiftcircle.local/problems/already-published',
          title: 'This period is already published',
          status: 409,
          detail: 'This period is already published.',
        });
      }
      period.status = 'PUBLISHED';
      if (period.id === DEMO_PERIOD_ID) {
        // The demo week keeps the count of the changes since it was published.
        demoSchedule.publishedState = { published: true, unpublishedChanges: 0 };
      }
      return { id: period.id, status: 'PUBLISHED', publishedAt: DEMO_PUBLISHED_AT };
    },

    async getOpenShifts(query: OpenShiftQuery): Promise<OpenShift[]> {
      await pause();
      const from = query.from ?? '0000-01-01';
      const to = query.to ?? '9999-12-31';
      return demoOpenShifts.filter(
        (shift) =>
          shift.date >= from &&
          shift.date <= to &&
          (!query.unitId || shift.unit.id === query.unitId) &&
          (!query.status || shift.status === query.status),
      );
    },

    async getOpenShiftCandidates(openShiftId: string): Promise<OpenShiftCandidates> {
      await pause();
      const openShift = demoOpenShifts.find((shift) => shift.id === openShiftId);
      if (!openShift) {
        throw new ApiError('That open shift is not in the fixture.', 404);
      }
      const recorded = recordedOffers
        .filter((offer) => offer.openShiftId === openShiftId)
        .map((offer) => ({
          id: offer.offerId,
          at: offer.at,
          employeeId: offer.employeeId,
          employeeName: offer.employeeName,
          status: offer.status,
        }));
      return {
        openShift,
        candidates: demoCandidates,
        ruleSetVersion: RULE_SET_VERSION,
        rankingNote:
          'Fewest overtime hours this quarter first, then seniority. Officers who would break a Block rule are skipped without losing their place.',
        history: [...demoOfferHistory, ...recorded],
      };
    },

    async createOffers(openShiftId: string, employeeIds: string[]): Promise<OfferRecord[]> {
      await pause();
      const openShift = demoOpenShifts.find((shift) => shift.id === openShiftId);
      if (!openShift) {
        throw new ApiError('That open shift is not in the fixture.', 404);
      }
      // Only a supervisor may offer overtime (S-04). This is the supervisor's
      // session, so the offers are recorded for the officer to answer (E2).
      return employeeIds.map((employeeId) => {
        const candidate = demoCandidates.find((entry) => entry.employeeId === employeeId);
        const employeeName = candidate?.name ?? employeeId;
        const offerId = `offer-${openShift.id}-${employeeId}`;

        const existing = demoMyOffers.find((offer) => offer.id === offerId);
        // A real instant, so the new offer sorts first on My schedule (the
        // seeded offers carry clock times that do not parse; review S3).
        const offeredAt = new Date().toISOString();
        if (existing) {
          existing.status = 'OFFERED';
          existing.offeredAt = offeredAt;
        } else {
          demoMyOffers.push({
            id: offerId,
            openShift,
            offeredBy: 'M. Ellis',
            offeredAt,
            eligibility: candidate?.eligibility ?? 'ELIGIBLE',
            ...(candidate?.reason ? { reason: candidate.reason } : {}),
            status: 'OFFERED',
          });
        }

        const recorded = recordedOffers.find((offer) => offer.offerId === offerId);
        if (recorded) {
          recorded.status = 'OFFERED';
        } else {
          recordedOffers.push({
            id: offerId,
            offerId,
            openShiftId: openShift.id,
            at: 'now',
            employeeId,
            employeeName,
            status: 'OFFERED',
          });
        }

        return {
          id: offerId,
          at: 'now',
          employeeId,
          employeeName,
          status: 'OFFERED' as const,
        };
      });
    },

    async confirmOffer(offerId: string): Promise<OfferRecord> {
      await pause();
      // The history row carries no offer id in the browser contract, so the
      // screen hands back the employee id; accept either.
      const recorded = recordedOffers.find(
        (entry) => entry.offerId === offerId || entry.employeeId === offerId,
      );
      if (recorded) {
        recorded.status = 'CONFIRMED';
        return {
          id: recorded.offerId,
          at: recorded.at,
          employeeId: recorded.employeeId,
          employeeName: recorded.employeeName,
          status: 'CONFIRMED',
        };
      }
      const offer = demoOfferHistory.find((entry) => entry.employeeId === offerId);
      if (!offer) {
        throw new ApiError('That offer is not in the fixture.', 404);
      }
      // Only a supervisor confirms an accepted offer (S-04).
      offer.status = 'CONFIRMED';
      return { ...offer, status: 'CONFIRMED' };
    },

    async assignOpenShift(openShiftId: string, employeeId: string): Promise<SaveOutcome> {
      await pause();
      if (!demoOpenShifts.some((shift) => shift.id === openShiftId)) {
        throw new ApiError('That open shift is not in the fixture.', 404);
      }
      const candidate = demoCandidates.find((entry) => entry.employeeId === employeeId);
      if (!candidate) {
        throw new ApiError('That officer is not in the fixture.', 404);
      }
      const outcome: RuleCheckOutcome = {
        outcome: candidate.eligibility === 'WARN' ? 'WARN' : 'PASS',
        ruleSetVersion: RULE_SET_VERSION,
        overridable: true,
        ruleResults: [],
        passedRules: 12,
      };
      assignmentCounter += 1;
      return { assignmentId: `a-fixture-${assignmentCounter}`, ruleOutcome: outcome };
    },

    async getMySchedule(query: ScheduleQuery): Promise<MySchedulePayload> {
      await pause();
      const from = query.from ?? '0000-01-01';
      const to = query.to ?? '9999-12-31';
      const days = demoMySchedule.days.filter((day) => day >= from && day <= to);
      return {
        ...demoMySchedule,
        days,
        shifts: demoMySchedule.shifts.filter((shift) => days.includes(shift.date)),
      };
    },

    async getMyOffers(): Promise<MyOffer[]> {
      await pause();
      return demoMyOffers;
    },

    async respondToOffer(offerId: string, response: OfferResponse): Promise<MyOffer> {
      await pause();
      const offer = demoMyOffers.find((entry) => entry.id === offerId);
      if (!offer) {
        throw new ApiError('That offer is not in the fixture.', 404);
      }
      // Accepting re-checks the rules; the supervisor confirms afterwards. The
      // same answer shows on the supervisor's board (E2).
      const status = response === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
      offer.status = status;
      const recorded = recordedOffers.find((entry) => entry.offerId === offerId);
      if (recorded) {
        recorded.status = status;
      }
      return { ...offer, status };
    },

    async previewProposal(items: ProposalItemInput[]): Promise<ProposalPreview> {
      await pause();
      return previewProposalFixture(items, evaluate);
    },

    async submitProposal(note: string, items: ProposalItemInput[]): Promise<MyProposal> {
      await pause();
      return submitProposalFixture(note, items, evaluate);
    },

    async getMyProposals(): Promise<MyProposal[]> {
      await pause();
      return myProposalsFixture();
    },

    async withdrawProposal(proposalId: string, version: number): Promise<MyProposal> {
      await pause();
      return withdrawProposalFixture(proposalId, version);
    },

    async getProposalInbox(query: ProposalInboxQuery): Promise<ProposalInboxCard[]> {
      await pause();
      return proposalInboxFixture(query);
    },

    async getProposalCount(): Promise<number> {
      await pause();
      return proposalCountFixture();
    },

    async getProposal(proposalId: string): Promise<ProposalDetail> {
      await pause();
      return proposalDetailFixture(proposalId);
    },

    async decideProposal(
      proposalId: string,
      version: number,
      items: ProposalDecisionInput[],
    ): Promise<ProposalDetail> {
      await pause();
      return decideProposalFixture(proposalId, version, items);
    },

    async getAuditEvents(query: AuditQuery): Promise<AuditPage> {
      await pause();
      let items = demoAuditEvents;
      if (query.actor) {
        items = items.filter((entry) => entry.actor?.username === query.actor);
      }
      if (query.action) {
        items = items.filter((entry) => entry.action === query.action);
      }
      if (query.entityType) {
        items = items.filter((entry) => entry.entityType === query.entityType);
      }
      if (query.entityId) {
        items = items.filter((entry) => entry.entityId === query.entityId);
      }
      const localDate = (occurredAt: string) =>
        new Intl.DateTimeFormat('en-CA', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          timeZone: 'America/Regina',
        }).format(new Date(occurredAt));
      if (query.from) {
        items = items.filter((entry) => localDate(entry.occurredAt) >= query.from!);
      }
      if (query.to) {
        items = items.filter((entry) => localDate(entry.occurredAt) <= query.to!);
      }
      if (query.beforeId !== undefined) {
        items = items.filter((entry) => entry.id < query.beforeId!);
      }
      const limit = query.limit ?? 50;
      const page = items.slice(0, limit);
      return {
        items: page,
        nextBeforeId: items.length > limit ? page[page.length - 1].id : null,
      };
    },

    async getUnits(): Promise<Unit[]> {
      await pause();
      return [
        {
          id: demoSchedule.unit.id,
          code: 'B',
          name: demoSchedule.unit.name,
          kind: 'LIVING',
          allows_12h: true,
          allows_16h: true,
        },
      ];
    },

    async getDisplayToday() {
      await pause();
      // Through the same whitelist as the http client.
      return toDisplayToday(demoDisplayToday(getSessionUser()));
    },

    async getDemoUsers(): Promise<DemoUser[]> {
      await pause();
      return demoUsers;
    },

    async mockLogin(userId: string): Promise<MockLoginResult> {
      await pause();
      const user = demoUsers.find((entry) => entry.id === userId);
      if (!user) {
        throw new ApiError('That user is not in the fixture.', 404);
      }
      return {
        token: `fixture-token-${user.id}`,
        expiresAt: '2026-11-20T12:00:00Z',
        user,
      };
    },

    async getRuleSets(): Promise<RuleSetVersion[]> {
      await pause();
      return demoRuleSets;
    },

    async createRuleSetDraft(_basedOn: number, reason: string): Promise<RuleSetVersion> {
      await pause();
      const next = Math.max(...demoRuleSets.map((entry) => entry.version)) + 1;
      const draft: RuleSetVersion = {
        version: next,
        status: 'DRAFT',
        live: false,
        createdBy: 'L. Fraser',
        createdAt: 'now',
        reason,
      };
      demoRuleSets.push(draft);
      return draft;
    },

    async getRuleTable(_version: number, code: string): Promise<RuleTable> {
      await pause();
      const table = demoRuleTables.find((entry) => entry.code === code);
      if (!table) {
        throw new ApiError('That rule table is not in the fixture.', 404);
      }
      return table;
    },

    async saveRuleRows(_version: number, code: string, rows: RuleTableRow[]): Promise<RuleTable> {
      await pause();
      const table = demoRuleTables.find((entry) => entry.code === code);
      if (!table) {
        throw new ApiError('That rule table is not in the fixture.', 404);
      }
      table.rows = rows;
      table.changed = rows.filter((row) => row.enabled).length;
      return table;
    },

    async buildRuleSet(_version?: number): Promise<BuildReport> {
      await pause();
      return demoBuildReport;
    },

    async submitRuleSet(version: number): Promise<RuleSetVersion> {
      await pause();
      const ruleSet = demoRuleSets.find((entry) => entry.version === version);
      if (!ruleSet) {
        throw new ApiError('That rule set is not in the fixture.', 404);
      }
      ruleSet.status = 'SUBMITTED';
      return ruleSet;
    },

    async approveRuleSet(version: number): Promise<RuleSetVersion> {
      await pause();
      const ruleSet = demoRuleSets.find((entry) => entry.version === version);
      if (!ruleSet) {
        throw new ApiError('That rule set is not in the fixture.', 404);
      }
      // The person who edited the change cannot approve it (maker/checker).
      // It is about the signed-in identity, not about who created it: another
      // approver must be able to approve an L. Fraser draft.
      const actor = getSessionUser();
      if (actor && actor.displayName === ruleSet.createdBy) {
        throw new ApiError('You created this version. Another approver must review it.', 403);
      }
      ruleSet.status = 'APPROVED';
      ruleSet.approvedBy = 'P. Singh';
      ruleSet.approvedAt = 'now';
      return ruleSet;
    },

    async publishRuleSet(version: number, effectiveDate: string): Promise<RuleSetVersion> {
      await pause();
      const ruleSet = demoRuleSets.find((entry) => entry.version === version);
      if (!ruleSet) {
        throw new ApiError('That rule set is not in the fixture.', 404);
      }
      ruleSet.status = 'PUBLISHED';
      ruleSet.publishedAt = effectiveDate;
      demoRuleSets.forEach((entry) => {
        entry.live = entry.version === version;
      });
      return ruleSet;
    },

    async getCoverageReport(): Promise<CoverageReport> {
      await pause();
      return demoCoverageReport;
    },

    async getHoursReport(query?: ReportQuery): Promise<HoursReport> {
      await pause();
      if (!query?.position) return demoHoursReport;
      // Release v1.3 S7: one rank, like the api's ?position=.
      const rows = demoHoursReport.rows.filter((row) => (row.position ?? 'CO') === query.position);
      return { ...demoHoursReport, rows, totalOfficers: rows.length };
    },

    async getOvertimeReport(query?: ReportQuery): Promise<OvertimeReport> {
      await pause();
      if (!query?.position) return demoOvertimeReport;
      // Like the api, the average is the chosen rank's pool: nobody in it, no average (review N2).
      const rows = demoOvertimeReport.rows.filter((row) => (row.position ?? 'CO') === query.position);
      return { ...demoOvertimeReport, rows, averageHours: rows.length === 0 ? 0 : demoOvertimeReport.averageHours };
    },

    async getOverrides(): Promise<OverrideRow[]> {
      await pause();
      return demoOverrides;
    },

    async exportReportCsv(
      report: 'coverage' | 'hours' | 'overtime' | 'overrides',
    ): Promise<{ fileName: string; content: string }> {
      await pause();
      if (report === 'hours') {
        const lines = [
          'employee_id,name,scheduled,worked,regular,ot_1_5,sick,vacation',
          ...demoHoursReport.rows.map(
            (row) =>
              `${row.employeeId},${row.name},${row.scheduled},${row.worked},${row.regular},${row.overtime15},${row.sick},${row.vacation}`,
          ),
        ];
        return { fileName: 'hours-by-officer.csv', content: lines.join('\n') };
      }
      if (report === 'overtime') {
        const lines = [
          'employee_id,name,overtime_hours',
          ...demoOvertimeReport.rows.map((row) => `${row.employeeId},${row.name},${row.hours}`),
        ];
        return { fileName: 'overtime-by-officer.csv', content: lines.join('\n') };
      }
      if (report === 'overrides') {
        const lines = [
          'id,at,employee,unit,rule_code,reason',
          ...demoOverrides.map(
            (row) =>
              `${row.id},${row.at},${row.employeeName},${row.unitName},${row.ruleCode ?? ''},${row.reason}`,
          ),
        ];
        return { fileName: 'emergency-overrides.csv', content: lines.join('\n') };
      }
      const lines = [
        'week,scheduled_percent,actual_percent,planned',
        ...demoCoverageReport.weeks.map(
          (week) =>
            `${week.label},${week.scheduledPercent},${week.actualPercent ?? ''},${week.planned}`,
        ),
      ];
      return { fileName: 'coverage-by-week.csv', content: lines.join('\n') };
    },

    async getPayPeriods(): Promise<PayPeriod[]> {
      await pause();
      return demoPayPeriods;
    },

    async getTimeEntries(payPeriodId: string): Promise<TimeEntry[]> {
      await pause();
      const period = demoPayPeriods.find((entry) => entry.id === payPeriodId);
      if (!period) {
        throw new ApiError('That pay period is not in the fixture.', 404);
      }
      return demoTimeEntries.filter((entry) => entry.date >= period.from && entry.date <= period.to);
    },

    async clearActual(assignmentId: string): Promise<RecordActualResult> {
      await pause();
      const entry = demoTimeEntries.find((candidate) => candidate.assignmentId === assignmentId);
      if (!entry) {
        throw new ApiError('That time entry is not in the fixture.', 404);
      }
      entry.worked = false;
      entry.needsActual = true;
      entry.absence = undefined;
      entry.actualStart = undefined;
      entry.actualEnd = undefined;
      entry.payCodes = [];
      return { entry, payCodes: [], periodHours: 0 };
    },

    async recordActual(entryId: string, input: RecordActualInput): Promise<RecordActualResult> {
      await pause();
      const entry = demoTimeEntries.find((candidate) => candidate.assignmentId === entryId);
      if (!entry) {
        throw new ApiError('That time entry is not in the fixture.', 404);
      }
      if (input.absence) {
        entry.absence = input.absence;
        entry.worked = false;
        entry.needsActual = false;
        entry.payCodes = [];
      } else if (input.workedAsScheduled) {
        entry.worked = true;
        entry.needsActual = false;
        entry.absence = undefined;
        entry.actualStart = entry.startAt;
        entry.actualEnd = entry.endAt;
        entry.payCodes = [{ code: 'REG', hours: shiftHours(entry), multiplier: 1 }];
      } else {
        entry.worked = true;
        entry.needsActual = false;
        entry.absence = undefined;
        entry.actualStart = input.actualStart ?? entry.startAt;
        entry.actualEnd = input.actualEnd ?? entry.endAt;
        entry.payCodes = [{ code: 'REG', hours: shiftHours(entry), multiplier: 1 }];
      }
      return {
        entry,
        payCodes: entry.payCodes ?? [],
        periodHours: 82.5,
      };
    },

    async lockPayPeriod(payPeriodId: string): Promise<PayPeriod> {
      await pause();
      const period = demoPayPeriods.find((entry) => entry.id === payPeriodId);
      if (!period) {
        throw new ApiError('That pay period is not in the fixture.', 404);
      }
      const missing = demoTimeEntries
        .filter((entry) => entry.needsActual && entry.date >= period.from && entry.date <= period.to)
        .map((entry) => ({
          assignmentId: entry.assignmentId,
          employeeId: entry.employeeId,
          start: entry.startAt,
        }));

      if (missing.length > 0) {
        // ADR-017: the period cannot be locked while a past shift has no
        // actual, and the api says which ones.
        throw new ApiError(
          `${missing.length} shifts in this period have no actual recorded.`,
          409,
          {
            type: MISSING_ACTUALS,
            title: `${missing.length} shifts have no actual recorded`,
            status: 409,
            detail: 'Record the actuals before locking the period.',
            missing,
          },
        );
      }

      period.status = 'LOCKED';
      period.lockedBy = 'M. Ellis';
      period.lockedAt = 'now';
      return period;
    },

    async unlockPayPeriod(payPeriodId: string, reason: string): Promise<PayPeriod> {
      await pause();
      const period = demoPayPeriods.find((entry) => entry.id === payPeriodId);
      if (!period) {
        throw new ApiError('That pay period is not in the fixture.', 404);
      }
      if (reason.trim().length < 10) {
        throw new ApiError('A reason of at least 10 characters is required.', 400);
      }
      period.status = 'OPEN';
      period.lockedBy = undefined;
      period.lockedAt = undefined;
      return period;
    },

    async exportPayroll(payPeriodId: string): Promise<{ fileName: string; content: string }> {
      await pause();
      const period = demoPayPeriods.find((entry) => entry.id === payPeriodId);
      if (!period) {
        throw new ApiError('That pay period is not in the fixture.', 404);
      }
      if (period.status !== 'LOCKED') {
        throw new ApiError('Only a locked pay period can be exported.', 409);
      }
      // docs/07 §4.5: one line per officer per day per pay code, with the
      // columns the payroll system expects.
      const employeeNumbers = new Map<string, string>();
      [...new Set(demoTimeEntries.map((entry) => entry.employeeId))]
        .sort()
        .forEach((employeeId, index) => {
          employeeNumbers.set(employeeId, `E-${String(index + 1).padStart(3, '0')}`);
        });
      const rows = demoTimeEntries
        .filter((entry) => entry.date >= period.from && entry.date <= period.to)
        .flatMap((entry) => {
          const unitCode = unitCodeFor(entry.unitId);
          const codes =
            entry.payCodes && entry.payCodes.length > 0
              ? entry.payCodes
              : [
                  {
                    code:
                      entry.absence === 'VACATION'
                        ? 'VAC'
                        : entry.absence === 'SICK' || entry.absence === 'OTHER'
                          ? 'SICK'
                          : 'REG',
                    hours: shiftHours(entry),
                  },
                ];
          return codes.map((code) => ({
            sort: `${employeeNumbers.get(entry.employeeId) ?? entry.employeeId}|${entry.date}|${code.code}`,
            line: [
              employeeNumbers.get(entry.employeeId) ?? entry.employeeId,
              period.from,
              period.to,
              entry.date,
              code.code,
              code.hours.toFixed(2),
              unitCode,
              unitCode,
            ].join(','),
          }));
        })
        .sort((left, right) => left.sort.localeCompare(right.sort))
        .map((row) => row.line);
      const lines = [
        'employee_no,pay_period_start,pay_period_end,work_date,pay_code,hours,unit_code,cost_centre',
        ...rows,
      ];
      period.lastExport = { at: 'now', fileHash: '9f2c4b1e8a' };
      return { fileName: `payroll-${period.id}.csv`, content: lines.join('\n') };
    },
  };
}
