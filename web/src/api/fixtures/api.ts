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
  BuildReport,
  CoverageReport,
  DemoUser,
  MockLoginResult,
  HoursReport,
  MyOffer,
  MySchedulePayload,
  OvertimeReport,
  OverrideRow,
  PayPeriod,
  RecordActualInput,
  RecordActualResult,
  TimeEntry,
  OfferRecord,
  OfferResponse,
  OpenShift,
  OpenShiftCandidates,
  OpenShiftQuery,
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
} from '../types';
import {
  BLOCKED_BY_RULES,
  MISSING_ACTUALS,
  WARNINGS_NEED_ACKNOWLEDGEMENT,
} from '../types';
import { demoMyOffers, demoMySchedule } from './mySchedule';
import { demoCandidates, demoOfferHistory, demoOpenShifts } from './overtime';
import {
  demoCoverageReport,
  demoHoursReport,
  demoOvertimeReport,
  demoOverrides,
} from './reports';
import { demoUsers } from './demoUsers';
import { demoBuildReport, demoRuleSets, demoRuleTables } from './rules';
import { demoSchedule, PC01_CHANGE } from './schedule';
import { demoPayPeriods, demoTimeEntries } from './timeAttendance';

const LATENCY_MS = 120;
const RULE_SET_VERSION = 7;
const RULE_SET_PUBLISHED_AT = '13:50';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    outcome: 'WARN',
    overridePolicy: 'ACKNOWLEDGE',
    message: '52 hours this week, over the 48 h warning level.',
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
    // An emergency override does not make the rule pass: the api reports the
    // overridden rule as INFO and accepts the change.
    if (request.override?.reason) {
      return {
        ...base,
        outcome: 'PASS',
        ruleResults: PC01_RESULTS.map((result) =>
          result.outcome === 'BLOCK' ? { ...result, outcome: 'INFO' as const } : result,
        ),
      };
    }
    return { ...base, outcome: 'BLOCK', ruleResults: PC01_RESULTS };
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

/**
 * Put the fixtures back, so one test cannot change what the next one sees.
 */
export function resetFixtures(): void {
  assignmentCounter = 0;
  demoRuleSets.forEach((entry) => {
    entry.status =
      entry.version === 7 ? 'LIVE' : entry.version === 8 ? 'DRAFT' : ('PUBLISHED' as const);
    entry.live = entry.version === 7;
    entry.approvedBy = undefined;
    entry.approvedAt = undefined;
    entry.publishedAt = entry.version === 7 ? '20 Nov 13:50' : undefined;
  });
}

export function createFixtureApi(): ShiftCircleApi {
  return {
    async getSchedule(_query: ScheduleQuery): Promise<SchedulePayload> {
      await wait(LATENCY_MS);
      return demoSchedule;
    },

    async previewRuleCheck(request: RuleCheckRequest): Promise<RuleCheckOutcome> {
      await wait(LATENCY_MS);
      return evaluate(request);
    },

    async saveChange(request: SaveRequest): Promise<SaveOutcome> {
      await wait(LATENCY_MS);
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
      // An emergency override is a deliberate decision, so the Warn results do
      // also have to be acknowledged.
      if (unacknowledged.length > 0 && !request.override) {
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

    async getOpenShifts(query: OpenShiftQuery): Promise<OpenShift[]> {
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
      const openShift = demoOpenShifts.find((shift) => shift.id === openShiftId);
      if (!openShift) {
        throw new ApiError('That open shift is not in the fixture.', 404);
      }
      return {
        openShift,
        candidates: demoCandidates,
        ruleSetVersion: RULE_SET_VERSION,
        rankingNote:
          'Fewest overtime hours this quarter first, then seniority. Officers who would break a Block rule are skipped without losing their place.',
        history: demoOfferHistory,
      };
    },

    async createOffers(openShiftId: string, employeeIds: string[]): Promise<OfferRecord[]> {
      await wait(LATENCY_MS);
      const openShift = demoOpenShifts.find((shift) => shift.id === openShiftId);
      if (!openShift) {
        throw new ApiError('That open shift is not in the fixture.', 404);
      }
      // Only a supervisor may offer overtime (S-04). This is the supervisor's
      // session, so the offers are recorded.
      return employeeIds.map((employeeId) => {
        const candidate = demoCandidates.find((entry) => entry.employeeId === employeeId);
        return {
          at: 'now',
          employeeId,
          employeeName: candidate?.name ?? employeeId,
          status: 'OFFERED' as const,
        };
      });
    },

    async confirmOffer(offerId: string): Promise<OfferRecord> {
      await wait(LATENCY_MS);
      const offer = demoOfferHistory.find((entry) => entry.employeeId === offerId);
      if (!offer) {
        throw new ApiError('That offer is not in the fixture.', 404);
      }
      // Only a supervisor confirms an accepted offer (S-04).
      return { ...offer, status: 'CONFIRMED' };
    },

    async assignOpenShift(openShiftId: string, employeeId: string): Promise<SaveOutcome> {
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
      return demoMyOffers;
    },

    async respondToOffer(offerId: string, response: OfferResponse): Promise<MyOffer> {
      await wait(LATENCY_MS);
      const offer = demoMyOffers.find((entry) => entry.id === offerId);
      if (!offer) {
        throw new ApiError('That offer is not in the fixture.', 404);
      }
      // Accepting re-checks the rules; the supervisor confirms afterwards.
      return {
        ...offer,
        status: response === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED',
      };
    },

    async submitProposals(
      note: string,
      items: RuleCheckChange[],
    ): Promise<{ id: string; accepted: number }> {
      await wait(LATENCY_MS);
      if (note.trim().length === 0) {
        throw new ApiError('A note to the supervisor is required.', 400);
      }
      return { id: `p-fixture-${items.length}`, accepted: items.length };
    },

    async getDemoUsers(): Promise<DemoUser[]> {
      await wait(LATENCY_MS);
      return demoUsers;
    },

    async mockLogin(userId: string): Promise<MockLoginResult> {
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
      return demoRuleSets;
    },

    async getRuleTable(_version: number, code: string): Promise<RuleTable> {
      await wait(LATENCY_MS);
      const table = demoRuleTables.find((entry) => entry.code === code);
      if (!table) {
        throw new ApiError('That rule table is not in the fixture.', 404);
      }
      return table;
    },

    async saveRuleRows(_version: number, code: string, rows: RuleTableRow[]): Promise<RuleTable> {
      await wait(LATENCY_MS);
      const table = demoRuleTables.find((entry) => entry.code === code);
      if (!table) {
        throw new ApiError('That rule table is not in the fixture.', 404);
      }
      table.rows = rows;
      table.changed = rows.filter((row) => row.enabled).length;
      return table;
    },

    async buildRuleSet(_version?: number): Promise<BuildReport> {
      await wait(LATENCY_MS);
      return demoBuildReport;
    },

    async submitRuleSet(version: number): Promise<RuleSetVersion> {
      await wait(LATENCY_MS);
      const ruleSet = demoRuleSets.find((entry) => entry.version === version);
      if (!ruleSet) {
        throw new ApiError('That rule set is not in the fixture.', 404);
      }
      ruleSet.status = 'SUBMITTED';
      return ruleSet;
    },

    async approveRuleSet(version: number): Promise<RuleSetVersion> {
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
      return demoCoverageReport;
    },

    async getHoursReport(): Promise<HoursReport> {
      await wait(LATENCY_MS);
      return demoHoursReport;
    },

    async getOvertimeReport(): Promise<OvertimeReport> {
      await wait(LATENCY_MS);
      return demoOvertimeReport;
    },

    async getOverrides(): Promise<OverrideRow[]> {
      await wait(LATENCY_MS);
      return demoOverrides;
    },

    async exportReportCsv(
      report: 'coverage' | 'hours' | 'overtime' | 'overrides',
    ): Promise<{ fileName: string; content: string }> {
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
      return demoPayPeriods;
    },

    async getTimeEntries(payPeriodId: string): Promise<TimeEntry[]> {
      await wait(LATENCY_MS);
      const period = demoPayPeriods.find((entry) => entry.id === payPeriodId);
      if (!period) {
        throw new ApiError('That pay period is not in the fixture.', 404);
      }
      return demoTimeEntries.filter((entry) => entry.date >= period.from && entry.date <= period.to);
    },

    async recordActual(entryId: string, input: RecordActualInput): Promise<RecordActualResult> {
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
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
      await wait(LATENCY_MS);
      const period = demoPayPeriods.find((entry) => entry.id === payPeriodId);
      if (!period) {
        throw new ApiError('That pay period is not in the fixture.', 404);
      }
      if (period.status !== 'LOCKED') {
        throw new ApiError('Only a locked pay period can be exported.', 409);
      }
      const lines = [
        'employee_id,period,regular_hours,overtime_hours,pay_code',
        ...demoTimeEntries
          .filter((entry) => entry.date >= period.from && entry.date <= period.to)
          .map(
            (entry) =>
              `${entry.employeeId},${period.label},${(entry.payCodes?.[0]?.hours ?? 0).toFixed(2)},0.00,${entry.payCodes?.[0]?.code ?? 'REG'}`,
          ),
      ];
      period.lastExport = { at: 'now', fileHash: '9f2c4b1e8a' };
      return { fileName: `payroll-${period.id}.csv`, content: lines.join('\n') };
    },
  };
}
