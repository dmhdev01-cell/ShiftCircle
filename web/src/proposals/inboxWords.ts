/**
 * The words the Proposals inbox uses (docs/07 §4.4, plan v1.3 §3.2). Kept
 * apart from the components so each sentence has a unit test. The officer's
 * note and the deciders' comments are never built into markup here: the
 * screen renders them as text.
 */

import type {
  ProposalDetailItem,
  ProposalOpenShiftMatch,
  ProposalRefusalItem,
  RuleCheckOutcome,
  RuleOutcome,
  RuleResult,
} from '../api/types';
import type { StatusTone } from '../components/StatusPill';

export const MIN_DECLINE_COMMENT = 3;
export const MAX_COMMENT = 500;

export const OUTCOME_WORD: Record<RuleOutcome, string> = {
  PASS: 'Passes',
  INFO: 'Passes',
  WARN: 'Warning',
  BLOCK: 'Blocked',
};

export const OUTCOME_TONE: Record<RuleOutcome, StatusTone> = {
  PASS: 'pass',
  INFO: 'pass',
  WARN: 'warn',
  BLOCK: 'block',
};

/** The Warn or Block rule codes of a result, each once, in order. */
export function flaggedCodes(results: RuleResult[] | undefined, outcome: RuleOutcome): string[] {
  return [
    ...new Set((results ?? []).filter((result) => result.outcome === outcome).map((r) => r.ruleCode)),
  ];
}

/** "Warning · U-14", "Blocked · U-01, U-05" or "Passes". */
export function ruleLabel(outcome: RuleOutcome | null | undefined, results?: RuleResult[]): string {
  if (!outcome) return 'Not checked';
  const word = OUTCOME_WORD[outcome] ?? outcome;
  const codes = outcome === 'BLOCK' || outcome === 'WARN' ? flaggedCodes(results, outcome) : [];
  return codes.length > 0 ? `${word} · ${codes.join(', ')}` : word;
}

/**
 * The rule result as the decider must treat it now: the fresh one from a 422
 * refusal when there is one, otherwise the detail's "rules now".
 */
export function currentRule(
  item: ProposalDetailItem,
  fresh: ProposalRefusalItem | undefined,
): RuleCheckOutcome | null {
  if (fresh) {
    return {
      outcome: fresh.outcome,
      ruleSetVersion: item.ruleNow?.ruleSetVersion ?? 0,
      overridable: false,
      ruleResults: fresh.ruleResults,
    };
  }
  return item.ruleNow;
}

/**
 * "Was Passes, now Warning · U-14" when the result moved since the send,
 * otherwise "Passes when sent and now".
 */
export function wasNowLine(
  item: ProposalDetailItem,
  now: RuleCheckOutcome | null,
  changed: boolean,
): string {
  const was = ruleLabel(item.outcomeAtSubmit, item.ruleAtSubmit?.ruleResults);
  if (!now) return `${was} when sent`;
  const current = ruleLabel(now.outcome, now.ruleResults);
  return changed ? `Was ${was}, now ${current}` : `${current} when sent and now`;
}

/** True when the fresh result differs from the one at the send (outcome or flagged rules). */
export function resultChanged(item: ProposalDetailItem, now: RuleCheckOutcome | null): boolean {
  if (!now) return false;
  if (now.outcome !== item.outcomeAtSubmit) return true;
  const key = (results: RuleResult[] | undefined) =>
    [...flaggedCodes(results, 'BLOCK').map((c) => `B:${c}`), ...flaggedCodes(results, 'WARN').map((c) => `W:${c}`)]
      .sort()
      .join(',');
  return key(now.ruleResults) !== key(item.ruleAtSubmit?.ruleResults);
}

function hoursText(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0$/, '')} h`;
}

/**
 * "Would be overtime: 8 h · brings Tara to 88 h of 80 h in this pay period"
 * (owner Q5: paid like any extra shift, only hours past the threshold are OT).
 */
export function overtimeLine(item: ProposalDetailItem, firstName: string): string | null {
  const pay = item.payPeriod;
  if (!pay) return null;
  return (
    `Would be overtime: ${hoursText(pay.wouldBeOvertimeHours)} · brings ${firstName} to ` +
    `${hoursText(pay.hoursAfter)} of ${hoursText(pay.thresholdHours)} in this pay period`
  );
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The officer's place in the overtime order of a matching open shift, or "above minimum". */
export function openShiftLine(match: ProposalOpenShiftMatch | null, firstName: string): string {
  if (!match) {
    return 'No open shift for this slot: approving adds an extra shift above minimum.';
  }
  const place =
    match.otOrderPosition !== null
      ? `${firstName} is ${ordinal(match.otOrderPosition)} of ${match.otOrderSize} in the overtime order`
      : `${firstName} is not eligible in its overtime order (${match.otOrderSize} eligible)`;
  const offers =
    match.liveOffers > 0
      ? ` Approving fills it and withdraws ${match.liveOffers} waiting offer${match.liveOffers === 1 ? '' : 's'}.`
      : ' Approving fills it.';
  return `Matches an open shift: ${place}.${offers}`;
}

/** "Send decision (2 accepted, 1 declined)". */
export function sendLabel(accepted: number, declined: number): string {
  return `Send decision (${accepted} accepted, ${declined} declined)`;
}

export type Choice = 'accept' | 'decline' | undefined;

export interface ItemDraft {
  choice: Choice;
  comment: string;
  /** The Warn codes the decider ticked; they must cover the current ones. */
  acknowledgedWarnings: string[];
  acknowledgedOrder: boolean;
}

/** What one decidable item still needs before the decision can be sent, or null. */
export function itemNeeds(input: {
  draft: ItemDraft | undefined;
  outcome: RuleOutcome | null | undefined;
  warnCodes: string[];
  outOfOrder: boolean;
}): string | null {
  const draft = input.draft;
  if (!draft?.choice) return 'Choose Approve or Decline for every shift.';
  if (draft.choice === 'decline') {
    if (draft.comment.trim().length < MIN_DECLINE_COMMENT) {
      return 'Each declined shift needs a comment, so the officer knows why.';
    }
  } else {
    if (input.outcome === 'BLOCK') {
      return "A Blocked shift can't be approved from a proposal. Decline it.";
    }
    if (!input.warnCodes.every((code) => draft.acknowledgedWarnings.includes(code))) {
      return 'Acknowledge the warnings of each shift you approve.';
    }
    if (input.outOfOrder && !draft.acknowledgedOrder) {
      return 'Confirm that you are approving outside the overtime order.';
    }
  }
  if (draft.comment.trim().length > MAX_COMMENT) {
    return `A comment is at most ${MAX_COMMENT} characters.`;
  }
  return null;
}

/**
 * The open-shift match as the decider must treat it now. A fresh 422 item is
 * authoritative: with no overtime order in it, the shift no longer matches an
 * open shift (filled or cancelled meanwhile), so there is no order to be
 * outside of. Otherwise the detail's match.
 */
export function currentMatch(
  item: ProposalDetailItem,
  fresh: ProposalRefusalItem | undefined,
): ProposalOpenShiftMatch | null {
  if (!fresh) return item.openShift;
  if (fresh.otOrderSize === undefined) return null;
  return {
    id: fresh.openShiftId ?? item.openShift?.id ?? '',
    status: item.openShift?.status ?? 'OPEN',
    eligibility: item.openShift?.eligibility ?? '',
    // The refusal's count is current; the detail's may be stale by now.
    liveOffers: fresh.liveOffers ?? item.openShift?.liveOffers ?? 0,
    otOrderPosition: fresh.otOrderPosition ?? null,
    otOrderSize: fresh.otOrderSize,
    outOfOrder: fresh.outOfOrder ?? false,
  };
}
