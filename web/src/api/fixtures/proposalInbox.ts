/**
 * Demo data for the Proposals inbox, the decider's side (docs/07 §4.4, v1.3 P4).
 *
 * Seen as M. Ellis (Units A and B). Three proposals are seeded:
 * - Tara Nakamura, waiting, two shifts on Unit B. The Saturday day shift
 *   matches an open shift where she is 3rd of 12 in the overtime order; the
 *   Saturday evening passed when sent and now warns (U-14), so "was / now"
 *   shows.
 * - M. Ellis's own proposal, waiting for another supervisor: read-only here.
 * - Omar Reid, declined with a comment, for the "All" filter.
 *
 * The decision applies the api's order of refusals: a Block, then
 * unacknowledged warnings, then the overtime order (one 422 per send).
 */

import { ApiError } from '../http';
import type {
  ProposalDecisionInput,
  ProposalDetail,
  ProposalDetailItem,
  ProposalInboxCard,
  ProposalInboxQuery,
  RuleCheckOutcome,
  RuleResult,
} from '../types';
import { BLOCKED_BY_RULES, WARNINGS_NEED_ACKNOWLEDGEMENT } from '../types';

const UNIT_A = { id: 'unit-a', code: 'A', name: 'Unit A · Living unit' };
const UNIT_B = { id: 'unit-b', code: 'B', name: 'Unit B · Living unit' };

const U14_WARN: RuleResult = {
  ruleCode: 'U-14',
  ruleTable: 'HOURS',
  outcome: 'WARN',
  overridePolicy: 'ACKNOWLEDGE',
  message: 'This week would reach 56 hours, above the 48-hour warning level.',
};

const PASS_V7: RuleCheckOutcome = {
  outcome: 'PASS',
  ruleSetVersion: 7,
  overridable: false,
  ruleResults: [],
};

function item(
  id: string,
  unit: { id: string; code: string; name: string },
  shiftTemplate: string,
  startAt: string,
  endAt: string,
  extra: Partial<ProposalDetailItem>,
): ProposalDetailItem {
  return {
    id,
    unitId: unit.id,
    unit: unit.code,
    unitName: unit.name,
    shiftTemplate,
    startAt,
    endAt,
    workDate: startAt.slice(0, 10),
    hours: 8,
    decision: 'PENDING',
    inScope: true,
    canDecide: true,
    outcomeAtSubmit: 'PASS',
    ruleAtSubmit: { outcome: 'PASS', ruleSetVersion: 7, ruleResults: [] },
    outcomeNow: 'PASS',
    ruleNow: PASS_V7,
    ruleChanged: false,
    wouldBeOvertimeHours: 0,
    payPeriod: {
      start: '2026-11-09',
      end: '2026-11-22',
      hoursBefore: 72,
      hoursAfter: 80,
      thresholdHours: 80,
      wouldBeOvertimeHours: 0,
      // The api's rule: the status is for the hours after approval (80 >= 80).
      overtimeStatus: 'IN_OVERTIME',
    },
    openShift: null,
    decidedBy: null,
    decidedAt: null,
    comment: null,
    acknowledgedCodes: [],
    outOfOvertimeOrder: false,
    assignmentId: null,
    ...extra,
  };
}

function seeded(): ProposalDetail[] {
  return [
    {
      id: 'inbox-tara',
      status: 'WAITING',
      displayState: 'WAITING',
      version: 0,
      note: 'Free both Saturdays. Happy to take nights if that helps more.',
      submittedAt: '2026-11-18T21:40:00Z',
      withdrawnAt: null,
      employeeId: 'emp-tara',
      officerName: 'Tara Nakamura',
      homeUnit: 'B',
      own: false,
      canDecide: true,
      items: [
        item(
          'inbox-tara-1',
          UNIT_B,
          'D8',
          '2026-11-21T07:00:00-06:00',
          '2026-11-21T15:00:00-06:00',
          {
            openShift: {
              id: 'os-sat-days',
              status: 'OPEN',
              otOrderPosition: 3,
              otOrderSize: 12,
              eligibility: 'ELIGIBLE',
              outOfOrder: true,
              liveOffers: 0,
            },
          },
        ),
        item(
          'inbox-tara-2',
          UNIT_B,
          'E8',
          '2026-11-28T15:00:00-06:00',
          '2026-11-28T23:00:00-06:00',
          {
            outcomeNow: 'WARN',
            ruleNow: { outcome: 'WARN', ruleSetVersion: 7, overridable: false, ruleResults: [U14_WARN] },
            ruleChanged: true,
            wouldBeOvertimeHours: 8,
            payPeriod: {
              start: '2026-11-23',
              end: '2026-12-06',
              hoursBefore: 80,
              hoursAfter: 88,
              thresholdHours: 80,
              wouldBeOvertimeHours: 8,
              overtimeStatus: 'IN_OVERTIME',
            },
          },
        ),
      ],
    },
    {
      id: 'inbox-own',
      status: 'WAITING',
      displayState: 'WAITING',
      version: 0,
      note: null,
      submittedAt: '2026-11-18T16:05:00Z',
      withdrawnAt: null,
      employeeId: 'emp-ellis',
      officerName: 'Mel Ellis',
      homeUnit: 'A',
      own: true,
      canDecide: false,
      items: [
        item(
          'inbox-own-1',
          UNIT_A,
          'N8',
          '2026-11-27T23:00:00-06:00',
          '2026-11-28T07:00:00-06:00',
          { canDecide: false },
        ),
      ],
    },
    {
      id: 'inbox-omar',
      status: 'DECIDED',
      displayState: 'DECLINED',
      version: 1,
      note: null,
      submittedAt: '2026-11-12T14:00:00Z',
      withdrawnAt: null,
      employeeId: 'emp-omar',
      officerName: 'Omar Reid',
      homeUnit: 'A',
      own: false,
      canDecide: false,
      items: [
        item(
          'inbox-omar-1',
          UNIT_A,
          'E8',
          '2026-11-26T15:00:00-06:00',
          '2026-11-26T23:00:00-06:00',
          {
            decision: 'DECLINED',
            canDecide: false,
            ruleNow: null,
            outcomeNow: null,
            payPeriod: null,
            wouldBeOvertimeHours: null,
            decidedBy: 'M. Ellis',
            decidedAt: '2026-11-13T17:30:00Z',
            comment: 'Unit is fully staffed that night',
          },
        ),
      ],
    },
  ];
}

let inbox: ProposalDetail[] = seeded();
let assignmentCounter = 0;

/** Put the seeded proposals back after a test or a demo run. */
export function resetProposalInbox(): void {
  inbox = seeded();
  assignmentCounter = 0;
}

function copy(proposal: ProposalDetail): ProposalDetail {
  return { ...proposal, items: proposal.items.map((entry) => ({ ...entry })) };
}

function card(proposal: ProposalDetail): ProposalInboxCard {
  const waiting = proposal.items.filter((entry) => entry.inScope && entry.decision === 'PENDING');
  return {
    id: proposal.id,
    employeeId: proposal.employeeId,
    officerName: proposal.officerName,
    homeUnit: proposal.homeUnit,
    units: [...new Set(proposal.items.map((entry) => entry.unit))],
    itemCount: proposal.items.length,
    itemsInScope: proposal.items.filter((entry) => entry.inScope).length,
    waitingInScope: waiting.length,
    submittedAt: proposal.submittedAt,
    status: proposal.status,
    displayState: proposal.displayState,
    version: proposal.version,
    own: proposal.own,
    shifts: proposal.items
      .filter((entry) => entry.inScope)
      .map((entry) => ({
        unit: entry.unit,
        shiftTemplate: entry.shiftTemplate,
        startAt: entry.startAt,
        workDate: entry.workDate,
        decision: entry.decision,
      })),
  };
}

export function proposalInboxFixture(query: ProposalInboxQuery): ProposalInboxCard[] {
  return inbox
    .filter((proposal) => (query.status === 'ALL' ? true : proposal.status === 'WAITING'))
    .filter((proposal) =>
      query.unitId ? proposal.items.some((entry) => entry.unitId === query.unitId) : true,
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map(card);
}

export function proposalCountFixture(): number {
  return inbox.filter((proposal) => proposal.status === 'WAITING' && !proposal.own).length;
}

export function proposalDetailFixture(proposalId: string): ProposalDetail {
  const proposal = inbox.find((entry) => entry.id === proposalId);
  if (!proposal) throw new ApiError('Proposal not found', 404);
  return copy(proposal);
}

function refusal(type: string, title: string, accepted: ProposalDetailItem[]): ApiError {
  return new ApiError(title, 422, {
    type,
    title,
    status: 422,
    items: accepted.map((entry) => ({
      id: entry.id,
      unit: entry.unit,
      shiftTemplate: entry.shiftTemplate,
      startAt: entry.startAt,
      outcome: entry.outcomeNow ?? 'PASS',
      warnCodes: (entry.ruleNow?.ruleResults ?? [])
        .filter((result) => result.outcome === 'WARN')
        .map((result) => result.ruleCode),
      ruleResults: entry.ruleNow?.ruleResults ?? [],
      ...(entry.openShift
        ? {
            otOrderPosition: entry.openShift.otOrderPosition,
            otOrderSize: entry.openShift.otOrderSize,
            outOfOrder: entry.openShift.outOfOrder,
          }
        : {}),
    })),
  });
}

export function decideProposalFixture(
  proposalId: string,
  version: number,
  decisions: ProposalDecisionInput[],
): ProposalDetail {
  const proposal = inbox.find((entry) => entry.id === proposalId);
  if (!proposal) throw new ApiError('Proposal not found', 404);
  if (proposal.own) {
    throw new ApiError(
      "You can't approve your own proposal; another supervisor or the planner will.",
      403,
    );
  }
  if (proposal.version !== version) {
    throw new ApiError('Reload the proposal and decide again.', 412);
  }
  const byId = new Map(proposal.items.map((entry) => [entry.id, entry]));
  for (const decision of decisions) {
    const target = byId.get(decision.id);
    if (!target || target.decision !== 'PENDING') {
      throw new ApiError('This shift was already answered. Reload the proposal.', 409);
    }
    if (!decision.accept && (decision.comment ?? '').trim().length < 3) {
      throw new ApiError(
        'A declined shift needs a comment of at least 3 characters, so the officer knows why',
        400,
      );
    }
  }
  const accepted = decisions
    .filter((decision) => decision.accept)
    .map((decision) => byId.get(decision.id)!);
  if (accepted.some((entry) => entry.outcomeNow === 'BLOCK')) {
    throw refusal(BLOCKED_BY_RULES, 'A shift you approved breaks a rule now', accepted);
  }
  const unacknowledged = decisions.some((decision) => {
    if (!decision.accept) return false;
    const warns = (byId.get(decision.id)!.ruleNow?.ruleResults ?? [])
      .filter((result) => result.outcome === 'WARN')
      .map((result) => result.ruleCode);
    return !warns.every((code) => (decision.acknowledgeWarnings ?? []).includes(code));
  });
  if (unacknowledged) {
    throw refusal(WARNINGS_NEED_ACKNOWLEDGEMENT, 'Warnings need acknowledgement', accepted);
  }
  const outOfOrder = decisions.some(
    (decision) =>
      decision.accept &&
      byId.get(decision.id)!.openShift?.outOfOrder &&
      !decision.acknowledgeOutOfOrder,
  );
  if (outOfOrder) {
    throw refusal(
      'https://shiftcircle.local/problems/out-of-overtime-order',
      'This approval is outside the overtime order',
      accepted,
    );
  }

  const decidedAt = new Date().toISOString();
  const wanted = new Map(decisions.map((decision) => [decision.id, decision]));
  const items = proposal.items.map((entry): ProposalDetailItem => {
    const decision = wanted.get(entry.id);
    if (!decision) return entry;
    const comment = decision.comment?.trim() ? decision.comment.trim() : null;
    if (!decision.accept) {
      return { ...entry, decision: 'DECLINED', canDecide: false, decidedBy: 'M. Ellis', decidedAt, comment };
    }
    assignmentCounter += 1;
    return {
      ...entry,
      decision: 'ACCEPTED',
      canDecide: false,
      decidedBy: 'M. Ellis',
      decidedAt,
      comment,
      acknowledgedCodes: decision.acknowledgeWarnings ?? [],
      outOfOvertimeOrder: Boolean(entry.openShift?.outOfOrder),
      assignmentId: `asg-proposal-${assignmentCounter}`,
    };
  });
  const pending = items.some((entry) => entry.decision === 'PENDING');
  const accepts = items.filter((entry) => entry.decision === 'ACCEPTED').length;
  const declines = items.filter((entry) => entry.decision === 'DECLINED').length;
  const updated: ProposalDetail = {
    ...proposal,
    status: pending ? 'WAITING' : 'DECIDED',
    displayState: pending
      ? 'WAITING'
      : accepts === items.length
        ? 'APPROVED'
        : accepts > 0
          ? 'PARTLY_APPROVED'
          : // Plan §1.1: Declined only when every shift is declined; a mix of
            // expired and declined with nothing accepted reads Expired.
            declines === items.length
            ? 'DECLINED'
            : 'EXPIRED',
    version: proposal.version + 1,
    canDecide: items.some((entry) => entry.canDecide),
    items,
  };
  inbox = inbox.map((entry) => (entry.id === proposalId ? updated : entry));
  return copy(updated);
}
