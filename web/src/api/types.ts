/**
 * The ShiftCircle API contract the web builds against.
 *
 * Source: docs/07-api-spec.md (REST /api/v1, Problem Details, rule results
 * as 422) and docs/ui/build-notes.md §1.3 with ADR-017 (hourly coverage).
 *
 * Fields the api does not send today are marked "not in the contract yet" and
 * are optional, so the screens can show them when the api grows them without
 * pretending the api already answers with them.
 */

// --- Rule checks (docs/07-api-spec.md §3) ---

export type RuleOutcome = 'BLOCK' | 'WARN' | 'PASS' | 'INFO';

export interface RuleEvidence {
  assignmentId?: string;
  label?: string;
}

export interface RuleResult {
  ruleCode: string;
  outcome: RuleOutcome;
  message: string;
  facts?: Record<string, unknown>;
  evidence?: RuleEvidence[];
  source?: string;
}

/** The rule outcome of a preview or a save. */
export interface RuleCheckOutcome {
  outcome: RuleOutcome;
  ruleSetVersion: number;
  /** True when the failing rules allow an emergency override. */
  overridable: boolean;
  ruleResults: RuleResult[];
  /** How many other rules passed. Not in the contract yet. */
  passedRules?: number;
  /** When the rule set was published. Not in the contract yet. */
  publishedAt?: string;
}

/** RFC 9457 Problem Details, with the rule extension. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  outcome?: RuleOutcome;
  ruleSetVersion?: number;
  overridable?: boolean;
  ruleResults?: RuleResult[];
  errors?: { field: string; message: string }[];
}

export const BLOCKED_BY_RULES = 'https://shiftcircle.local/problems/blocked-by-rules';
export const WARNINGS_NEED_ACKNOWLEDGEMENT =
  'https://shiftcircle.local/problems/warnings-need-acknowledgement';

export type RuleCheckChange =
  | {
      type: 'ASSIGN';
      employeeId: string;
      unitId: string;
      shiftTemplate: string;
      startAt: string;
    }
  | { type: 'MOVE'; assignmentId: string; startAt: string }
  | { type: 'CANCEL'; assignmentId: string };

export interface RuleCheckRequest {
  change: RuleCheckChange;
  /** Rule codes the supervisor acknowledges, for Warn results. */
  acknowledgeWarnings?: string[];
  /** Emergency override, with the written reason. Supervisor only. */
  override?: { reason: string };
}

// --- Schedule (docs/07-api-spec.md §4.2, ADR-017) ---

export type Block = 'DAY' | 'EVENING' | 'NIGHT';

/** A merged range of hours below the requirement. `to` is exclusive. */
export interface ShortHourRange {
  from: string;
  to: string;
  count: number;
}

/** Hourly coverage of one block on one day. */
export interface HourlyCoverage {
  /** The lowest headcount over the block's hours. */
  lowestHourly: number;
  /** Merged hour ranges below the requirement. */
  shortHours: ShortHourRange[];
  /** The highest headcount over the block's hours. */
  maxHourly?: number;
}

export interface BlockCoverage {
  block: Block;
  date: string;
  required: number;
  scheduled: HourlyCoverage;
  /** Present for past hours only. */
  actual?: HourlyCoverage;
  /** True when no hour in the block falls short. */
  covered: boolean;
}

export type OvertimeStatus = 'UNDER' | 'APPROACHING' | 'IN_OVERTIME';

/**
 * A shift on the roster. `shiftTemplate` is a template code (D8, E8, N8, A12,
 * P12, L16) - the chip text comes from it (docs/ui/build-notes.md §1.1).
 */
export interface ShiftItem {
  type: 'SHIFT';
  assignmentId: string;
  shiftTemplate: string;
  startAt: string;
  endAt: string;
  /** EXTRA means picked up beyond the roster. */
  kind: 'ROSTERED' | 'EXTRA';
  /** An actual was recorded for this shift. */
  worked: boolean;
  /** Offered as overtime, not yet accepted. */
  offer?: boolean;
  /** Proposed but blocked by a rule. */
  proposed?: boolean;
}

export interface AbsenceItem {
  type: 'ABSENCE';
  absenceType: 'SICK' | 'VACATION';
}

export type CellItem = ShiftItem | AbsenceItem;

export interface DayCell {
  date: string;
  items: CellItem[];
}

export interface OfficerRow {
  employeeId: string;
  name: string;
  rotation: string;
  qualifications: string[];
  /** Hours worked in the pay period. */
  payPeriodHours: number;
  /** The period's overtime threshold, 80 h by default. */
  payPeriodThreshold: number;
  overtimeStatus: OvertimeStatus;
  cells: DayCell[];
}

export interface SchedulePayload {
  unit: { id: string; name: string };
  from: string;
  to: string;
  /** ISO dates of the days on the board. */
  days: string[];
  /** The demo "today". Not in the contract yet; the browser date is used otherwise. */
  today?: string;
  coverage: BlockCoverage[];
  officers: OfficerRow[];
  /** Rule warnings on the published week. */
  warnings: number;
  /** Emergency overrides this period. Not in the contract yet. */
  overridesThisPeriod?: number;
  period?: {
    id: string;
    label: string;
    published: boolean;
    unpublishedChanges: number;
  };
}

export interface ScheduleQuery {
  unitId?: string;
  from?: string;
  to?: string;
}

// --- The client the screens use ---

/** A change to save. The api runs the rules before it accepts the change. */
export interface SaveRequest {
  change: RuleCheckChange;
  /** Rule codes the supervisor acknowledges, for Warn results. */
  acknowledgeWarnings?: string[];
  /** Emergency override, with the written reason. Supervisor only. */
  override?: { reason: string };
}

export interface SaveOutcome {
  /** The assignment that was created, moved or cancelled. */
  assignmentId?: string;
  /** The rule outcome of the save. */
  ruleOutcome: RuleCheckOutcome;
}

/**
 * Everything the screens are allowed to ask the api for. The fixtures and the
 * HTTP implementation both satisfy it, so the screens do not know which one
 * they are talking to.
 */
export interface ShiftCircleApi {
  getSchedule(query: ScheduleQuery): Promise<SchedulePayload>;
  previewRuleCheck(request: RuleCheckRequest): Promise<RuleCheckOutcome>;
  saveChange(request: SaveRequest): Promise<SaveOutcome>;
}
