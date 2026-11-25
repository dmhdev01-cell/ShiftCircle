import { describe, expect, it } from 'vitest';

import type { ProposalDetailItem, RuleResult } from '../api/types';
import {
  currentMatch,
  itemNeeds,
  openShiftLine,
  ordinal,
  overtimeLine,
  resultChanged,
  ruleLabel,
  sendLabel,
  unitLabel,
  wasNowLine,
} from './inboxWords';

const warn = (code: string): RuleResult => ({
  ruleCode: code,
  ruleTable: 'HOURS',
  outcome: 'WARN',
  overridePolicy: 'ACKNOWLEDGE',
  message: `${code} warns`,
});
const block = (code: string): RuleResult => ({
  ruleCode: code,
  ruleTable: 'REST',
  outcome: 'BLOCK',
  overridePolicy: 'EMERGENCY',
  message: `${code} blocks`,
});

function item(extra: Partial<ProposalDetailItem> = {}): ProposalDetailItem {
  return {
    id: 'i1',
    unitId: 'u',
    unit: 'B',
    unitName: 'Unit B',
    shiftTemplate: 'D8',
    startAt: '2026-11-21T07:00:00-06:00',
    endAt: '2026-11-21T15:00:00-06:00',
    workDate: '2026-11-21',
    hours: 8,
    decision: 'PENDING',
    inScope: true,
    canDecide: true,
    outcomeAtSubmit: 'PASS',
    ruleAtSubmit: { outcome: 'PASS', ruleResults: [] },
    outcomeNow: 'PASS',
    ruleNow: { outcome: 'PASS', ruleSetVersion: 7, overridable: false, ruleResults: [] },
    ruleChanged: false,
    wouldBeOvertimeHours: 0,
    payPeriod: null,
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

describe('the inbox words (v1.3 P4)', () => {
  it('names a rule result with its flagged codes, each once', () => {
    expect(ruleLabel('PASS', [])).toBe('Passes');
    expect(ruleLabel('WARN', [warn('U-14'), warn('U-14'), warn('U-02')])).toBe('Warning · U-14, U-02');
    expect(ruleLabel('BLOCK', [block('U-01'), warn('U-14')])).toBe('Blocked · U-01');
    expect(ruleLabel(null)).toBe('Not checked');
  });

  it('says "was / now" only when the result moved since the send', () => {
    const now = { outcome: 'WARN' as const, ruleSetVersion: 7, overridable: false, ruleResults: [warn('U-14')] };
    expect(wasNowLine(item(), now, true)).toBe('Was Passes, now Warning · U-14');
    expect(wasNowLine(item(), item().ruleNow, false)).toBe('Passes when sent and now');
    expect(resultChanged(item(), now)).toBe(true);
    expect(resultChanged(item(), item().ruleNow)).toBe(false);
    // Same outcome, different rule: still a change.
    const sentWarn = item({ outcomeAtSubmit: 'WARN', ruleAtSubmit: { outcome: 'WARN', ruleResults: [warn('U-02')] } });
    expect(resultChanged(sentWarn, now)).toBe(true);
  });

  it('says how much of the shift would be overtime in the pay period', () => {
    const withPay = item({
      payPeriod: {
        start: '2026-11-23',
        end: '2026-12-06',
        hoursBefore: 80,
        hoursAfter: 88,
        thresholdHours: 80,
        wouldBeOvertimeHours: 8,
        overtimeStatus: 'IN_OVERTIME',
      },
    });
    expect(overtimeLine(withPay, 'Tara')).toBe(
      'Would be overtime: 8 h · brings Tara to 88 h of 80 h in this pay period',
    );
    expect(overtimeLine(item(), 'Tara')).toBeNull();
  });

  it('places the officer in the overtime order, or says the shift is above minimum', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(22)).toBe('22nd');
    expect(openShiftLine(null, 'Tara')).toBe(
      'No open shift for this slot: approving adds an extra shift above minimum.',
    );
    const match = {
      id: 'os',
      status: 'OPEN',
      otOrderPosition: 3,
      otOrderSize: 12,
      eligibility: 'ELIGIBLE',
      outOfOrder: true,
      liveOffers: 2,
    };
    expect(openShiftLine(match, 'Tara')).toBe(
      'Matches an open shift: Tara is 3rd of 12 in the overtime order. Approving fills it and withdraws 2 waiting offers.',
    );
    expect(openShiftLine({ ...match, otOrderPosition: null, liveOffers: 0 }, 'Tara')).toBe(
      'Matches an open shift: Tara is not eligible in its overtime order (12 eligible). Approving fills it.',
    );
  });

  it('lists what a shift still needs before the decision can be sent', () => {
    const base = { outcome: 'PASS' as const, warnCodes: [] as string[], outOfOrder: false };
    const draft = { choice: undefined, comment: '', acknowledgedWarnings: [], acknowledgedOrder: false };
    expect(itemNeeds({ ...base, draft: undefined })).toMatch(/Choose Approve or Decline/);
    expect(itemNeeds({ ...base, draft: { ...draft, choice: 'decline', comment: 'no' } })).toMatch(
      /needs a comment/,
    );
    expect(itemNeeds({ ...base, draft: { ...draft, choice: 'decline', comment: 'Fully staffed' } })).toBeNull();
    expect(itemNeeds({ ...base, outcome: 'BLOCK', draft: { ...draft, choice: 'accept' } })).toMatch(
      /can't be approved from a proposal/,
    );
    expect(
      itemNeeds({ ...base, warnCodes: ['U-14'], draft: { ...draft, choice: 'accept' } }),
    ).toMatch(/Acknowledge the warnings/);
    // A warning that appeared after the tick needs a new tick.
    expect(
      itemNeeds({
        ...base,
        warnCodes: ['U-14', 'U-02'],
        draft: { ...draft, choice: 'accept', acknowledgedWarnings: ['U-14'] },
      }),
    ).toMatch(/Acknowledge the warnings/);
    expect(
      itemNeeds({
        ...base,
        warnCodes: ['U-14'],
        outOfOrder: true,
        draft: { ...draft, choice: 'accept', acknowledgedWarnings: ['U-14'] },
      }),
    ).toMatch(/outside the overtime order/);
    expect(
      itemNeeds({
        ...base,
        outOfOrder: true,
        draft: { ...draft, choice: 'accept', acknowledgedOrder: true },
      }),
    ).toBeNull();
    expect(sendLabel(2, 1)).toBe('Send decision (2 accepted, 1 declined)');
  });

  it('takes a fresh refusal as authoritative for the open-shift match', () => {
    const match = {
      id: 'os',
      status: 'OPEN',
      otOrderPosition: 3,
      otOrderSize: 12,
      eligibility: 'ELIGIBLE',
      outOfOrder: true,
      liveOffers: 0,
    };
    const fresh = { id: 'i1', unit: 'B', shiftTemplate: 'D8', startAt: 'x', outcome: 'WARN' as const, warnCodes: [], ruleResults: [] };
    expect(currentMatch(item({ openShift: match }), undefined)).toBe(match);
    expect(currentMatch(item({ openShift: match }), fresh)).toBeNull();
    expect(
      currentMatch(item({ openShift: match }), { ...fresh, otOrderPosition: 1, otOrderSize: 12, outOfOrder: false }),
    ).toMatchObject({ otOrderPosition: 1, otOrderSize: 12, outOfOrder: false });
  });

  it('takes the live offer count from a fresh refusal, not the stale detail (P5)', () => {
    const match = {
      id: 'os',
      status: 'OFFERS_SENT',
      otOrderPosition: 3,
      otOrderSize: 12,
      eligibility: 'ELIGIBLE',
      outOfOrder: true,
      liveOffers: 4,
    };
    const fresh = { id: 'i1', unit: 'B', shiftTemplate: 'D8', startAt: 'x', outcome: 'WARN' as const, warnCodes: [], ruleResults: [] };
    expect(
      currentMatch(item({ openShift: match }), { ...fresh, otOrderPosition: 2, otOrderSize: 12, outOfOrder: true, openShiftId: 'os', liveOffers: 1 }),
    ).toMatchObject({ id: 'os', liveOffers: 1 });
    // An older api without the count keeps the detail's.
    expect(
      currentMatch(item({ openShift: match }), { ...fresh, otOrderPosition: 2, otOrderSize: 12, outOfOrder: true }),
    ).toMatchObject({ liveOffers: 4 });
  });

  it('labels a card unit by its name, keeping the short "Unit B" (P5 UI gate)', () => {
    const names = new Map([
      ['B', 'Unit B · Living unit'],
      ['ADM', 'Admissions'],
      ['SUP-L', 'Supervision · Living units'],
    ]);
    expect(unitLabel('B', names)).toBe('Unit B');
    expect(unitLabel('ADM', names)).toBe('Admissions');
    expect(unitLabel('SUP-L', names)).toBe('Supervision · Living units');
    expect(unitLabel('CTL', names)).toBe('Unit CTL');
  });
});
