/**
 * The words the officer's proposal screens use (docs/07 §4.4, v1.3 P3). Kept
 * apart from the components so each sentence has a unit test.
 */

import { formatShiftTimes, shiftTemplates } from '../api/shiftTemplates';
import type {
  ProposalDisplayState,
  ProposalItemDecision,
  ProposalPreviewItem,
  RuleOutcome,
} from '../api/types';
import type { StatusTone } from '../components/StatusPill';

const ZONE = 'America/Regina';
/** Regina keeps standard time all year. */
export const REGINA_OFFSET = '-06:00';
/**
 * The last day a proposal may name: the end of the planned quarter (docs/07 §4.4).
 * Mirrors the api's `PlanGenerator.TO`, which no endpoint exposes yet; change
 * both together, or the date picker and the api disagree.
 */
export const PROPOSAL_HORIZON = '2027-04-11';
export const MAX_DRAFTS = 10;
export const MAX_NOTE = 500;

/** "Sat 21 Nov" for a calendar date. */
export function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(parsed);
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
}

/** "Sat 21 Nov · D8 07:00 – 15:00 · Unit B · Living unit". */
export function shiftLine(date: string, shiftTemplate: string, unitName?: string): string {
  const what = shiftTemplates[shiftTemplate] ? formatShiftTimes(shiftTemplate) : '';
  return [dayLabel(date), `${shiftTemplate} ${what}`.trim(), unitName]
    .filter((part) => part && part.trim() !== '')
    .join(' · ');
}

/** The start instant of a draft, in the centre's zone. */
export function draftStartAt(date: string, shiftTemplate: string): string {
  const start = shiftTemplates[shiftTemplate]?.start ?? '00:00';
  return `${date}T${start}:00${REGINA_OFFSET}`;
}

/** The day after a date, for the earliest day a draft may name. */
export function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** "19 Nov 14:20" for an instant, in the centre's zone. */
export function sentWhen(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return instant;
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: ZONE }).format(parsed);
  const time = part({ hour: '2-digit', minute: '2-digit', hour12: false });
  return `${part({ day: 'numeric' })} ${part({ month: 'short' })} ${time}`;
}

/** A draft's live result, as the card shows it. */
export interface DraftResult {
  tone: StatusTone;
  label: string;
  why?: string;
  /** True when this draft stops the send (a Block or a refusal that is not a rule). */
  stopsSend: boolean;
}

const RULE_TONE: Record<RuleOutcome, StatusTone> = {
  BLOCK: 'block',
  WARN: 'warn',
  PASS: 'pass',
  INFO: 'pass',
};

/** "Blocked · U-01" with the first reason, from one preview item. */
export function draftResult(item: ProposalPreviewItem): DraftResult {
  if (item.problem) {
    return { tone: 'block', label: "Can't be sent", why: item.problem, stopsSend: true };
  }
  const failing = item.ruleResults.filter((result) => result.outcome === item.outcome);
  const codes = item.outcome === 'BLOCK' || item.outcome === 'WARN'
    ? [...new Set(failing.map((result) => result.ruleCode))]
    : [];
  const word = item.outcome === 'BLOCK' ? 'Blocked' : item.outcome === 'WARN' ? 'Warning' : 'Passes';
  const label = codes.length > 0 ? `${word} · ${codes.join(', ')}` : word;
  const why = failing[0]?.message;
  return {
    tone: RULE_TONE[item.outcome] ?? 'info',
    label,
    ...(codes.length > 0 && why ? { why } : {}),
    stopsSend: item.outcome === 'BLOCK',
  };
}

/** Why Send is not available, or null when it is. */
export function sendBlockedReason(input: {
  draftCount: number;
  checking: boolean;
  checkError: string | null;
  results: (DraftResult | undefined)[];
  noteLength: number;
}): string | null {
  if (input.draftCount === 0) return 'Add a shift first.';
  if (input.checking) return 'Checking the rules…';
  if (input.checkError) return `The rules could not be checked: ${input.checkError}`;
  if (input.results.some((result) => result === undefined)) return 'Checking the rules…';
  const blocked = input.results.filter((result) => result?.stopsSend).length;
  if (blocked > 0) {
    return blocked === 1
      ? "1 shift can't be sent. Remove it to send the others."
      : `${blocked} shifts can't be sent. Remove them to send the others.`;
  }
  if (input.noteLength > MAX_NOTE) return `The note is over ${MAX_NOTE} characters.`;
  return null;
}

export const DISPLAY_STATE: Record<ProposalDisplayState, { text: string; tone: StatusTone }> = {
  WAITING: { text: 'Waiting', tone: 'under' },
  APPROVED: { text: 'Approved', tone: 'pass' },
  PARTLY_APPROVED: { text: 'Partly approved', tone: 'warn' },
  DECLINED: { text: 'Declined', tone: 'block' },
  WITHDRAWN: { text: 'Withdrawn', tone: 'info' },
  EXPIRED: { text: 'Expired', tone: 'info' },
};

export const DECISION: Record<ProposalItemDecision, { text: string; tone: StatusTone }> = {
  PENDING: { text: 'Waiting', tone: 'under' },
  ACCEPTED: { text: 'Approved', tone: 'pass' },
  DECLINED: { text: 'Declined', tone: 'block' },
  WITHDRAWN: { text: 'Withdrawn', tone: 'info' },
  EXPIRED: { text: 'Expired', tone: 'info' },
};

/** The sentence under a shift in My proposals. The comment is plain text. */
export function decisionLine(item: {
  decision: ProposalItemDecision;
  decidedBy: string | null;
  comment: string | null;
}): string | null {
  const by = item.decidedBy ? ` by ${item.decidedBy}` : '';
  switch (item.decision) {
    case 'ACCEPTED':
      return item.comment
        ? `Approved${by}: “${item.comment}”`
        : `Approved${by}. The shift is on your schedule.`;
    case 'DECLINED':
      return item.comment ? `Declined${by}: “${item.comment}”` : `Declined${by}.`;
    case 'EXPIRED':
      return 'Expired: the shift started before anyone answered.';
    case 'WITHDRAWN':
      return 'You withdrew this shift.';
    default:
      return null;
  }
}

/** The first characters of a note, cut on a word. */
export function noteExcerpt(note: string, max = 140): string {
  const flat = note.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** True when a proposal was sent in the 90 days up to the given day. */
export function withinNinetyDays(submittedAt: string, asOf: string | undefined): boolean {
  if (!asOf) return true;
  const sent = new Date(submittedAt).getTime();
  if (Number.isNaN(sent)) return true;
  const cutoff = new Date(`${asOf}T00:00:00Z`).getTime() - 90 * 86_400_000;
  return sent >= cutoff;
}
