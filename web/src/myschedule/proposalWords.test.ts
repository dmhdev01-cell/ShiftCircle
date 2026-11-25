import { describe, expect, it } from 'vitest';

import type { ProposalPreviewItem } from '../api/types';
import {
  decisionLine,
  draftResult,
  draftStartAt,
  nextDay,
  noteExcerpt,
  sendBlockedReason,
  sentWhen,
  shiftLine,
  withinNinetyDays,
} from './proposalWords';

function previewItem(extra: Partial<ProposalPreviewItem>): ProposalPreviewItem {
  return {
    index: 0,
    unitId: 'u',
    unit: 'B',
    shiftTemplate: 'D8',
    startAt: '2026-11-22T07:00:00-06:00',
    endAt: '2026-11-22T15:00:00-06:00',
    outcome: 'PASS',
    ruleSetVersion: 3,
    ruleResults: [],
    problem: null,
    problemCode: null,
    ...extra,
  };
}

describe('proposal words', () => {
  it('names a shift by day, template, times and unit', () => {
    expect(shiftLine('2026-11-22', 'N8', 'Unit B · Living unit')).toBe(
      'Sun 22 Nov · N8 23:00 – 07:00 +1 · Unit B · Living unit',
    );
    expect(shiftLine('2026-11-21', 'P12')).toBe('Sat 21 Nov · P12 12:00 – 24:00');
  });

  it('builds the start instant in Regina time and the next day', () => {
    expect(draftStartAt('2026-11-22', 'N12')).toBe('2026-11-22T19:00:00-06:00');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });

  it('shows the sent time in the centre zone', () => {
    expect(sentWhen('2026-11-19T20:20:00Z')).toBe('19 Nov 14:20');
  });

  it('labels a draft Passes, Warning or Blocked with the codes and the first reason', () => {
    expect(draftResult(previewItem({}))).toEqual({ tone: 'pass', label: 'Passes', stopsSend: false });
    const warn = draftResult(
      previewItem({
        outcome: 'WARN',
        ruleResults: [
          { ruleCode: 'U-01', ruleTable: 'REST', outcome: 'PASS', message: 'ok', overridePolicy: 'EMERGENCY' },
          { ruleCode: 'U-02', ruleTable: 'REST', outcome: 'WARN', message: 'Short rest', overridePolicy: 'ACKNOWLEDGE' },
        ],
      }),
    );
    expect(warn).toEqual({ tone: 'warn', label: 'Warning · U-02', why: 'Short rest', stopsSend: false });
    const block = draftResult(
      previewItem({
        outcome: 'BLOCK',
        ruleResults: [
          { ruleCode: 'U-01', ruleTable: 'REST', outcome: 'BLOCK', message: 'No rest', overridePolicy: 'EMERGENCY' },
          { ruleCode: 'U-05', ruleTable: 'HOURS', outcome: 'BLOCK', message: 'Too long', overridePolicy: 'EMERGENCY' },
        ],
      }),
    );
    expect(block.label).toBe('Blocked · U-01, U-05');
    expect(block.stopsSend).toBe(true);
  });

  it('stops the send on a refusal that is not a rule', () => {
    const result = draftResult(previewItem({ problem: 'That pay period is locked.', problemCode: 'pay-period-locked' }));
    expect(result).toEqual({ tone: 'block', label: "Can't be sent", why: 'That pay period is locked.', stopsSend: true });
  });

  it('gives the reason Send is off, in order', () => {
    const pass = { tone: 'pass' as const, label: 'Passes', stopsSend: false };
    const block = { tone: 'block' as const, label: 'Blocked', stopsSend: true };
    const base = { draftCount: 1, checking: false, checkError: null, results: [pass], noteLength: 0 };
    expect(sendBlockedReason({ ...base, draftCount: 0, results: [] })).toBe('Add a shift first.');
    expect(sendBlockedReason({ ...base, checking: true })).toBe('Checking the rules…');
    expect(sendBlockedReason({ ...base, results: [undefined] })).toBe('Checking the rules…');
    expect(sendBlockedReason({ ...base, checkError: 'down' })).toBe('The rules could not be checked: down');
    expect(sendBlockedReason({ ...base, draftCount: 3, results: [block, pass, block] })).toBe(
      "2 shifts can't be sent. Remove them to send the others.",
    );
    expect(sendBlockedReason({ ...base, noteLength: 501 })).toBe('The note is over 500 characters.');
    expect(sendBlockedReason({ ...base, noteLength: 500 })).toBeNull();
  });

  it('words each outcome, quoting the comment', () => {
    expect(decisionLine({ decision: 'DECLINED', decidedBy: 'J. Chen', comment: 'Unit is fully staffed that night' })).toBe(
      'Declined by J. Chen: “Unit is fully staffed that night”',
    );
    expect(decisionLine({ decision: 'ACCEPTED', decidedBy: 'M. Ellis', comment: null })).toBe(
      'Approved by M. Ellis. The shift is on your schedule.',
    );
    expect(decisionLine({ decision: 'EXPIRED', decidedBy: null, comment: null })).toBe(
      'Expired: the shift started before anyone answered.',
    );
    expect(decisionLine({ decision: 'WITHDRAWN', decidedBy: null, comment: null })).toBe(
      'You withdrew this shift.',
    );
    expect(decisionLine({ decision: 'PENDING', decidedBy: null, comment: null })).toBeNull();
  });

  it('cuts a long note on a word', () => {
    expect(noteExcerpt('short  note\nhere')).toBe('short note here');
    const long = `${'word '.repeat(40)}end`;
    const cut = noteExcerpt(long, 50);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
  });

  it('keeps the last 90 days', () => {
    expect(withinNinetyDays('2026-08-21T12:00:00Z', '2026-11-19')).toBe(true);
    expect(withinNinetyDays('2026-08-20T12:00:00Z', '2026-11-19')).toBe(false);
    expect(withinNinetyDays('2026-01-01T00:00:00Z', undefined)).toBe(true);
  });
});
