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
    after: '12 h 00–12',
    minHours: 8,
    result: 'BLOCK',
    override: 'EMERGENCY',
    source: 'Employment Act',
    min: 8,
    sentence:
      'After a 12 h 00–12 shift, an officer needs at least 8 hours off. If they do not get it, the assignment is blocked, and a supervisor may override it in an emergency.',
  },
  {
    ruleCode: 'U-02',
    enabled: true,
    after: 'Any shift',
    minHours: 11,
    result: 'WARN',
    override: 'ACKNOWLEDGE',
    source: 'Mock agreement',
    sentence:
      'After any shift, an officer needs at least 11 hours off. If they do not get it, the supervisor is warned and has to acknowledge it.',
  },
  {
    ruleCode: 'U-03',
    enabled: true,
    after: '16 h shift',
    minHours: 12,
    result: 'BLOCK',
    override: 'EMERGENCY',
    source: 'Mock agreement',
    sentence:
      'After a 16 h shift, an officer needs at least 12 hours off. If they do not get it, the assignment is blocked.',
  },
  {
    ruleCode: 'U-04',
    enabled: false,
    after: 'Any shift',
    minHours: 0,
    result: 'INFO',
    override: 'NOT_ALLOWED',
    source: 'Mock agreement',
    sentence:
      'Exceptions to the rest rules are recorded for the audit trail. They never block an assignment.',
  },
];

export const demoRuleTables: RuleTable[] = [
  {
    code: 'rest-between-shifts',
    name: 'Rest between shifts',
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
        sentence:
          'In any 24 hours an officer may work at most 16 hours. If they would work more, the assignment is blocked.',
      },
      {
        ruleCode: 'U-06',
        enabled: true,
        after: 'Any 7 days',
        minHours: 60,
        result: 'BLOCK',
        override: 'EMERGENCY',
        source: 'Mock agreement',
        sentence:
          'In any 7 days an officer may work at most 60 hours. If they would work more, the assignment is blocked.',
      },
    ],
    changed: 0,
  },
  {
    code: 'consecutive-work',
    name: 'Consecutive work',
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
        minHours: 5,
        result: 'WARN',
        override: 'ACKNOWLEDGE',
        source: 'Mock agreement',
        sentence:
          'An officer may work at most 5 days in a row. If they would work a 6th, the supervisor is warned and has to acknowledge it.',
      },
    ],
    changed: 0,
  },
  {
    code: 'sixteen-hour-shifts',
    name: '16-hour shifts',
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
        after: 'Any 14 days',
        minHours: 3,
        result: 'BLOCK',
        override: 'EMERGENCY',
        source: 'Mock agreement',
        sentence:
          'An officer may work at most 3 16-hour shifts in any 14 days. If a 4th would fall in the window, the assignment is blocked.',
      },
    ],
    changed: 0,
  },
  {
    code: 'days-off',
    name: 'Days off',
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
        result: 'BLOCK',
        override: 'EMERGENCY',
        source: 'Mock agreement',
        sentence:
          'An officer needs at least 2 whole days off in any 7 days. If they would not get them, the assignment is blocked.',
      },
    ],
    changed: 0,
  },
  {
    code: 'pay-classification',
    name: 'Pay classification',
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
 * The build report. The dry-run impact is counts by rule, unit and date - no
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
      detail: '3 published shifts in Unit C, 24 – 28 Nov, would now break U-03.',
      done: false,
      impact: [
        { ruleCode: 'U-03', unit: 'Unit C · Living unit', from: '2026-11-24', to: '2026-11-28', count: 3 },
      ],
    },
    { key: 'approver', title: 'Second approver', detail: 'A second person has to review this change.', done: false },
    { key: 'live', title: 'Go live', detail: 'The live rules switch on the effective date.', done: false },
  ],
  scenarios: { total: 13, passed: 13 },
};
