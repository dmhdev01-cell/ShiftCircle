/**
 * Demo data for the officer's shift proposals (docs/07 §4.4, v1.3 P3).
 *
 * The officer is Sam Abara, as on the fixture My schedule. Three proposals are
 * seeded, one per decided state the officer can meet: approved, declined with
 * the supervisor's comment, and expired. A sent proposal is added as Waiting.
 */

import { ApiError } from '../http';
import { shiftTemplates } from '../shiftTemplates';
import type {
  MyProposal,
  MyProposalItem,
  ProposalItemInput,
  ProposalPreview,
  ProposalPreviewItem,
  RuleCheckOutcome,
  RuleCheckRequest,
  RuleResult,
} from '../types';
import { BLOCKED_BY_RULES } from '../types';
import { DEMO_EMPLOYEE_ID } from './mySchedule';

const UNIT_B = { id: 'unit-b', code: 'B', name: 'Unit B · Living unit' };

function item(
  id: string,
  shiftTemplate: string,
  startAt: string,
  endAt: string,
  extra: Partial<MyProposalItem>,
): MyProposalItem {
  return {
    id,
    unitId: UNIT_B.id,
    unit: UNIT_B.code,
    unitName: UNIT_B.name,
    shiftTemplate,
    startAt,
    endAt,
    workDate: startAt.slice(0, 10),
    decision: 'PENDING',
    outcomeAtSubmit: 'PASS',
    decidedBy: null,
    decidedAt: null,
    comment: null,
    ...extra,
  };
}

const SEEDED: MyProposal[] = [
  {
    id: 'prop-approved',
    status: 'DECIDED',
    displayState: 'APPROVED',
    note: 'Happy to cover the weekend.',
    submittedAt: '2026-11-16T15:10:00Z',
    withdrawnAt: null,
    version: 1,
    canWithdraw: false,
    items: [
      item('pi-approved', 'D8', '2026-11-21T07:00:00-06:00', '2026-11-21T15:00:00-06:00', {
        decision: 'ACCEPTED',
        decidedBy: 'M. Ellis',
        decidedAt: '2026-11-17T16:00:00Z',
      }),
    ],
  },
  {
    id: 'prop-declined',
    status: 'DECIDED',
    displayState: 'DECLINED',
    note: null,
    submittedAt: '2026-11-12T14:00:00Z',
    withdrawnAt: null,
    version: 1,
    canWithdraw: false,
    items: [
      item('pi-declined', 'E8', '2026-11-28T15:00:00-06:00', '2026-11-28T23:00:00-06:00', {
        decision: 'DECLINED',
        outcomeAtSubmit: 'WARN',
        decidedBy: 'M. Ellis',
        decidedAt: '2026-11-13T17:30:00Z',
        comment: 'Unit is fully staffed that night',
      }),
    ],
  },
  {
    id: 'prop-expired',
    status: 'EXPIRED',
    displayState: 'EXPIRED',
    note: null,
    submittedAt: '2026-11-10T13:00:00Z',
    withdrawnAt: null,
    version: 1,
    canWithdraw: false,
    items: [
      item('pi-expired', 'D8', '2026-11-14T07:00:00-06:00', '2026-11-14T15:00:00-06:00', {
        decision: 'EXPIRED',
      }),
    ],
  },
];

let proposals: MyProposal[] = [];
let counter = 0;

/** Put the seeded proposals back after a test or a demo run. */
export function resetMyProposals(): void {
  proposals = SEEDED.map((proposal) => ({
    ...proposal,
    items: proposal.items.map((entry) => ({ ...entry })),
  }));
  counter = 0;
}
resetMyProposals();

const HOUR = 3_600_000;

/** The end of a draft from its template's ADR-015 times. */
function endOf(input: ProposalItemInput): string {
  const template = shiftTemplates[input.shiftTemplate];
  const start = new Date(input.startAt).getTime();
  const [startH, startM] = (template?.start ?? '00:00').split(':').map(Number);
  const [endH, endM] = (template?.end ?? '08:00').split(':').map(Number);
  let minutes = endH * 60 + endM - (startH * 60 + startM);
  if (minutes <= 0) minutes += 24 * 60;
  return new Date(start + minutes * 60_000).toISOString();
}

const DRAFT_REST: RuleResult = {
  ruleCode: 'U-01',
  ruleTable: 'REST',
  outcome: 'BLOCK',
  overridePolicy: 'EMERGENCY',
  message: 'Less than 8 hours of rest after your other draft shift.',
};

/**
 * The fixture's preview: each draft is checked on its own record, then against
 * the drafts that start before it, so two drafts too close together show it
 * (the real api adds them as extra facts).
 */
export function previewProposalFixture(
  items: ProposalItemInput[],
  evaluate: (request: RuleCheckRequest) => RuleCheckOutcome,
): ProposalPreview {
  if (items.length === 0) {
    throw new ApiError('Add at least one shift.', 400);
  }
  const results: ProposalPreviewItem[] = items.map((input, index) => {
    // The real api checks a proposal item as an EXTRA shift. The fixture
    // evaluator's planted cases (the zero-rest A12, the warn-only officers) key
    // on ASSIGN, and it has no rule that treats the two differently, so the
    // draft goes in as ASSIGN to reach them (review N3, PR #33).
    const outcome = evaluate({
      change: {
        type: 'ASSIGN',
        employeeId: DEMO_EMPLOYEE_ID,
        unitId: input.unitId,
        shiftTemplate: input.shiftTemplate,
        startAt: input.startAt,
      },
    });
    const start = new Date(input.startAt).getTime();
    const tooClose = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const otherStart = new Date(other.startAt).getTime();
      if (otherStart >= start) return false;
      return start - new Date(endOf(other)).getTime() < 8 * HOUR;
    });
    const ruleResults = tooClose ? [DRAFT_REST, ...outcome.ruleResults] : outcome.ruleResults;
    return {
      index,
      unitId: input.unitId,
      unit: UNIT_B.code,
      shiftTemplate: input.shiftTemplate,
      startAt: input.startAt,
      endAt: endOf(input),
      outcome: tooClose ? 'BLOCK' : outcome.outcome,
      ruleSetVersion: outcome.ruleSetVersion,
      ruleResults,
      problem: null,
      problemCode: null,
    };
  });
  const worst = results.some((entry) => entry.outcome === 'BLOCK')
    ? 'BLOCK'
    : results.some((entry) => entry.outcome === 'WARN')
      ? 'WARN'
      : 'PASS';
  return { outcome: worst, canSend: worst !== 'BLOCK', items: results };
}

export function submitProposalFixture(
  note: string,
  items: ProposalItemInput[],
  evaluate: (request: RuleCheckRequest) => RuleCheckOutcome,
): MyProposal {
  const preview = previewProposalFixture(items, evaluate);
  if (!preview.canSend) {
    throw new ApiError('A rule blocks one of these shifts.', 422, {
      type: BLOCKED_BY_RULES,
      title: 'A rule blocks one of these shifts',
      status: 422,
      outcome: 'BLOCK',
    });
  }
  counter += 1;
  const trimmed = note.trim();
  const proposal: MyProposal = {
    id: `prop-fixture-${counter}`,
    status: 'WAITING',
    displayState: 'WAITING',
    note: trimmed === '' ? null : trimmed,
    submittedAt: new Date().toISOString(),
    withdrawnAt: null,
    version: 0,
    canWithdraw: true,
    items: [...preview.items]
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .map((entry, index) =>
        item(`pi-fixture-${counter}-${index}`, entry.shiftTemplate, entry.startAt, entry.endAt, {
          outcomeAtSubmit: entry.outcome,
        }),
      ),
  };
  proposals = [proposal, ...proposals];
  return proposal;
}

export function myProposalsFixture(): MyProposal[] {
  return proposals.map((proposal) => ({ ...proposal, items: [...proposal.items] }));
}

export function withdrawProposalFixture(proposalId: string, version: number): MyProposal {
  const proposal = proposals.find((entry) => entry.id === proposalId);
  if (!proposal) throw new ApiError('Proposal not found', 404);
  if (proposal.version !== version) {
    throw new ApiError('Someone changed this proposal. Reload and try again.', 412);
  }
  if (!proposal.canWithdraw) {
    throw new ApiError(
      'This proposal can no longer be withdrawn: a shift in it has been answered or has started.',
      409,
    );
  }
  const withdrawn: MyProposal = {
    ...proposal,
    status: 'WITHDRAWN',
    displayState: 'WITHDRAWN',
    withdrawnAt: new Date().toISOString(),
    version: proposal.version + 1,
    canWithdraw: false,
    items: proposal.items.map((entry) => ({ ...entry, decision: 'WITHDRAWN' })),
  };
  proposals = proposals.map((entry) => (entry.id === proposalId ? withdrawn : entry));
  return withdrawn;
}
