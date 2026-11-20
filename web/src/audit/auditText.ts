import type { AuditEvent } from '../api/types';

/** Plain words for the audit action codes (the api writes snake_case codes). */
const ACTIONS: Record<string, string> = {
  assign_shift: 'Shift assigned',
  override_rule: 'Rule override',
  record_actual: 'Actual recorded',
  record_absence: 'Absence recorded',
  lock_pay_period: 'Pay period locked',
  unlock_pay_period: 'Pay period unlocked',
  payroll_export: 'Payroll export',
  create_open_shift: 'Open shift created',
  offer_overtime: 'Overtime offered',
  accept_overtime_offer: 'Overtime accepted',
  decline_overtime_offer: 'Overtime declined',
  confirm_overtime_offer: 'Overtime confirmed',
  assign_open_shift: 'Open shift assigned',
  rule_set_draft: 'Rule draft created',
  rule_rows_saved: 'Rule rows saved',
  rule_set_build: 'Rule set built',
  rule_set_submit: 'Rule set submitted',
  rule_set_approve: 'Rule set approved',
  rule_set_publish: 'Rule set published',
  generate_demo_dataset: 'Demo data generated',
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

const ENTITIES: Record<string, string> = {
  shift_assignment: 'Shift',
  time_entry: 'Time entry',
  pay_period: 'Pay period',
  open_shift: 'Open shift',
  overtime_offer: 'Overtime offer',
  rule_set_version: 'Rule version',
  demo: 'Demo',
};

export function entityLabel(entityType: string | null): string {
  if (!entityType) return '—';
  return ENTITIES[entityType] ?? entityType;
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

function shortWhen(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatAt(raw);
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
    case 'lock_pay_period':
      return `Locked${after.totals ? ` · ${text(after.totals)}` : ''}`;
    case 'unlock_pay_period':
      return `Reason: ${text(after.reason)}`;
    case 'payroll_export':
      return `${text(after.rowCount)} rows · SHA-256 ${text(after.fileSha256).slice(0, 12)}`;
    case 'offer_overtime':
      return `Offered to ${text(after.employeeIds)}`;
    case 'rule_set_draft':
    case 'rule_set_build':
    case 'rule_set_submit':
    case 'rule_set_approve':
    case 'rule_set_publish':
      return [after.version ? `v${text(after.version)}` : '', text(after.reason)]
        .filter(Boolean)
        .join(' · ');
    default: {
      const json = JSON.stringify(after);
      return json.length > 140 ? `${json.slice(0, 137)}…` : json;
    }
  }
}
