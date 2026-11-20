/**
 * Demo audit events for the read-only Audit log (docs/07 §4.8).
 *
 * The real api returns the newest first and pages on the descending id; the
 * fixture does the same, with enough events for "Load more" to be exercised.
 */

import type { AuditEvent } from '../types';

function event(
  id: number,
  occurredAt: string,
  username: string,
  displayName: string,
  action: string,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
): AuditEvent {
  return {
    id,
    occurredAt,
    actor: { username, displayName },
    action,
    entityType,
    entityId,
    before: null,
    after,
  };
}

export const demoAuditEvents: AuditEvent[] = [
  event(
    30,
    '2026-11-04T19:05:00Z',
    'm.ellis',
    'M. Ellis',
    'override_rule',
    'shift_assignment',
    'a-pc03-16',
    { reason: 'Lockdown, relief unavailable', rules: '[U-05]' },
  ),
  event(
    29,
    '2026-11-04T19:05:00Z',
    'm.ellis',
    'M. Ellis',
    'assign_shift',
    'shift_assignment',
    'a-pc03-16',
    { employeeId: 'emp-piotr', unit: 'C', template: 'L16', outcome: 'BLOCK', overrideId: 'ov-pc03' },
  ),
  event(
    28,
    '2026-11-09T14:12:00Z',
    'm.ellis',
    'M. Ellis',
    'lock_pay_period',
    'pay_period',
    'period-2026-10-26',
    { status: 'LOCKED', totals: '10 officers · 764.0 worked h · 24.0 overtime h' },
  ),
  event(
    27,
    '2026-11-20T19:50:00Z',
    'p.singh',
    'P. Singh',
    'rule_set_publish',
    'rule_set_version',
    'v8',
    { version: 8, effectiveDate: '2026-11-20' },
  ),
  event(
    26,
    '2026-11-19T15:10:00Z',
    'j.chen',
    'J. Chen',
    'record_actual',
    'time_entry',
    'te-1',
    { assignmentId: 'a-1', startAt: '2026-11-19T07:00:00-06:00', endAt: '2026-11-19T15:00:00-06:00' },
  ),
  ...Array.from({ length: 25 }, (_, index) => {
    const id = 25 - index;
    const ellis = index % 2 === 0;
    return event(
      id,
      `2026-11-${String(10 + (index % 9)).padStart(2, '0')}T${String(8 + (index % 10)).padStart(2, '0')}:15:00Z`,
      ellis ? 'm.ellis' : 'j.chen',
      ellis ? 'M. Ellis' : 'J. Chen',
      'record_actual',
      'time_entry',
      `te-${id}`,
      { assignmentId: `a-${id}`, startAt: '2026-11-10T07:00:00-06:00', endAt: '2026-11-10T15:00:00-06:00' },
    );
  }),
];
