import { describe, expect, it } from 'vitest';

import type { RuleTableRow } from '../api/types';
import { composeSentence, isPostsTable, sentenceFor, shiftKindLabel } from './sentences';

/**
 * Every row of the shipped live rule set (v3), exactly as
 * GET /api/v1/rule-sets/3/tables/{table} returned it on a fresh demo stack
 * on 2026-11-24. The live sentence must match the api's word for word, so
 * the panel does not change wording when Build replaces it.
 */
const LIVE_V3: [string, RuleTableRow][] = [
  ["REST", {"ruleCode": "U-01", "enabled": true, "after": "Any shift", "minHours": 8, "result": "BLOCK", "override": "EMERGENCY", "source": "SEA", "params": {"windowHours": 24, "minRestHours": 8, "afterShiftKind": ".*", "minExtensionMinutes": 0}, "sentence": "After any shift, an officer needs at least 8 hours off within 24 hours; otherwise the change is blocked. A supervisor may override only in an emergency, with a written reason."}],
  ["REST", {"ruleCode": "U-02", "enabled": true, "after": "(D8|E8|N8|A12|P12|D12|N12)", "minHours": 12, "result": "WARN", "override": "ACKNOWLEDGE", "source": "MOCK", "params": {"windowHours": 24, "minRestHours": 12, "afterShiftKind": "(D8|E8|N8|A12|P12|D12|N12)", "minExtensionMinutes": 0}, "sentence": "After a D8, E8, N8, A12, P12, D12 or N12 shift, an officer needs at least 12 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved."}],
  ["REST", {"ruleCode": "U-03", "enabled": true, "after": "16 h shift", "minHours": 12, "result": "BLOCK", "override": "EMERGENCY", "source": "MOCK", "params": {"windowHours": 24, "minRestHours": 12, "afterShiftKind": "L16", "minExtensionMinutes": 0}, "sentence": "After a 16-hour shift, an officer needs at least 12 hours off within 24 hours; otherwise the change is blocked. A supervisor may override only in an emergency, with a written reason."}],
  ["REST", {"ruleCode": "U-04", "enabled": true, "after": "Any shift", "minHours": 10, "result": "WARN", "override": "ACKNOWLEDGE", "source": "MOCK", "params": {"windowHours": 24, "minRestHours": 10, "afterShiftKind": ".*", "minExtensionMinutes": 240}, "sentence": "After any shift, an officer needs at least 10 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved."}],
  ["MAX_HOURS", {"ruleCode": "U-05", "enabled": true, "after": "", "minHours": 16, "result": "BLOCK", "override": "EMERGENCY", "source": "SEA", "params": {"maxHours": 16, "windowHours": 24}, "sentence": "No more than 16 hours in 24 hours; otherwise the change is blocked. A supervisor may override only in an emergency, with a written reason."}],
  ["MAX_HOURS", {"ruleCode": "U-14", "enabled": true, "after": "", "minHours": 60, "result": "BLOCK", "override": "ACKNOWLEDGE", "source": "MOCK", "params": {"maxHours": 60, "warnAtHours": 48, "windowHours": 168}, "sentence": "No more than 60 hours in 168 hours; otherwise the change is blocked. It cannot be saved and has no override."}],
  ["CONSECUTIVE", {"ruleCode": "U-08", "enabled": true, "after": "", "minHours": 7, "result": "BLOCK", "override": "ACKNOWLEDGE", "source": "NWT; NU", "params": {"max": 7, "counts": "DAYS", "overtimeSeverity": "WARN"}, "sentence": "No more than 7 consecutive days; a scheduled shift is blocked, and one caused by overtime is warned. It cannot be saved and has no override."}],
  ["CONSECUTIVE", {"ruleCode": "U-09", "enabled": true, "after": "", "minHours": 4, "result": "BLOCK", "override": "ACKNOWLEDGE", "source": "MOCK", "params": {"max": 4, "counts": "SHIFTS_12H", "overtimeSeverity": "WARN"}, "sentence": "No more than 4 consecutive 12-hour shifts; a scheduled shift is blocked, and one caused by overtime is warned. It cannot be saved and has no override."}],
  ["CONSECUTIVE", {"ruleCode": "U-10", "enabled": true, "after": "", "minHours": 4, "result": "WARN", "override": "ACKNOWLEDGE", "source": "MOCK", "params": {"max": 4, "counts": "SHIFTS_NIGHT_12H", "overtimeSeverity": "WARN"}, "sentence": "No more than 4 consecutive overnight 12-hour shifts; a scheduled shift is warned, and one caused by overtime is warned. A supervisor must acknowledge it before the change is saved."}],
  ["LONG_SHIFTS", {"ruleCode": "U-11", "enabled": true, "after": "", "minHours": 3, "result": "WARN", "override": "ACKNOWLEDGE", "source": "MOCK", "params": {"maxIn7Days": 3, "maxIn28Days": 10}, "sentence": "No more than 3 16-hour shifts in 7 days, and 10 in 28 days; otherwise the change is warned. A supervisor must acknowledge it before the change is saved."}],
  ["DAYS_OFF", {"ruleCode": "U-12", "enabled": true, "after": "", "minHours": 2, "result": "WARN", "override": "ACKNOWLEDGE", "source": "CX; PSGE; NU", "params": {"daysOff": 2, "withinDays": 7}, "sentence": "At least 2 consecutive days off in every 7 days; a break of 24 hours or less does not count, and otherwise the change is warned. A supervisor must acknowledge it before the change is saved."}],
  ["PAY", {"ruleCode": "P-01", "enabled": true, "after": "", "minHours": 80, "result": "INFO", "override": "NOT_ALLOWED", "source": "SEA; PSGE", "params": {"thresholdHours": 80, "paidLeaveCounts": false, "thresholdWindow": "PAY_PERIOD"}, "sentence": "Hours beyond 80 in a two-week pay period are overtime."}],
  ["PAY", {"ruleCode": "P-01b", "enabled": true, "after": "", "minHours": 0, "result": "INFO", "override": "NOT_ALLOWED", "source": "MOCK", "params": {"otRate": 1.5}, "sentence": "Overtime hours are paid at 1.5 times the regular rate."}],
  ["PAY", {"ruleCode": "P-04", "enabled": true, "after": "", "minHours": 0, "result": "INFO", "override": "NOT_ALLOWED", "source": "PSGE", "params": {"ignoreUnderMinutes": 30}, "sentence": "Overtime under 30 minutes is not paid."}],
  ["OT_RANKING", {"ruleCode": "O-01", "enabled": true, "after": "", "minHours": 0, "result": "INFO", "override": "NOT_ALLOWED", "source": "CX", "params": {"orderBy": ["OT_HOURS_QUARTER_ASC", "SENIORITY_ASC"], "keepPlace": true, "skipIfBlocked": true}, "sentence": "Offer overtime equitably among available, qualified officers."}],
  ["OT_RANKING", {"ruleCode": "O-02", "enabled": true, "after": "", "minHours": 0, "result": "INFO", "override": "NOT_ALLOWED", "source": "MOCK", "params": {"orderBy": ["OT_HOURS_QUARTER_ASC", "SENIORITY_ASC"]}, "sentence": "Fewest overtime hours this quarter first, ties broken by seniority."}],
  ["OT_RANKING", {"ruleCode": "O-03", "enabled": true, "after": "", "minHours": 0, "result": "INFO", "override": "NOT_ALLOWED", "source": "MOCK", "params": {"keepPlace": true, "skipIfBlocked": true}, "sentence": "Officers who would break a block rule are skipped and not penalised."}],
  ["SHIFT_LENGTHS", {"ruleCode": "L-01", "enabled": true, "after": "", "minHours": 0, "result": "BLOCK", "override": "NOT_ALLOWED", "source": "Lead direction; PSGE", "params": {"allowedLengths": [8, 12, 16]}, "sentence": "Only 8, 12 and 16-hour shifts; longer patterns need a local agreement on the unit."}],
  ["SHIFT_LENGTHS", {"ruleCode": "S-03", "enabled": true, "after": "", "minHours": 0, "result": "BLOCK", "override": "NOT_ALLOWED", "source": "PSGE", "params": {"requireUnitFlagFor": [12, 16]}, "sentence": "12- and 16-hour patterns are allowed only on units with a local agreement."}],
  ["SHIFT_LENGTHS", {"ruleCode": "U-16", "enabled": true, "after": "", "minHours": 0, "result": "WARN", "override": "ACKNOWLEDGE", "source": "Person (release 4 #10)", "params": {"nightShiftOnly": true}, "sentence": "An 8-hour officer is assigned to a night shift; 8-hour officers work day or evening."}],
];

function row(code: string): [string, RuleTableRow] {
  const found = LIVE_V3.find(([, candidate]) => candidate.ruleCode === code);
  if (!found) throw new Error(code);
  return found;
}

/** An edit as the grid makes it: the field and the param it stores. */
function edited(code: string, patch: Partial<RuleTableRow>, paramKey?: string): [string, RuleTableRow] {
  const [table, base] = row(code);
  const params = { ...(base.params ?? {}) };
  if (paramKey && patch.minHours !== undefined) params[paramKey] = patch.minHours;
  if (patch.after !== undefined) params.afterShiftKind = patch.after;
  return [table, { ...base, ...patch, params }];
}

/** Plain words: no stored pattern, no enum, no clause said twice. */
function expectPlain(sentence: string) {
  expect(sentence).not.toMatch(/[|()]|\.\*/);
  expect(sentence).not.toMatch(/\b(BLOCK|WARN|INFO|DAYS|SHIFTS_12H|SHIFTS_NIGHT_12H)\b/);
  expect(sentence).not.toMatch(/ {2}|\.\./);
  expect(sentence.match(/acknowledge/g)?.length ?? 0).toBeLessThanOrEqual(1);
  const clauses = sentence.split(/[.;,] /).map((clause) => clause.trim().toLowerCase());
  expect(new Set(clauses).size).toBe(clauses.length);
  expect(sentence).toMatch(/^[A-Z0-9].*\.$/);
}

describe('composeSentence', () => {
  // The 11 composed rows (rest, hours, runs, 16 h, days off). The 9 message
  // rows pass the api sentence through and are covered further down.
  const COMPOSED = new Set(['REST', 'MAX_HOURS', 'CONSECUTIVE', 'LONG_SHIFTS', 'DAYS_OFF']);
  it.each(
    LIVE_V3.filter(([table]) => COMPOSED.has(table)).map(([table, r]) => [r.ruleCode, table, r] as const),
  )(
    '%s: an unedited row composes exactly the api sentence',
    (_code, table, r) => {
      expect(composeSentence(table, r)).toBe(r.sentence);
      expectPlain(composeSentence(table, r));
    },
  );

  it('also takes the web route slug for the table', () => {
    const [, u02] = row('U-02');
    expect(composeSentence('rest-between-shifts', u02)).toBe(u02.sentence);
  });

  // Demo §4 / E3: U-02 12 -> 14 h. The sentence used to read
  // "After (d8|e8|n8|a12|p12|d12|n12), ... has to acknowledge it, and the
  // supervisor has to acknowledge it."
  it('U-02 at 14 h names the shifts in words and says the outcome once', () => {
    const sentence = composeSentence(...edited('U-02', { minHours: 14 }, 'minRestHours'));
    expect(sentence).toBe(
      'After a D8, E8, N8, A12, P12, D12 or N12 shift, an officer needs at least 14 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
    );
    expectPlain(sentence);
  });

  it('U-01 at 9 h', () => {
    expect(composeSentence(...edited('U-01', { minHours: 9 }, 'minRestHours'))).toBe(
      'After any shift, an officer needs at least 9 hours off within 24 hours; otherwise the change is blocked. A supervisor may override only in an emergency, with a written reason.',
    );
  });

  it('U-03 at 14 h', () => {
    expect(composeSentence(...edited('U-03', { minHours: 14 }, 'minRestHours'))).toBe(
      'After a 16-hour shift, an officer needs at least 14 hours off within 24 hours; otherwise the change is blocked. A supervisor may override only in an emergency, with a written reason.',
    );
  });

  it('U-04 at 11 h', () => {
    expect(composeSentence(...edited('U-04', { minHours: 11 }, 'minRestHours'))).toBe(
      'After any shift, an officer needs at least 11 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
    );
  });

  it('U-05 at 15 h (not a rest sentence)', () => {
    expect(composeSentence(...edited('U-05', { minHours: 15 }, 'maxHours'))).toBe(
      'No more than 15 hours in 24 hours; otherwise the change is blocked. A supervisor may override only in an emergency, with a written reason.',
    );
  });

  it('U-14 at 56 h', () => {
    expect(composeSentence(...edited('U-14', { minHours: 56 }, 'maxHours'))).toBe(
      'No more than 56 hours in 168 hours; otherwise the change is blocked. It cannot be saved and has no override.',
    );
  });

  it('U-08 at 6 days', () => {
    expect(composeSentence(...edited('U-08', { minHours: 6 }, 'max'))).toBe(
      'No more than 6 consecutive days; a scheduled shift is blocked, and one caused by overtime is warned. It cannot be saved and has no override.',
    );
  });

  it('U-09 at 3', () => {
    expect(composeSentence(...edited('U-09', { minHours: 3 }, 'max'))).toBe(
      'No more than 3 consecutive 12-hour shifts; a scheduled shift is blocked, and one caused by overtime is warned. It cannot be saved and has no override.',
    );
  });

  it('U-10 at 3', () => {
    expect(composeSentence(...edited('U-10', { minHours: 3 }, 'max'))).toBe(
      'No more than 3 consecutive overnight 12-hour shifts; a scheduled shift is warned, and one caused by overtime is warned. A supervisor must acknowledge it before the change is saved.',
    );
  });

  it('U-11 at 2', () => {
    expect(composeSentence(...edited('U-11', { minHours: 2 }, 'maxIn7Days'))).toBe(
      'No more than 2 16-hour shifts in 7 days, and 10 in 28 days; otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
    );
  });

  it('U-12 at 3 days', () => {
    expect(composeSentence(...edited('U-12', { minHours: 3 }, 'daysOff'))).toBe(
      'At least 3 consecutive days off in every 7 days; a break of 24 hours or less does not count, and otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
    );
  });

  it.each(['P-01', 'P-01b', 'P-04', 'O-01', 'O-02', 'O-03', 'L-01', 'S-03', 'U-16'])(
    '%s: a message row keeps the api sentence when edited',
    (code) => {
      const [table, r] = row(code);
      expect(composeSentence(table, { ...r, minHours: 99, result: 'WARN' })).toBe(r.sentence);
    },
  );

  it.each([
    ['Any shift', 'After any shift,'],
    ['Regular shift', 'After a regular shift,'],
    ['16 h shift', 'After a 16-hour shift,'],
    ['12 h 00–12', 'After a 12-hour day shift (00:00–12:00),'],
    ['12 h 12–24', 'After a 12-hour evening shift (12:00–24:00),'],
    ['(D8|E8|N8|A12|P12)', 'After a regular shift,'],
    ['D8|E8', 'After a D8 or E8 shift,'],
    ['(N12)', 'After a N12 shift,'],
  ])('the shift kind %s reads "%s"', (after, start) => {
    expect(composeSentence(...edited('U-02', { after }))).toMatch(
      new RegExp(`^${start.replace(/[()]/g, '\\$&')}`),
    );
  });

  it('every result and override choice on every editable rule reads plainly, once', () => {
    const results: RuleTableRow['result'][] = ['BLOCK', 'WARN', 'INFO'];
    const overrides: RuleTableRow['override'][] = ['EMERGENCY', 'ACKNOWLEDGE', 'NOT_ALLOWED'];
    for (const code of ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-14', 'U-08', 'U-09', 'U-10', 'U-11', 'U-12']) {
      for (const result of results) {
        for (const override of overrides) {
          const [table, r] = row(code);
          const sentence = composeSentence(table, { ...r, result, override });
          expectPlain(sentence);
        }
      }
    }
  });
});

describe('sentenceFor', () => {
  it('shows the api sentence until the row is edited', () => {
    const [table, u02] = row('U-02');
    const changed = { ...u02, minHours: 14 };
    expect(sentenceFor(table, changed, false)).toBe(u02.sentence);
    expect(sentenceFor(table, changed, true)).toContain('at least 14 hours off');
  });
});

describe('shiftKindLabel', () => {
  it('shows a stored pattern as shift codes in words', () => {
    expect(shiftKindLabel('(D8|E8|N8|A12|P12|D12|N12)')).toBe('D8, E8, N8, A12, P12, D12 or N12');
    expect(shiftKindLabel('D8|E8')).toBe('D8 or E8');
  });

  it('leaves the friendly labels alone', () => {
    expect(shiftKindLabel('Any shift')).toBe('Any shift');
    expect(shiftKindLabel('16 h shift')).toBe('16 h shift');
  });
});

/**
 * The "Who can work a post" table (release v1.3, R-01/R-02), exactly as
 * GET /api/v1/rule-sets/4/tables/posts returns it (pinned by the api's
 * RuleSentenceTest and PostEligibilityApiTest).
 */
const LIVE_V4_POSTS: [string, RuleTableRow][] = [
  ["POSTS", {"ruleCode": "R-01", "enabled": true, "after": "", "minHours": 0, "result": "BLOCK", "override": "NOT_ALLOWED", "source": "Owner item 17", "params": {"postKind": "SUPERVISION", "allowedPositions": ["CS"], "actingQualification": "ACTING_SUP"}, "sentence": "Only supervisors can work a supervisor post; anyone else is blocked. It cannot be overridden. Someone with the Acting supervisor qualification is warned instead, and a supervisor must acknowledge it."}],
  ["POSTS", {"ruleCode": "R-02", "enabled": true, "after": "", "minHours": 0, "result": "WARN", "override": "ACKNOWLEDGE", "source": "Owner item 17", "params": {"postKind": "LINE", "allowedPositions": ["CO"]}, "sentence": "Only officers can work an officer post; anyone else is warned. A supervisor must acknowledge it before the change is saved."}],
];

function post(code: string, patch: Partial<RuleTableRow> = {}, params: Record<string, unknown> = {}): RuleTableRow {
  const found = LIVE_V4_POSTS.find(([, candidate]) => candidate.ruleCode === code);
  if (!found) throw new Error(code);
  return { ...found[1], ...patch, params: { ...found[1].params, ...params } };
}

describe('who can work a post', () => {
  it.each(LIVE_V4_POSTS.map(([table, r]) => [r.ruleCode, table, r] as const))(
    '%s: an unedited row composes exactly the api sentence',
    (_code, table, r) => {
      expect(composeSentence(table, r)).toBe(r.sentence);
      expect(composeSentence('posts', r)).toBe(r.sentence);
    },
  );

  it('R-01 without the acting qualification blocks everyone else, with no warning clause', () => {
    expect(composeSentence('posts', post('R-01', {}, { actingQualification: null }))).toBe(
      'Only supervisors can work a supervisor post; anyone else is blocked. It cannot be overridden.',
    );
  });

  it('the acting qualification only softens a Block', () => {
    expect(composeSentence('posts', post('R-01', { result: 'WARN', override: 'ACKNOWLEDGE' }))).toBe(
      'Only supervisors can work a supervisor post; anyone else is warned. A supervisor must acknowledge it before the change is saved.',
    );
  });

  it('who can work the post reads as people, never as codes', () => {
    const sentence = composeSentence('posts', post('R-02', {}, { allowedPositions: ['CS'] }));
    expect(sentence).toMatch(/^Only supervisors can work an officer post;/);
    expect(composeSentence('posts', post('R-02', {}, { allowedPositions: ['CO', 'CS'] }))).toMatch(
      /^Only officers and supervisors can work/,
    );
  });

  it('every result and override choice reads plainly, with no stored code', () => {
    const results: RuleTableRow['result'][] = ['BLOCK', 'WARN', 'INFO'];
    const overrides: RuleTableRow['override'][] = ['EMERGENCY', 'ACKNOWLEDGE', 'NOT_ALLOWED'];
    for (const code of ['R-01', 'R-02']) {
      for (const result of results) {
        for (const override of overrides) {
          const sentence = composeSentence('posts', post(code, { result, override }));
          expectPlain(sentence);
          expect(sentence).not.toMatch(/SUPERVISION|LINE|ACTING_SUP|\bC[OS]\b|\[/);
        }
      }
    }
  });

  it('knows the posts table by its slug and by the api code', () => {
    expect(isPostsTable('posts')).toBe(true);
    expect(isPostsTable('POSTS')).toBe(true);
    expect(isPostsTable('shift-types')).toBe(false);
  });
});
