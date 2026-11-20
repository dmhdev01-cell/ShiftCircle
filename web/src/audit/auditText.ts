import type { AuditEvent } from '../api/types';

import { ACTION_LABELS, ENTITY_LABELS } from './auditCodes';

/**
 * Plain words for an audit action code.
 *
 * A code this screen does not know yet reads as "Unknown action: <code>", so a
 * gap is visible instead of a raw snake_case string pretending to be a label.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? `Unknown action: ${action}`;
}

/** Plain words for an audit entity type, with the same readable fallback. */
export function entityLabel(entityType: string | null): string {
  if (!entityType) return '—';
  return ENTITY_LABELS[entityType] ?? `Unknown entity: ${entityType}`;
}

/** The time in Regina, the timezone the facility runs on. */
export function formatAt(occurredAt: string): string {
  const date = new Date(occurredAt);
  // en-GB gives the house order "04 Nov 2026" (en-CA gives "Nov 04, 2026").
  const day = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Regina',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Regina',
  }).format(date);
  return `${day} · ${time}`;
}

function text(value: unknown): string {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

/** A uuid in a summary is an internal id, not a fact a person can use. */
function isId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value);
}

/** "2026-11-20T08:45:47Z" -> "20 Nov 2026 · 08:45"; anything else as written. */
function shortWhen(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatAt(raw);
}

/** A key as a person reads it: "rowCount" -> "Row count". */
function keyWords(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The facts of an event as one readable line, for actions this file has no
 * sentence for. Scalars only, ids left out, lists counted: an audit row is for
 * a person, never a JSON dump (V6).
 */
function plainFacts(after: Record<string, unknown>): string {
  return Object.entries(after)
    .map(([key, value]) => {
      if (value === null || value === undefined || value === '') return '';
      if (Array.isArray(value)) {
        return `${keyWords(key)}: ${value.length} item${value.length === 1 ? '' : 's'}`;
      }
      if (typeof value === 'object') return '';
      const raw = text(value);
      if (!raw || isId(raw)) return '';
      // The api writes a list of ids as "[id, id]" in some actions.
      if (/^\[.*\]$/.test(raw)) {
        const count = raw.replace(/^\[|\]$/g, '').split(',').filter((entry) => entry.trim()).length;
        return `${keyWords(key)}: ${count} ${count === 1 ? 'entry' : 'entries'}`;
      }
      return `${keyWords(key)}: ${/^\d{4}-\d{2}-\d{2}T/.test(raw) ? shortWhen(raw) : raw}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/** One readable line for the row: what changed, from the event's `after` facts. */
export function summaryOf(event: AuditEvent): string {
  const after = (event.after ?? null) as Record<string, unknown> | null;
  if (!after) return '—';
  switch (event.action) {
    case 'override_rule':
      return `Reason: ${text(after.reason)} · rules ${text(after.rules)}`;
    case 'assign_shift':
      return [
        text(after.template),
        after.unit ? `unit ${text(after.unit)}` : '',
        text(after.outcome),
        after.overrideId ? 'with an override' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'record_actual':
      return [text(after.assignmentId), shortWhen(after.startAt), shortWhen(after.endAt)]
        .filter(Boolean)
        .join(' · ');
    case 'move_assignment':
      return [
        text(after.shiftTemplate),
        after.unit ? 'unit ' + text(after.unit) : '',
        shortWhen(after.startAt),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'cancel_assignment':
      return ['Status: ' + text(after.status), after.reason ? 'Reason: ' + text(after.reason) : '']
        .filter(Boolean)
        .join(' · ');
    case 'publish_schedule_period':
      return `Status: ${text(after.status)}`;
    case 'lock_pay_period':
      // The api's `totals` is a Java toString ("Totals[officers=100, …]");
      // the lock itself is the fact, and the figures are on the report.
      return 'Locked';
    case 'unlock_pay_period':
      return `Reason: ${text(after.reason)}`;
    case 'payroll_export':
      return `${text(after.rowCount)} rows · SHA-256 ${text(after.fileSha256).slice(0, 12)}`;
    case 'offer_overtime': {
      // employeeIds is a list the api writes as "[id, id]": count it, because a
      // uuid is not a colleague's name and the row has no names to use (V6).
      const raw = text(after.employeeIds);
      const count = raw.replace(/^\[|\]$/g, '').split(',').filter((entry) => entry.trim()).length;
      const ordered = after.ordered === true ? ' · in order' : '';
      return `Offered to ${count} officer${count === 1 ? '' : 's'}${ordered}`;
    }
    case 'accept_overtime_offer':
      return 'The officer accepted';
    case 'decline_overtime_offer':
      return 'The officer declined';
    case 'confirm_overtime_offer':
      return 'Confirmed · the shift is assigned';
    case 'assign_open_shift':
      return 'Assigned from the overtime board';
    case 'create_open_shift':
      return plainFacts(after);
    case 'rule_set_draft':
    case 'rule_set_build':
    case 'rule_set_submit':
    case 'rule_set_approve':
    case 'rule_set_publish':
      return [after.version ? `v${text(after.version)}` : '', text(after.reason)]
        .filter(Boolean)
        .join(' · ');
    default:
      return plainFacts(after) || '—';
  }
}
