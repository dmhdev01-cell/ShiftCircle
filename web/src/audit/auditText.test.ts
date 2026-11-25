import { describe, expect, it } from 'vitest';

import type { AuditEvent } from '../api/types';
import { summaryOf } from './auditText';

function event(action: string, after: Record<string, unknown> | null): AuditEvent {
  return {
    id: 1,
    occurredAt: '2026-11-20T08:45:47Z',
    actor: { displayName: 'M. Ellis', username: 'm.ellis' },
    action,
    entityType: 'open_shift',
    entityId: 'b729d3c7-7d8b-3db9-93e3-547cd68c5911',
    after,
    before: null,
  };
}

const UUID = '4002f546-6ef0-4a44-9a5f-0f2f51d2c1aa';

/**
 * V6: the audit log printed the api's own shapes - `{"status":"DECLINED"}`,
 * `Offered to [uuid]`, `Locked · Totals[officers=100, …]` - which is data, not
 * words for a person.
 */
describe('the audit summary', () => {
  it('counts the officers an offer went to instead of listing their ids', () => {
    expect(summaryOf(event('offer_overtime', { employeeIds: `[${UUID}, ${UUID}]`, ordered: true }))).toBe(
      'Offered to 2 officers · in order',
    );
    expect(summaryOf(event('offer_overtime', { employeeIds: `[${UUID}]` }))).toBe('Offered to 1 officer');
  });

  it('says what the officer did, not the enum', () => {
    expect(summaryOf(event('decline_overtime_offer', { status: 'DECLINED' }))).toBe(
      'The officer declined',
    );
    expect(summaryOf(event('accept_overtime_offer', { status: 'ACCEPTED' }))).toBe(
      'The officer accepted',
    );
  });

  it('does not print the java toString of the lock totals', () => {
    expect(summaryOf(event('lock_pay_period', { totals: 'Totals[officers=100, workedHours=2304]' }))).toBe(
      'Locked',
    );
  });

  it('writes an unknown action as its facts, never as json', () => {
    const line = summaryOf(event('something_new', { status: 'DECLINED', assignmentId: UUID, unit: 'B' }));

    expect(line).toBe('Status: DECLINED · Unit: B');
    expect(line).not.toContain('{');
    expect(line).not.toContain(UUID);
  });

  it('falls back to a dash when there is nothing a person can read', () => {
    expect(summaryOf(event('something_new', { assignmentId: UUID }))).toBe('—');
    expect(summaryOf(event('something_new', null))).toBe('—');
  });

  it('writes every action code the api has as words, never as json', async () => {
    // The list is the one scripts/check-audit-codes.sh keeps in step with the
    // api. A code with no sentence of its own must still read as its facts.
    const { ACTION_LABELS } = await import('./auditCodes');
    for (const code of Object.keys(ACTION_LABELS)) {
      const line = summaryOf(
        event(code, { status: 'DECLINED', unit: 'B', reason: 'EXTRA_COVERAGE', version: 8 }),
      );
      expect(line, code).not.toContain('{');
      expect(line, code).not.toContain(UUID);
      expect(line.length, code).toBeGreaterThan(0);
    }
  });

  it('counts a generated plan in words instead of raw keys', () => {
    expect(
      summaryOf(
        event('generate_plan', {
          assignments: 6586,
          gaps: 38,
          warnings: 7,
          seed: 20261001,
          pattern8h: 'ROTATING_5_2',
          generatedMs: 588,
        }),
      ),
    ).toBe('6,586 shifts placed · 38 block-days short · 7 warnings · seed 20261001 · rotating 5 on, 2 off · took 0.6 s');
  });

  it('says what a commit wrote, and counts the units', () => {
    expect(
      summaryOf(
        event('commit_plan', {
          assignments: 6586,
          officers: 100,
          warnings: 7,
          units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC'],
        }),
      ),
    ).toBe('6,586 shifts written · 100 officers · 7 warnings accepted · across 6 units');
  });

  it('names the supervisors a committed plan wrote, and only when it has any', () => {
    expect(
      summaryOf(
        event('commit_plan', {
          assignments: 6273,
          officers: 107,
          supervisors: 10,
          warnings: 7,
          units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC', 'SUP-L', 'SUP-O'],
        }),
      ),
    ).toBe('6,273 shifts written · 107 officers · 10 supervisors · 7 warnings accepted · across 8 units');
    expect(
      summaryOf(
        event('commit_plan', {
          assignments: 5103,
          officers: 107,
          supervisors: 0,
          warnings: 7,
          units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC'],
        }),
      ),
    ).toBe('5,103 shifts written · 107 officers · 7 warnings accepted · across 6 units');
  });

  it('reads planned leave as a date and a word', () => {
    expect(
      summaryOf(event('record_absence', { type: 'VACATION', date: '2027-01-05', employeeId: UUID })),
    ).toBe('Vacation recorded · 5 Jan 2027');
  });

  it('names the dataset a reset generated', () => {
    expect(summaryOf(event('demo_reset', { dataset: '120', seed: '20261001' }))).toBe(
      'Dataset 120 · seed 20261001',
    );
  });

  it('reads a pattern change in words, not raw codes', () => {
    expect(
      summaryOf(event('set_officer_pattern', { from: 'ROTATING_5_2', to: '7_ON_3_OFF' })),
    ).toBe('From rotating 5 on, 2 off to 7 on, 3 off.');
  });
});
