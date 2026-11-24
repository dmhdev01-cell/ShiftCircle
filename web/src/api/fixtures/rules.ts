/**
 * Demo data for the Rules admin screen (docs/ui/README.md §5.4,
 * docs/ui/build-notes.md §2.6).
 *
 * The rule tables are the eight from docs/05-union-rules.md. The rows carry
 * the plain-language sentences the admin edits, so the screen shows what the
 * api sends and never writes a sentence of its own.
 */

import type {
  BuildReport,
  RuleSetVersion,
  RuleTable,
  RuleTableRow,
} from '../types';

export const demoRuleSets: RuleSetVersion[] = [
  { version: 7, status: 'LIVE', live: true, publishedAt: '20 Nov 13:50' },
  {
    version: 8,
    status: 'DRAFT',
    live: false,
    createdBy: 'L. Fraser',
    createdAt: '20 Nov 14:05',
    reason: 'Raise the weekly ceiling',
  },
  { version: 6, status: 'PUBLISHED', live: false, publishedAt: '6 Nov 09:12' },
  { version: 5, status: 'PUBLISHED', live: false, publishedAt: '23 Oct 15:40' },
];

const restRows: RuleTableRow[] = [
  {
    ruleCode: 'U-01',
    enabled: true,
    after: 'Any shift',
    minHours: 8,
    result: 'BLOCK',
    override: 'EMERGENCY',
    source: 'Employment Act',
    min: 8,
    params: { afterShiftKind: '.*', windowHours: 24, minExtensionMinutes: 0, minRestHours: 8 },
    sentence:
      'After a 12 h 00–12 shift, an officer needs at least 8 hours off. If they do not get it, the assignment is blocked, and a supervisor may override it in an emergency.',
  },
  {
    ruleCode: 'U-02',
    enabled: true,
    // As the api sends it since rule set v2: the stored pattern, which the
    // grid shows as "D8, E8, N8, A12, P12, D12 or N12".
    after: '(D8|E8|N8|A12|P12|D12|N12)',
    minHours: 12,
    result: 'WARN',
    override: 'ACKNOWLEDGE',
    source: 'Mock agreement',
    params: {
      afterShiftKind: '(D8|E8|N8|A12|P12|D12|N12)',
      windowHours: 24,
      minExtensionMinutes: 0,
      minRestHours: 12,
    },
    sentence:
      'After a D8, E8, N8, A12, P12, D12 or N12 shift, an officer needs at least 12 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
  },
  {
    ruleCode: 'U-03',
    enabled: true,
    after: '16 h shift',
    minHours: 12,
    result: 'BLOCK',
    override: 'EMERGENCY',
    source: 'Mock agreement',
    params: { afterShiftKind: 'L16', windowHours: 24, minExtensionMinutes: 0, minRestHours: 12 },
    sentence:
      'After a 16 h shift an officer needs at least 12 hours off. If they would not get them, the assignment is blocked.',
  },
  {
    ruleCode: 'U-04',
    enabled: true,
    after: 'Any shift',
    minHours: 10,
    result: 'WARN',
    override: 'ACKNOWLEDGE',
    source: 'Mock agreement',
    params: { afterShiftKind: '.*', windowHours: 24, minExtensionMinutes: 240, minRestHours: 10 },
    sentence:
      'After an overtime extension of 4 hours or more an officer needs at least 10 hours off. If they would not get them, the supervisor is warned.',
  },
];

export const demoRuleTables: RuleTable[] = [
  {
    code: 'rest-between-shifts',
    name: 'Rest between shifts',
    hoursParam: 'minRestHours',
    afterParam: 'afterShiftKind',
    columns: {
      after: 'After this kind of shift…',
      hours: '…needs at least',
      result: 'If not',
      override: 'Override',
    },
    rows: restRows,
    changed: 1,
  },
  {
    code: 'maximum-hours',
    name: 'Maximum hours',
    hoursParam: 'maxHours',
    columns: {
      after: 'In a window of…',
      hours: '…at most',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'U-05',
        enabled: true,
        after: 'Any 24 hours',
        minHours: 16,
        result: 'BLOCK',
        override: 'EMERGENCY',
        source: 'Employment Act',
        params: { maxHours: 16, windowHours: 24 },
        sentence:
          'In any 24 hours an officer may work at most 16 hours. If they would work more, the assignment is blocked.',
      },
      {
        ruleCode: 'U-14',
        enabled: true,
        after: 'Any 7 days',
        minHours: 60,
        result: 'BLOCK',
        override: 'NOT_ALLOWED',
        source: 'Mock agreement',
        params: { warnAtHours: 48, maxHours: 60, windowHours: 168 },
        sentence:
          'An officer is warned above 48 hours in 7 days and blocked above 60. The weekly ceiling cannot be overridden.',
      },
    ],
    changed: 0,
  },
  {
    code: 'consecutive-work',
    name: 'Consecutive work',
    hoursParam: 'max',
    columns: {
      after: 'Counting…',
      hours: '…at most',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'U-08',
        enabled: true,
        after: 'Days worked in a row',
        minHours: 7,
        result: 'BLOCK',
        override: 'ACKNOWLEDGE',
        source: 'Mock agreement',
        params: { counts: 'DAYS', max: 7, overtimeSeverity: 'WARN' },
        sentence:
          'An officer may work at most 7 days in a row. If they would work an 8th, the assignment is blocked.',
      },
      {
        ruleCode: 'U-09',
        enabled: true,
        after: '12-hour shifts in a row',
        minHours: 4,
        result: 'BLOCK',
        override: 'ACKNOWLEDGE',
        source: 'Mock agreement',
        params: { counts: 'SHIFTS_12H', max: 4, overtimeSeverity: 'WARN' },
        sentence:
          'An officer may work at most 4 12-hour shifts in a row. If they would work a 5th, the assignment is blocked.',
      },
      {
        ruleCode: 'U-10',
        enabled: true,
        after: 'Overnight 12-hour shifts in a row',
        minHours: 4,
        result: 'WARN',
        override: 'ACKNOWLEDGE',
        source: 'Mock agreement',
        params: { counts: 'SHIFTS_NIGHT_12H', max: 4, overtimeSeverity: 'WARN' },
        sentence:
          'An officer is warned above 4 overnight 12-hour shifts in a row.',
      },
    ],
    changed: 0,
  },
  {
    code: 'sixteen-hour-shifts',
    name: '16-hour shifts',
    hoursParam: 'maxIn7Days',
    columns: {
      after: 'In a window of…',
      hours: '…at most',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'U-11',
        enabled: true,
        after: 'Any 7 or 28 days',
        minHours: 3,
        result: 'WARN',
        override: 'ACKNOWLEDGE',
        source: 'Mock agreement',
        params: { maxIn7Days: 3, maxIn28Days: 10 },
        sentence:
          'An officer is warned above 3 16-hour shifts in 7 days or 10 in 28 days.',
      },
    ],
    changed: 0,
  },
  {
    code: 'days-off',
    name: 'Days off',
    hoursParam: 'daysOff',
    columns: {
      after: 'Within…',
      hours: '…at least',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'U-12',
        enabled: true,
        after: 'Any 7 days',
        minHours: 2,
        result: 'WARN',
        override: 'ACKNOWLEDGE',
        source: 'Mock agreement',
        params: { daysOff: 2, withinDays: 7 },
        sentence:
          'An officer is warned when they would get fewer than 2 days off in a row in 7 days.',
      },
    ],
    changed: 0,
  },
  {
    code: 'pay-classification',
    name: 'Pay classification',
    hoursParam: 'thresholdHours',
    columns: {
      after: 'In a window of…',
      hours: '…at most',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'P-01',
        enabled: true,
        after: 'Any pay period',
        minHours: 80,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Mock agreement',
        params: { thresholdHours: 80 },
        sentence:
          'An officer may work at most 80 hours in a pay period before the hours are overtime. If they work more, the extra hours are overtime at 1.5 times.',
      },
    ],
    changed: 0,
  },
  {
    code: 'overtime-ranking',
    name: 'Overtime ranking',
    columns: {
      after: 'Rank by…',
      hours: '…then by',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'O-02',
        enabled: true,
        after: 'Fewest overtime hours this quarter',
        minHours: 1,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Mock agreement',
        sentence:
          'Officers who would break a Block rule are skipped without losing their place, and are ranked by their seniority date.',
      },
    ],
    changed: 0,
  },
  {
    code: 'shift-types',
    name: 'Shift types',
    columns: {
      after: 'Runs…',
      hours: '…for',
      result: 'If not',
      override: 'Override',
    },
    rows: [
      {
        ruleCode: 'D8',
        enabled: true,
        after: '07:00 – 15:00',
        minHours: 8,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Shift types',
        sentence: 'D8 runs 07:00 – 15:00 (8 h). Regular shift.',
      },
      {
        ruleCode: 'E8',
        enabled: true,
        after: '15:00 – 23:00',
        minHours: 8,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Shift types',
        sentence: 'E8 runs 15:00 – 23:00 (8 h). Regular shift.',
      },
      {
        ruleCode: 'N8',
        enabled: true,
        after: '23:00 – 07:00 +1',
        minHours: 8,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Shift types',
        sentence: 'N8 runs 23:00 – 07:00 (8 h). Regular shift.',
      },
      {
        ruleCode: 'A12',
        enabled: true,
        after: '00:00 – 12:00',
        minHours: 12,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Shift types',
        sentence: 'A12 runs 00:00 – 12:00 (12 h). Regular shift.',
      },
      {
        ruleCode: 'P12',
        enabled: true,
        after: '12:00 – 24:00',
        minHours: 12,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Shift types',
        sentence: 'P12 runs 12:00 – 24:00 (12 h). Regular shift.',
      },
      {
        ruleCode: 'L16',
        enabled: true,
        after: '20:00 – 12:00 +1',
        minHours: 16,
        result: 'INFO',
        override: 'NOT_ALLOWED',
        source: 'Shift types',
        sentence: 'L16 runs 20:00 – 12:00 (16 h). Regular shift.',
      },
    ],
    changed: 0,
  },
];

/**
 * The build report. The dry-run impact is counts by rule, unit and result - no
 * names, because the approver has no roster access (ADR-017).
 */
export const demoBuildReport: BuildReport = {
  steps: [
    { key: 'edited', title: 'Edited', detail: '1 rule changed in the draft.', done: true },
    { key: 'values', title: 'Values checked', detail: 'Every value is inside its allowed range.', done: true },
    { key: 'compiled', title: 'Built by the rules engine', detail: 'The draft compiled into a rule base.', done: true },
    { key: 'scenarios', title: 'Test scenarios', detail: '13 / 13 scenarios passed.', done: true },
    {
      key: 'impact',
      title: 'Impact on the published roster',
      detail: '3 result(s) change on the current roster.',
      done: false,
      // The api's shape: unit code and the result before and after.
      impact: [{ ruleCode: 'U-03', unit: 'C', from: 'PASS', to: 'BLOCK', count: 3 }],
    },
    { key: 'approver', title: 'Second approver', detail: 'A second person has to review this change.', done: false },
    { key: 'live', title: 'Go live', detail: 'The live rules switch on the effective date.', done: false },
  ],
  scenarios: { total: 13, passed: 13 },
};
