/**
 * The fixture implementation of the API.
 *
 * It answers with the same types the real api answers with, so the planning
 * board can be built and demoed before `GET /schedule` exists. When the real
 * api lands, `web/src/api/client.ts` switches to the HTTP implementation and
 * nothing else changes.
 */

import { ApiError } from '../http';
import type {
  AssignOutcome,
  AssignRequest,
  RuleCheckChange,
  RuleCheckOutcome,
  RuleCheckRequest,
  RuleResult,
  SchedulePayload,
  ScheduleQuery,
  ShiftCircleApi,
} from '../types';
import { BLOCKED_BY_RULES, WARNINGS_NEED_ACKNOWLEDGEMENT } from '../types';
import { demoSchedule, PC01_CHANGE } from './schedule';

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
    outcome: 'BLOCK',
    message:
      "Only 7 hours' rest after the 12 h shift ending Fri 24:00. The minimum is 8 consecutive hours in any 24 hours.",
    facts: { restHours: 7, minHours: 8 },
    evidence: [{ assignmentId: 'a-nia-20', label: 'Fri 20 P12 12:00–24:00' }],
    source: 'Saskatchewan Employment Act',
  },
  {
    ruleCode: 'U-05',
    outcome: 'BLOCK',
    message: '17 hours of work in 24 hours (Fri 12:00 – Sat 12:00).',
    facts: { hours: 17, maxHours: 16 },
  },
  {
    ruleCode: 'U-14',
    outcome: 'WARN',
    message: '52 hours this week, over the 48 h warning level.',
  },
];

const WARN_ONLY_RESULTS: RuleResult[] = [
  {
    ruleCode: 'U-14',
    outcome: 'WARN',
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

/** A change that only warns, so the acknowledge flow can be exercised. */
function isWarnOnly(change: RuleCheckChange): boolean {
  return change.type === 'ASSIGN' && change.employeeId === 'emp-aiden' && change.startAt === '2026-11-22T07:00:00-06:00';
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
        outcome: 'PASS',
        message:
          '12 hours of rest after the previous shift. The minimum is 8 consecutive hours in any 24 hours.',
        facts: { restHours: 12, minHours: 8 },
      },
    ],
  };
}

let assignmentCounter = 0;

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

    async assignShift(request: AssignRequest): Promise<AssignOutcome> {
      await wait(LATENCY_MS);
      const outcome = evaluate({
        change: {
          type: 'ASSIGN',
          employeeId: request.employeeId,
          unitId: request.unitId,
          shiftTemplate: request.shiftTemplate,
          startAt: request.startAt,
        },
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
  };
}
