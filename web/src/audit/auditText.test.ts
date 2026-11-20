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
});
