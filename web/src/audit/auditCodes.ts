/**
 * The audit codes the api writes, and their plain-language labels.
 *
 * One source for both, so the screen cannot show a raw code for an action the
 * api already writes. The lists are kept in step with the api by
 * `scripts/check-audit-codes.sh`, which greps the api sources for the codes it
 * writes and fails when one of them is missing here.
 *
 * The api's codes come from the `audit(...)` calls and the audit_event inserts
 * in api/shiftcircle-api/src/main/java (docs/07 §4.8).
 */

/** Every action code the api writes to audit_event.action. */
export const API_AUDIT_ACTIONS = [
  'assign_shift',
  'move_assignment',
  'cancel_assignment',
  'override_rule',
  'record_actual',
  'record_absence',
  'lock_pay_period',
  'unlock_pay_period',
  'payroll_export',
  'create_open_shift',
  'offer_overtime',
  'accept_overtime_offer',
  'decline_overtime_offer',
  'confirm_overtime_offer',
  'assign_open_shift',
  'rule_set_draft',
  'rule_rows_saved',
  'rule_set_build',
  'rule_set_submit',
  'rule_set_approve',
  'rule_set_reject',
  'rule_set_publish',
  'publish_schedule_period',
  'generate_demo_dataset',
  'clear_actual',
  'generate_plan',
  'commit_plan',
  'discard_plan',
  'demo_reset',
] as const;

/** Every entity type the api writes to audit_event.entity_type. */
export const API_AUDIT_ENTITIES = [
  'shift_assignment',
  'time_entry',
  'pay_period',
  'open_shift',
  'overtime_offer',
  'rule_set_version',
  'schedule_period',
  'demo',
  'plan_draft',
] as const;

/** Plain words for each action code. */
export const ACTION_LABELS: Record<string, string> = {
  assign_shift: 'Shift assigned',
  move_assignment: 'Shift moved',
  cancel_assignment: 'Shift cancelled',
  override_rule: 'Rule override',
  record_actual: 'Actual recorded',
  record_absence: 'Absence recorded',
  lock_pay_period: 'Pay period locked',
  demo_reset: 'Demo data reset',
  unlock_pay_period: 'Pay period unlocked',
  payroll_export: 'Payroll export',
  create_open_shift: 'Open shift created',
  clear_actual: 'Actual or absence cleared',
  generate_plan: 'Quarter plan generated',
  commit_plan: 'Quarter plan committed',
  discard_plan: 'Draft quarter plan discarded',
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
  rule_set_reject: 'Rule set rejected',
  rule_set_publish: 'Rule set published',
  publish_schedule_period: 'Period published',
  generate_demo_dataset: 'Demo data generated',
};

/** Plain words for each entity type. */
export const ENTITY_LABELS: Record<string, string> = {
  shift_assignment: 'Shift',
  time_entry: 'Time entry',
  pay_period: 'Pay period',
  open_shift: 'Open shift',
  overtime_offer: 'Overtime offer',
  rule_set_version: 'Rule version',
  schedule_period: 'Schedule period',
  demo: 'Demo',
  plan_draft: 'Quarter plan draft',
};

/** One filter choice per entity type, so the filter cannot fall out of step. */
export const ENTITY_FILTER_CHOICES = API_AUDIT_ENTITIES.map((entityType) => ({
  value: entityType,
  label: ENTITY_LABELS[entityType],
}));

/** Every action the screen can filter by, in plain words, for the picker. */
export const ACTION_CHOICES: { value: string; label: string }[] = Object.entries(ACTION_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((left, right) => left.label.localeCompare(right.label));
