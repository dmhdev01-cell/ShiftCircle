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

/** What a supervisor may do about a rule result (docs/05 §2 severities). */
export type OverridePolicy = 'EMERGENCY' | 'ACKNOWLEDGE' | 'NONE';

/** The evidence the api sends: a human-readable label naming the shifts involved. */
export interface RuleEvidence {
  label?: string;
}

export interface RuleResult {
  ruleCode: string;
  /** The decision table the row belongs to, e.g. REST (docs/04 §5). */
  ruleTable: string;
  outcome: RuleOutcome;
  message: string;
  facts?: Record<string, unknown>;
  evidence?: RuleEvidence[];
  /** EMERGENCY rules alone can be overridden; ACKNOWLEDGE rules are warned about. */
  overridePolicy: OverridePolicy;
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
  /** The shifts with no actual, when the api refuses to lock (ADR-017). */
  missing?: MissingActual[];
  /** A refused proposal decision: each accepted shift's fresh result (v1.3 P4). */
  items?: ProposalRefusalItem[];
}

export const BLOCKED_BY_RULES = 'https://shiftcircle.local/problems/blocked-by-rules';
export const MISSING_ACTUALS = 'https://shiftcircle.local/problems/missing-actuals';
export const WARNINGS_NEED_ACKNOWLEDGEMENT =
  'https://shiftcircle.local/problems/warnings-need-acknowledgement';

export type RuleCheckChange = {
  /**
   * ASSIGN is a rostered shift; EXTRA is one picked up beyond the roster
   * (docs/07 §3). PATCH /assignments/{id} uses the same change shape.
   */
  type: 'ASSIGN' | 'EXTRA';
  employeeId: string;
  unitId: string;
  shiftTemplate: string;
  startAt: string;
};

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
  /** Edited by hand in the draft (release 7). */
  edited?: boolean;
  /** The row version for If-Match; the api sends it with every SHIFT item. */
  version: number;
  /**
   * Live board only (PR-O): any time entry, actual or absence, is recorded
   * against the shift. The api refuses to cancel it then.
   */
  actualRecorded?: boolean;
  /** Live board only: an absence is recorded against the shift (cancel refused). */
  absenceRecorded?: boolean;
  /** Live board only: the shift fills an open shift (move refused). */
  fillsOpenShift?: boolean;
  /** Live board only (v1.3 P4): an approved shift proposal created the shift. */
  fromProposal?: boolean;
  /**
   * Live board only: the shift's work date is in a locked pay period. The api
   * refuses a move or cancel then, before any other state check.
   */
  payPeriodLocked?: boolean;
}

export interface AbsenceItem {
  type: 'ABSENCE';
  absenceType: 'SICK' | 'VACATION' | 'OTHER';
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
  /** Draft roster only: the home unit of an officer placed in this unit from another. */
  homeUnit?: string;
  /**
   * Planning board only (v1.3 S6): the position, CO (officer) or CS
   * (supervisor). Left out of the planner's draft.
   */
  position?: string;
  /**
   * Planning board only (v1.3 S6): the position is supervisory (the
   * position table's flag), so a later supervisory position needs no web change.
   */
  supervisory?: boolean;
}

/**
 * v1.3 S6: who supervises a line unit in one block of one day, from the
 * supervisor posts that cover it. Empty names: nobody on the post then.
 */
export interface SupervisorOnDuty {
  date: string;
  block: Block;
  names: string[];
}

export interface SchedulePayload {
  unit: {
    id: string;
    name: string;
    closedFrom?: string | null;
    closedTo?: string | null;
    closedLabel?: string | null;
    closedDates?: string[];
    closedReason?: string | null;
    /**
     * Planning board only (v1.3 S6): the unit's kind. SUPERVISION is a
     * supervisor post (SUP-L, SUP-O); the planner's draft leaves it out.
     */
    kind?: string;
  };
  from: string;
  to: string;
  /** ISO dates of the days on the board. */
  days: string[];
  /** The server's "today" (`SC_DEMO_TODAY` on the demo profile). */
  asOf: string;
  /**
   * The business clock's instant (PR-O): noon on the demo day on the demo
   * profile. A shift that starts at or before it has started, and the api
   * refuses to move or cancel it. Not sent with the planner's draft.
   */
  now?: string;
  coverage: BlockCoverage[];
  officers: OfficerRow[];
  /** Rule warnings on the published week. */
  warnings: number;
  /** Emergency overrides recorded in the pay period on the board. */
  overridesThisPeriod: number;
  /**
   * Whether the period is published, and how many of its shifts changed after
   * the publication. The count is null when the period is not published:
   * there is nothing to compare against yet.
   */
  publishedState: {
    published: boolean;
    unpublishedChanges: number | null;
  };
  /**
   * The roster week the board shows, with the id the publish endpoint takes
   * (POST /schedule-periods/{id}/publish). Null when the board's range is not
   * inside a period.
   */
  period?: {
    id: string;
    label: string;
    status: 'DRAFT' | 'PUBLISHED';
  } | null;
  /**
   * v1.3 S6: on a line unit covered by a supervisor post, one entry per day
   * and block. Left out on a supervisor post itself and in the planner's draft.
   */
  supervisorsOnDuty?: SupervisorOnDuty[];
}

export interface ScheduleQuery {
  unitId?: string;
  from?: string;
  to?: string;
}

/**
 * The api's answer to POST /schedule-periods/{id}/publish (docs/07 §4.2).
 * Publishing is one-way: a second publish answers 409.
 */
export interface PublishedPeriod {
  id: string;
  status: string;
  /** When the period was published. */
  publishedAt: string;
}

// --- Overtime (docs/07-api-spec.md §4.3) ---

export type OpenShiftStatus = 'OPEN' | 'OFFERS_SENT' | 'FILLED' | 'CANCELLED';

export interface OpenShift {
  id: string;
  date: string;
  startAt: string;
  endAt: string;
  unit: { id: string; name: string };
  shiftTemplate: string;
  /** How many officers the shift still needs. */
  needs: number;
  status: OpenShiftStatus;
  /** Why the shift is open, e.g. "Proposed officer blocked (rest)". */
  reason?: string;
}

/** How a candidate stands for this shift. */
export type Eligibility = 'ELIGIBLE' | 'WARN' | 'SKIPPED' | 'UNAVAILABLE';

export interface Candidate {
  employeeId: string;
  name: string;
  qualifications: string[];
  /** Overtime hours this quarter - the ranking basis (ADR-016). */
  overtimeHoursThisQuarter: number;
  /** Seniority date, e.g. "Mar 2014". */
  seniorityDate: string;
  eligibility: Eligibility;
  /**
   * Why the candidate is eligible, warned, skipped or unavailable. The api
   * sends it; the screen does not make one up.
   */
  reason?: string;
  ruleResults?: RuleResult[];
}

export type OfferStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'CONFIRMED';

export interface OfferRecord {
  /** The api's offer id, used to confirm it. */
  id: string;
  at: string;
  employeeId: string;
  employeeName: string;
  status: OfferStatus;
}

export interface OpenShiftCandidates {
  openShift: OpenShift;
  /** In the api's ranking order. Officers who are skipped keep their place. */
  candidates: Candidate[];
  /** The rule table version the ranking used. */
  ruleSetVersion: number;
  /** How the api ranked them, in plain words. */
  rankingNote?: string;
  /** The offers already recorded for this shift. */
  history: OfferRecord[];
}

// --- My schedule (docs/07-api-spec.md §4.2, §4.3) ---

export interface MyNextShift {
  date: string;
  startAt: string;
  endAt: string;
  shiftTemplate: string;
  unit: { id: string; name: string };
}

export interface MySchedulePayload {
  /** The server's "today". Not in the contract yet. */
  asOf?: string;
  employee: {
    id: string;
    name: string;
    /** The position code (CO, CS); the fixtures carry words. */
    role: string;
    /** The position in words, "Correctional supervisor" (release v1.3 S1). */
    position?: string;
    unit: { id: string; name: string };
    /**
     * A supervisor's post and the units it covers, "Supervision · Living units (A, B, C)";
     * null for anyone homed on a line unit (release v1.3 S7).
     */
    post?: string | null;
    rotation: string;
    qualifications: string[];
  };
  nextShift?: MyNextShift;
  /** Hours in the pay period, and what is still scheduled. */
  payPeriod: {
    label: string;
    workedHours: number;
    scheduledHours: number;
    totalHours: number;
    thresholdHours: number;
  };
  overtimeThisQuarter: {
    hours: number;
    /** The officer's place on the overtime list. */
    rank: number;
    of: number;
  };
  /** The officer's own shifts in the range. */
  days: string[];
  shifts: DayCell[];
}

/** An overtime offer to the signed-in officer. */
export interface MyOffer {
  id: string;
  openShift: OpenShift;
  /** Who offered it and when. */
  offeredBy: string;
  offeredAt: string;
  /** The api's rule result for this officer and this shift. */
  eligibility: Eligibility;
  reason?: string;
  /** The rule results, when the api sent them. */
  ruleResults?: RuleResult[];
  status: OfferStatus;
}

export type OfferResponse = 'ACCEPT' | 'DECLINE';

// --- Time and attendance (docs/07-api-spec.md §4.5, ADR-017) ---

/** The api's absence codes (FR-51): sick, vacation, other. */
export type AbsenceType = 'SICK' | 'VACATION' | 'OTHER';

/**
 * POST /planner/absences (ADR-026): one officer, one date, type only. No reason
 * or free text is stored (FOIP data minimisation, absence table). The same
 * officer/date/type again answers the existing row; a different type is a 409.
 */
export interface PlannedAbsenceInput {
  employeeId: string;
  date: string;
  type: AbsenceType;
}

export interface PlannedAbsence extends PlannedAbsenceInput {
  id: string;
}

export interface PayCode {
  code: string;
  hours: number;
  multiplier: number;
}

export interface PayPeriod {
  id: string;
  label: string;
  from: string;
  to: string;
  status: 'OPEN' | 'LOCKED';
  /** Who locked it, and when. */
  lockedBy?: string;
  lockedAt?: string;
  /** The last payroll export, with the file hash. */
  lastExport?: { at: string; fileHash: string };
  /** The totals the lock confirmation repeats. */
  totals?: { officers: number; workedHours: number; overtimeHours: number };
  /** The period's overtime threshold in hours (ADR-016). */
  overtimeThresholdHours: number;
}

/** One scheduled shift and what was actually recorded for it. */
export interface TimeEntry {
  assignmentId: string;
  employeeId: string;
  /** The officer's name, so the grid needs no second call. */
  employeeName: string;
  /** The unit the shift is in, so the grid can be filtered by unit. */
  unitId: string;
  unitName: string;
  date: string;
  shiftTemplate: string;
  startAt: string;
  endAt: string;
  /** The actual times, when they were recorded. */
  actualStart?: string;
  actualEnd?: string;
  /** Worked as scheduled. */
  worked: boolean;
  /** The absence type, when the officer was absent. */
  absence?: AbsenceType;
  /** An extension under 30 minutes that is not paid (P-04). */
  unpaidExtensionMinutes?: number;
  /** The pay codes the api calculated for the entry. */
  payCodes?: PayCode[];
  /** The shift has ended and nothing was recorded. */
  needsActual?: boolean;
}

export interface RecordActualInput {
  /** Worked as scheduled. */
  workedAsScheduled: boolean;
  /** The adjusted times, when the officer's times were changed. */
  actualStart?: string;
  actualEnd?: string;
  /** The absence type, when the officer was absent. */
  absence?: AbsenceType;
}

export interface RecordActualResult {
  entry: TimeEntry;
  /** The officer's pay codes for the period, after the change. */
  payCodes: PayCode[];
  periodHours: number;
}

/** The shifts the api says are missing an actual (ADR-017). */
export interface MissingActual {
  assignmentId: string;
  employeeId: string;
  start: string;
}

// --- Reports (docs/07-api-spec.md §4.6) ---

export interface ReportQuery {
  from?: string;
  to?: string;
  unitId?: string;
  employeeId?: string;
  /** A position code (CO, CS): the hours and overtime reports for one rank (release v1.3 S7). */
  position?: string;
}

/** One week of the coverage report. */
export interface CoverageWeek {
  label: string;
  /** The share of required staff-hours that were scheduled, as a percentage. */
  scheduledPercent: number;
  /** The share that were actually worked. Absent for a planned week. */
  /**
   * The share that was actually worked. The api sends null for a planned
   * week, so the screen has to treat null and absent the same way.
   */
  actualPercent?: number | null;
  /** True for a week that has not happened yet. */
  planned: boolean;
  /** The hours the week needed, the basis of every percentage. */
  requiredHours?: number;
  /** Scheduled-percent points that came only from extra shifts (2 dp). */
  extraPercent?: number;
  /** Hours of the scheduled hours that came from overtime/extra shifts. */
  extraHours?: number;
  /** The same, per block (DAY, EVENING, NIGHT). */
  extraHoursByBlock?: Record<string, number>;
}

export interface CoverageClosureNote {
  unitId: string;
  unitName: string;
  closedFrom: string;
  closedTo: string | null;
  reason: string;
}

export interface CoverageReport {
  weeks: CoverageWeek[];
  /** The axis starts here, and the screen says so. */
  axisFrom: number;
  axisTo: number;
  /** Closures that touch the reported range (release 3). */
  closureNotes?: CoverageClosureNote[];
  requiredHours: number;
  scheduledHours: number;
  actualHours?: number;
}

export interface OvertimeByOfficer {
  employeeId: string;
  name: string;
  hours: number;
  /** The person's position code, CO or CS (release v1.3 S7). */
  position?: string;
}

export interface OvertimeReport {
  rows: OvertimeByOfficer[];
  /** The facility average per officer. */
  averageHours: number;
}

export interface HoursByOfficer {
  employeeId: string;
  name: string;
  scheduled: number;
  worked: number;
  regular: number;
  overtime15: number;
  /** The 2x band is off by default, so the column is hidden when it is empty. */
  overtime20: number;
  sick: number;
  vacation: number;
  /** The person's position code, CO or CS (release v1.3 S7). */
  position?: string;
}

export interface HoursReport {
  period: {
    id: string;
    label: string;
    status: 'OPEN' | 'LOCKED';
    lockedBy?: string;
    lockedAt?: string;
  };
  rows: HoursByOfficer[];
  /** How many officers the report covers. */
  totalOfficers: number;
}

export interface OverrideRow {
  id: string;
  at: string;
  employeeName: string;
  unitName: string;
  reason: string;
  ruleCode?: string;
}

// --- Rules administration (docs/07-api-spec.md §4.7) ---

export type RuleSetStatus =
  | 'LIVE'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED';

export interface RuleSetVersion {
  version: number;
  status: RuleSetStatus;
  /** True for the version the rules engine is running. */
  live: boolean;
  createdBy?: string;
  createdAt?: string;
  reason?: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedAt?: string;
}

export type RuleResultChoice = 'BLOCK' | 'WARN' | 'INFO';
export type OverrideChoice = 'EMERGENCY' | 'NOT_ALLOWED' | 'ACKNOWLEDGE';

/** One row of a decision table: one rule. */
export interface RuleTableRow {
  ruleCode: string;
  enabled: boolean;
  /** The shift kind the rule applies after. */
  after: string;
  /** The hours the rule needs. */
  minHours: number;
  result: RuleResultChoice;
  override: OverrideChoice;
  source: string;
  /** The floor the value cannot go below, e.g. the legal minimum. */
  min?: number;
  /** The plain-language sentence for the row. */
  sentence: string;
  /** The table's own columns, as the api stores them. */
  params?: Record<string, unknown>;
  /**
   * A rule the mock agreement requires: its result, override and on/off are
   * locked (the api's build refuses a change to them).
   */
  must?: boolean;
}

export interface RuleTable {
  code: string;
  name: string;
  /** The params key the single "hours" field edits, e.g. minRestHours. */
  hoursParam?: string;
  /** The params key the "after this shift" select edits, when the table has one. */
  afterParam?: string;
  /** The plain-language column headings. */
  columns: { after: string; hours: string; result: string; override: string };
  rows: RuleTableRow[];
  /** How many rows changed in the draft. */
  changed: number;
}

/** One step of the publish checklist. */
export interface BuildStep {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  /** The impact on the published roster, as counts without names (ADR-017). */
  /**
   * One row per rule, unit and change of result: `count` officers whose
   * result goes `from` -> `to` (PASS, INFO, WARN, BLOCK); `unit` is the code.
   */
  impact?: { ruleCode: string; unit: string; from: string; to: string; count: number }[];
}

export interface BuildReport {
  steps: BuildStep[];
  scenarios: { total: number; passed: number };
  /** Why the build did not pass, in words a rules admin can act on; empty when it passed. */
  errors?: string[];
}

/** A unit from GET /units (docs/07 §4.1). */
export interface Unit {
  id: string;
  code: string;
  name: string;
  kind: string;
  allows_12h: boolean;
  allows_16h: boolean;
}

// --- Audit log (docs/07-api-spec.md §4.8) ---

export interface AuditActor {
  username: string;
  displayName: string;
}

/** One audit event, read only. The API keysets on the descending id. */
export interface AuditEvent {
  id: number;
  /** ISO instant. */
  occurredAt: string;
  actor: AuditActor | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ruleSetVersionId?: string | null;
  overrideId?: string | null;
  correlationId?: string | null;
}

export interface AuditPage {
  items: AuditEvent[];
  /** Pass back as beforeId for the next page; null on the last page. */
  nextBeforeId: number | null;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  beforeId?: number;
  limit?: number;
}

// --- Mock sign-in (docs/09-access-control.md §4) ---

/** Exactly what the api sends for a demo user (AuthController's describe()). */
export interface DemoUser {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  /** Unit codes the user may manage, e.g. ["A", "B"]. Empty for no scope. */
  units: string[];
  /** The linked officer, or "" when the account has none. */
  employeeId: string;
}

export interface MockLoginResult {
  token: string;
  expiresAt: string;
  user: DemoUser;
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

/** The api's answer to PATCH or DELETE /assignments/{id}. */
export interface AssignmentChangeResult {
  id: string;
  status: string;
  version: number;
  outcome?: RuleOutcome;
  ruleSetVersion?: number;
  overridable?: boolean;
  ruleResults?: RuleResult[];
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
// ---------------------------------------------------------------------------------------------
// Quarter planner (docs/07 §4.9, docs/ui/planner.md §10)
// ---------------------------------------------------------------------------------------------

export interface PlannerWindow {
  from: string;
  to: string;
  periods: number;
}

/**
 * Plan inputs (PR-M, GET /planner/inputs and `scorecard.inputs` on a draft):
 * what the generator works from, counts only. Generate options live in
 * `options`, so new tailoring options are added there.
 */
export interface PlanInputs {
  window: { from: string; to: string; periods: number };
  options: { seed: number; pattern8h: string | null } & Record<string, unknown>;
  officers: {
    total: number;
    fullTime: number;
    /** Every officer under 1.0 FTE: the generator fills part-time and casual alike. */
    partTime: number;
    fte: number;
    /** PR-N: the FTE of the part-time and casual officers (absent in an older snapshot). */
    partTimeFte?: number;
    /**
     * The staffing floor: the stretch of the quarter (between unit closures)
     * that needs the most officers, or null. With one stretch it is the quarter.
     */
    neededFte: number | null;
    neededFrom?: string | null;
    neededTo?: string | null;
    /** How many stretches the quarter has (1 when no unit closes). */
    neededPeriods?: number;
    /** Every unit the generator plans (the rows of `units`). */
    units: number;
    /** Release v1.3: everyone above, split by position (CO, CS). */
    byPosition?: {
      position: string;
      supervisory: boolean;
      total: number;
      fullTime: number;
      partTime: number;
      fte: number;
    }[];
    /** Release v1.3: the officer units and the supervisor posts among `units`. */
    lineUnits?: number;
    posts?: number;
    /** "150 officers + 12 supervisors in 6 units + 2 supervisor posts" (release v1.3). */
    headline?: string;
  };
  units: {
    code: string;
    name: string;
    allows12h: boolean;
    /** Release v1.3: SUPERVISION for a supervisor post. */
    kind?: string;
    supervision?: boolean;
    /** The officers on the row (release v1.3 S7: the supervisors are counted apart). */
    officers: number;
    supervisors?: number;
    fullTime: number;
    partTime: number;
    fte: number;
    minimums: Record<'NIGHT' | 'DAY' | 'EVENING', number>;
    closedDays: number;
    groups: {
      /** Release v1.3: the group's position (CO, CS); `officers` counts its people. */
      position?: string;
      employment: 'FULL_TIME' | 'PART_TIME';
      hours: number;
      pattern: string;
      patternWords: string;
      officers: number;
      fte: number;
    }[];
  }[];
  leave: { days: number; officers: number; byType: Record<string, number> };
  preferences: {
    officers: number;
    shiftLengthOfficers: number;
    shiftLength: Record<string, number>;
    timesOfDayOfficers: number;
    timesOfDay: Record<string, number>;
    daysOffOfficers: number;
  };
  seniority: { earliest: string | null; latest: string | null };
  rules: { ruleSetVersion: number; historyDays: number; fillOrder: string[] };
}

export interface PlannerScorecard {
  coverage: { shortBlockDays: number; totalBlockDays: number };
  /** What this draft was generated with (PR-M); absent on a draft from before v1.2. */
  inputs?: PlanInputs;
  warnings: {
    total: number;
    byRule: { ruleName: string; count: number }[];
    /** The api's plain sentence about the warnings this plan carries. */
    note?: string;
  };
  preferences: {
    asked: number;
    met: number;
    byKind: { kind: 'SHIFT_LENGTH' | 'TIME_OF_DAY' | 'DAYS_OFF'; asked: number; met: number }[];
  };
  nights: {
    bands: {
      label: string;
      hiredFrom: string;
      hiredTo: string;
      officers: number;
      nightShare: number;
      avoidNightsAsked: number;
      avoidNightsGivenNights: number;
      nightShiftsAgainstWish: number;
    }[];
    newestFirstHeld: boolean;
    check: string;
    /** N12 night-crew figures (V6): officers on N12 and their night shifts. */
    n12Officers?: number;
    n12NightShifts?: number;
    /** The api's plain sentence about the fixed day/night crews. */
    crewNote?: string;
  };
  /** Qualified staff coverage (release 6): read-only, warn-only. */
  qualification?: {
    failingBlockDays: number;
    checkedBlockDays: number;
    /** True when no checked block-day is below the qualified minimum. */
    passes: boolean;
    /** The window the api actually checked, when it sends one. */
    from?: string;
    to?: string;
    byUnitBlock: {
      unitCode: string;
      unitName: string;
      block: Block;
      qualification: string;
      minimum: number;
      failingBlockDays: number;
      checkedBlockDays: number;
    }[];
    validFromRespected: boolean;
    validFromNote: string;
    /** The api's plain lead sentence, rendered as sent. */
    sentence: string;
  };
  /** Each officer's own shift pattern, in words (option C). */
  patterns?: {
    officers: { employeeNo: string; name: string; unitCode: string; pattern: string; words: string }[];
    note: string;
  };
  /** Hours against target by FTE band (V6). */
  fteBands?: {
    bands: {
      band: string;
      officers: number;
      targetHours: number;
      plannedMin: number;
      plannedAvg: number;
      plannedMax: number;
    }[];
    note: string;
  };
  /** The api's plain note about the 5-on/2-off changeover warnings. */
  warningNote?: string;
  /** v1.2: present when the draft was made with crossUnitFill ON. */
  crossUnit?: {
    gapsBefore: number;
    gapsCovered: number;
    shifts: number;
    officers: number;
    fromUnits?: Record<string, number>;
    /** Gaps the pass tried and could not cover, by the first filter nobody passed. */
    stillShortReasons?: Record<string, number>;
    stillShortByUnitBlock?: Record<string, number>;
    line: string;
  };
  pattern8h?: string;
  overtime: { officersOver: number; hoursOver: number; thresholdHours: number };
  generatedMs: number;
  /** Hours per officer across the quarter, min/avg/max. */
  quarterHours?: { min: number; avg: number; max: number };
  weekends?: { min: number; avg: number; max: number };
  /**
   * Release v1.3: the supervisors and the supervisor posts, only when there are any. Every card
   * above counts the officers and the officer units only.
   */
  supervisors?: PlannerSupervisorsCard;
  /** Release v1.3: everyone, split by rank. */
  totals?: PlannerTotals;
}

/**
 * The supervisor card (release v1.3): the same measures as the officer cards, over the
 * supervisors and the supervisor posts. `shifts` counts the shifts on the posts.
 */
export interface PlannerSupervisorsCard {
  supervisors: number;
  posts: number;
  coverage: { coveredBlockDays: number; shortBlockDays: number; totalBlockDays: number };
  shifts: number;
  warnings: { total: number; byRule: { ruleName: string; count: number }[]; note?: string };
  preferences: { asked: number; met: number };
  overtime: { officersOver: number; hoursOver: number; thresholdHours: number };
  absences?: { officers: number; days: number; coveredByRelief: number; uncovered: number };
  line: string;
}

/** Everyone the draft places, split by the person's rank; warnings by the post they were on. */
export interface PlannerTotals {
  shifts: number;
  officerShifts: number;
  supervisorShifts: number;
  people: number;
  officers: number;
  supervisors: number;
  warnings: number;
  lineUnitWarnings: number;
  postWarnings: number;
  /** "5,103 officer + 492 supervisor shifts". */
  line: string;
}

export interface PlannerDraft {
  id: string;
  version: number;
  seed: number;
  pattern8h: string | null;
  status: string;
  createdAt: string;
  createdBy: string;
  generatedMs: number;
  scorecard: PlannerScorecard;
  /** Release 7: shifts edited by hand in this draft. */
  handEdits?: number;
  editedAssignmentIds?: string[];
  /** v1.2: the options this draft was made with (absent on an older api). */
  options?: PlanOptions;
}

/**
 * The quarter plan's tailoring options (v1.2). The names are shared with the
 * Plan inputs panel: staffTypes, partTimeFill, crossUnitFill.
 */
export interface PlanOptions {
  /** FULL_TIME always; PART_TIME = officers below 1.0 FTE (part-time and casual). */
  staffTypes: ('FULL_TIME' | 'PART_TIME')[];
  partTimeFill: 'AFTER_FULL_TIME' | 'UP_TO_FTE';
  /** ON: cover gaps left after the home-unit fills with qualified officers from other units. */
  crossUnitFill: 'OFF' | 'ON';
}

export interface PlannerDraftCreation extends Partial<PlanOptions> {
  seed: number;
  pattern8h?: string;
}

export interface PlannerPlan {
  window: PlannerWindow;
  defaultSeed: number;
  patterns8h: string[] | null;
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  draft: PlannerDraft | null;
  lastCommitted: { draftId: string; at: string; by: string; shiftsWritten: number } | null;
  /** The committed plan's summary, so its tabs can be read after a commit. */
  committedDraft?: PlannerDraft | null;
}

/** Release 7: the body of a planner draft edit (add, move, reassign). */
export interface PlannerAssignmentInput {
  employeeId: string;
  unitId: string;
  shiftTemplate: string;
  startAt: string;
  kind?: 'ROSTERED' | 'EXTRA';
  acknowledgeWarnings?: boolean;
}

/** The preview asks about the change before anything is saved. */
export interface PlannerAssignmentCheck extends PlannerAssignmentInput {
  assignmentId?: string;
}

/** What a saved draft edit returns: the recomputed draft, ready to show. */
export interface PlannerAssignmentResult {
  draftId: string;
  assignmentId: string;
  version: number;
  handEdits: number;
  editedAssignmentIds: string[];
  scorecard: PlannerScorecard;
  warnings: PlannerWarningGroup[];
  warningCount: number;
  gaps: PlannerGap[];
}

export interface PlannerGap {
  unitId: string;
  unitCode: string;
  unitName: string;
  date: string;
  block: Block;
  required: number;
  placed: number;
  reason: string | null;
}

export interface PlannerWarningItem {
  unitCode: string;
  date: string;
  employeeName: string;
  shift: string;
  message: string;
}

export interface PlannerWarningGroup {
  ruleName: string;
  count: number;
  items: PlannerWarningItem[];
}

export type PreferenceShiftLength = 8 | 12 | 16;
export type PreferenceTimeOfDay = 'DAY' | 'EVENING' | 'NIGHT';

/** The shift patterns an officer can be configured with (option C). */
export type OfficerPattern =
  | 'ROTATING_5_2'
  | '5_ON_2_OFF'
  | '7_ON_3_OFF'
  | '4_ON_4_OFF';

/**
 * The parts of the day an officer asked for (P3 preference multi-select): any
 * mix, no duplicates, empty = no preference. Responses carry this field; the
 * single `timeOfDay` is legacy input the api still accepts for one release.
 */
export type PreferenceTimesOfDay = PreferenceTimeOfDay[];

export interface MyPreferences {
  shiftLength: PreferenceShiftLength | null;
  timesOfDay: PreferenceTimesOfDay;
  daysOff: string[];
  maxDaysOff: number;
  allowedLengths: PreferenceShiftLength[];
  updatedAt: string | null;
}

export interface MyPreferencesInput {
  shiftLength: PreferenceShiftLength | null;
  timesOfDay: PreferenceTimesOfDay;
  daysOff: string[];
}

export interface PlannerPreferenceRow {
  employeeId: string;
  name: string;
  employeeNo: string;
  unitName: string;
  seniorityDate: string;
  shiftLength: PreferenceShiftLength | null;
  timesOfDay: PreferenceTimesOfDay;
  daysOff: string[];
  maxDaysOff: number;
  /** The officer's own pattern (option C), the code and its plain words. */
  pattern: OfficerPattern;
  patternWords: string;
  /** True only for 8 h officers: a 12 h officer keeps the crew pattern. */
  patternEditable: boolean;
  inDraft: 'MET' | 'PARTLY' | 'NOT_MET' | 'NO_DRAFT' | 'NOT_ROSTERED' | 'NONE';
  unmet: string[];
  updatedAt: string | null;
}

export type DemoResetState = 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED';

export interface DemoResetStatus {
  state: DemoResetState;
  step: 'clean' | 'audit' | 'generating' | 'rules' | 'proposals' | 'checksum' | 'done' | null;
  startedAt: string | null;
  elapsedMs: number;
  checksum: string | null;
  dataset: string;
  error: string | null;
}

/** `GET /audit-events/actors`: the actors the caller may filter by. */
export interface AuditActorChoice {
  username: string;
  displayName: string;
}

/** `GET /planner/drafts/{id}/coverage`: one entry per unit for the strip. */
export interface PlannerUnitCoverage {
  unitId: string;
  unitName: string;
  coverage: BlockCoverage[];
  /** Plain words when the unit is closed for (part of) the range. */
  closedFrom?: string | null;
  closedTo?: string | null;
  closedLabel?: string | null;
  closedDates?: string[];
  /** The closure's reason, when the api sends it (the roster and board notes). */
  closedReason?: string | null;
}

/** A unit's dated closure (release 3, api contract v2). */
export type UnitToday = 'OPEN' | 'CLOSED' | 'SWITCHED_OFF';
export type ClosureState = 'FUTURE' | 'CURRENT' | 'ENDED';

export interface UnitClosure {
  id: string;
  /** The first closed day. */
  closedFrom: string;
  /** The first open day again, or null when no reopening date is set. */
  reopensOn: string | null;
  reason: string;
  createdBy: string;
  createdAt: string;
  state: ClosureState;
}

export interface PlannerUnit {
  id: string;
  code: string;
  name: string;
  kind: string;
  /** The hard off switch; dated closures are separate. */
  active: boolean;
  /** Today's status, computed by the api (the web never compares dates). */
  today: UnitToday;
  todayNote: string | null;
  allows12h: boolean;
  allows16h: boolean;
  allocated: number;
  filled: number;
  /** Oldest first. */
  closures: UnitClosure[];
}

export interface FlaggedShift {
  shiftId: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  date: string;
  templateCode: string;
  /** e.g. "Day 07-19 (12 h)". */
  shiftLabel: string;
  officerName: string;
  start: string;
  end: string;
  closedFrom: string;
  reason: string;
}

export interface StaffingBreakdown {
  posts12Day: number;
  posts12Night: number;
  posts8: number;
  rawNeeded: number;
  leaveAllowance: number;
  needed: number;
}

export interface StaffingUnitRow {
  unitId: string;
  unitCode: string;
  unitName: string;
  /** True when the unit is closed for the whole period. */
  closed: boolean;
  allocated: number;
  filled: number;
  needed: number;
  shortfall: number;
  breakdown: StaffingBreakdown;
}

export interface StaffingPeriod {
  from: string;
  to: string;
  units: StaffingUnitRow[];
  totals: { allocated: number; filled: number; needed: number; shortfall: number };
}

export interface StaffingReport {
  leaveAllowance: number;
  periods: StaffingPeriod[];
  note: string;
  /** True when more than three periods were collapsed; `note` then says so. */
  truncated: boolean;
}

export interface PlannerCompareRow {
  key: string;
  label: string;
  board: number;
  draft: number;
  unit: 'count' | 'hours' | 'percent';
  direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER' | 'NEUTRAL';
}

export interface PlannerCompare {
  draftShifts: number;
  draftGaps: number;
  committedShifts: number;
  draftStatus?: string;
  /** The api's sentence saying what the comparison is against. */
  basis?: string;
  rows: PlannerCompareRow[];
}

export interface PlannerCommitPreview {
  version: number;
  /** Everyone's shifts; the two counts below split it by the person's rank (release v1.3). */
  shiftsToWrite: number;
  /** Officers only since release v1.3; `supervisors` counts the supervisors. */
  officers: number;
  shortBlockDays: number;
  warningCount: number;
  from: string;
  to: string;
  supervisors?: number;
  officerShifts?: number;
  supervisorShifts?: number;
}

export interface PlannerCommitResult {
  shiftsWritten: number;
  committedAt: string;
  auditEventId: number;
  units: string[];
  firstWeek: string;
  /** The rank split of `shiftsWritten` (release v1.3). */
  officerShifts?: number;
  supervisorShifts?: number;
}

export interface PlannerCommitFailure {
  unitCode: string;
  date: string;
  employeeName: string;
  shift: string;
  ruleResults: RuleResult[];
}

// --- Shift proposals, the officer's side (docs/07 §4.4) ---

/** One draft shift, as the api takes it. The proposer is always the caller. */
export interface ProposalItemInput {
  unitId: string;
  shiftTemplate: string;
  startAt: string;
}

/** One draft's answer from POST /proposals/preview. */
export interface ProposalPreviewItem {
  index: number;
  unitId: string;
  unit: string;
  shiftTemplate: string;
  startAt: string;
  endAt: string;
  outcome: RuleOutcome;
  ruleSetVersion: number;
  ruleResults: RuleResult[];
  /** A plain-words refusal that is not a rule (locked period, closed unit, already waiting). */
  problem: string | null;
  problemCode: string | null;
}

export interface ProposalPreview {
  outcome: RuleOutcome;
  canSend: boolean;
  items: ProposalPreviewItem[];
}

export type ProposalItemDecision = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED';

export type ProposalDisplayState =
  | 'WAITING'
  | 'APPROVED'
  | 'PARTLY_APPROVED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'EXPIRED';

export interface MyProposalItem {
  id: string;
  unitId: string;
  unit: string;
  unitName: string;
  shiftTemplate: string;
  startAt: string;
  endAt: string;
  workDate: string;
  decision: ProposalItemDecision;
  outcomeAtSubmit: RuleOutcome | null;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

/** A proposal from GET /me/proposals. `note` is the officer's plain text. */
export interface MyProposal {
  id: string;
  status: 'WAITING' | 'DECIDED' | 'WITHDRAWN' | 'EXPIRED';
  displayState: ProposalDisplayState;
  note: string | null;
  submittedAt: string;
  withdrawnAt: string | null;
  version: number;
  canWithdraw: boolean;
  items: MyProposalItem[];
}

// --- Shift proposals, the decider's side (docs/07 §4.4, v1.3 P4) ---

/** One card of GET /proposals. */
export interface ProposalInboxCard {
  id: string;
  employeeId: string;
  officerName: string;
  homeUnit: string | null;
  /** The unit codes of the proposal's shifts. */
  units: string[];
  itemCount: number;
  itemsInScope: number;
  waitingInScope: number;
  submittedAt: string;
  status: 'WAITING' | 'DECIDED' | 'WITHDRAWN' | 'EXPIRED';
  displayState: ProposalDisplayState;
  version: number;
  /** The caller's own proposal: read-only, another supervisor or the planner decides it. */
  own: boolean;
  /** The shifts on the caller's units, in start order (v1.3 P4 gate). */
  shifts: ProposalCardShift[];
}

export interface ProposalCardShift {
  unit: string;
  shiftTemplate: string;
  startAt: string;
  workDate: string;
  decision: ProposalItemDecision;
}

export interface ProposalInboxQuery {
  status?: 'WAITING' | 'ALL';
  unitId?: string;
}

/** The officer's pay period around one shift (P-01, owner Q5). */
export interface ProposalPayPeriod {
  start: string;
  end: string;
  hoursBefore: number;
  hoursAfter: number;
  thresholdHours: number;
  wouldBeOvertimeHours: number;
  overtimeStatus: OvertimeStatus;
}

/** The open shift a proposed shift matches, and the officer's place in its overtime order. */
export interface ProposalOpenShiftMatch {
  id: string;
  status: string;
  /** 1-based among the eligible officers, or null when the officer is not eligible. */
  otOrderPosition: number | null;
  otOrderSize: number;
  eligibility: string;
  outOfOrder: boolean;
  liveOffers: number;
}

/** A stored rule result: the outcome and its rule rows, as at the send. */
export interface ProposalRuleSnapshot {
  outcome?: RuleOutcome;
  ruleSetVersion?: number;
  ruleResults?: RuleResult[];
}

export interface ProposalDetailItem {
  id: string;
  unitId: string;
  unit: string;
  unitName: string;
  shiftTemplate: string;
  startAt: string;
  endAt: string;
  workDate: string;
  hours: number;
  decision: ProposalItemDecision;
  /** On a unit in the caller's scope; otherwise only what and its outcome are sent. */
  inScope: boolean;
  canDecide: boolean;
  outcomeAtSubmit: RuleOutcome | null;
  ruleAtSubmit: ProposalRuleSnapshot | null;
  outcomeNow: RuleOutcome | null;
  ruleNow: RuleCheckOutcome | null;
  ruleChanged: boolean;
  wouldBeOvertimeHours: number | null;
  payPeriod: ProposalPayPeriod | null;
  openShift: ProposalOpenShiftMatch | null;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  acknowledgedCodes: string[] | null;
  outOfOvertimeOrder: boolean;
  assignmentId: string | null;
}

/** GET /proposals/{id}: the note is the officer's plain text. */
export interface ProposalDetail {
  id: string;
  status: 'WAITING' | 'DECIDED' | 'WITHDRAWN' | 'EXPIRED';
  displayState: ProposalDisplayState;
  version: number;
  note: string | null;
  submittedAt: string;
  withdrawnAt: string | null;
  employeeId: string;
  officerName: string;
  homeUnit: string | null;
  own: boolean;
  canDecide: boolean;
  items: ProposalDetailItem[];
}

/** One item of POST /proposals/{id}/decision. */
export interface ProposalDecisionInput {
  id: string;
  accept: boolean;
  comment?: string;
  acknowledgeWarnings?: string[];
  acknowledgeOutOfOrder?: boolean;
}

/** One accepted item's fresh result in a 422 refusal of a decision. */
export interface ProposalRefusalItem {
  id: string;
  unit: string;
  shiftTemplate: string;
  startAt: string;
  outcome: RuleOutcome;
  warnCodes: string[];
  ruleResults: RuleResult[];
  otOrderPosition?: number | null;
  otOrderSize?: number;
  outOfOrder?: boolean;
  /** The matched open shift now, and its offers still live (v1.3 P5). */
  openShiftId?: string;
  liveOffers?: number;
}

export interface ShiftCircleApi {
  getSchedule(query: ScheduleQuery): Promise<SchedulePayload>;
  previewRuleCheck(request: RuleCheckRequest): Promise<RuleCheckOutcome>;
  saveChange(request: SaveRequest): Promise<SaveOutcome>;

  /**
   * POST /schedule-periods/{id}/publish: a supervisor publishes their unit's
   * roster week. One way: a second publish answers 409.
   */
  publishSchedulePeriod(periodId: string): Promise<PublishedPeriod>;

  /** Quarter planner (PLANNER role): plan, drafts, gaps, warnings, commit. */
  getPlannerPlan(): Promise<PlannerPlan>;
  /** What Generate would use now (PR-M). PLANNER only. */
  /** PR-N: with the Generate form's options, so the inputs match what Generate would use. */
  getPlannerInputs(options?: PlanOptions): Promise<PlanInputs>;
  createPlannerDraft(body: PlannerDraftCreation): Promise<PlannerDraft>;
  /** POST /planner/absences: the planner records one day of planned leave (PR-D, fit-gap A9). */
  planAbsence(input: PlannedAbsenceInput): Promise<PlannedAbsence>;
  /** PUT /planner/preferences/{employeeId}/pattern: the planner sets an 8 h officer's pattern. */
  setPlannerOfficerPattern(employeeId: string, pattern: string): Promise<PlannerPreferenceRow>;
  getPlannerDraft(draftId: string): Promise<PlannerDraft>;
  getPlannerGaps(draftId: string): Promise<PlannerGap[]>;
  getPlannerWarnings(draftId: string): Promise<PlannerWarningGroup[]>;
  getPlannerSchedule(
    draftId: string,
    query: { unitId: string; from: string; to: string },
  ): Promise<SchedulePayload>;
  getPlannerCoverage(
    draftId: string,
    range: { from: string; to: string },
  ): Promise<PlannerUnitCoverage[]>;
  getAuditActors(): Promise<AuditActorChoice[]>;

  /** The demo reset (PLANNER only, demo profile only): start it, poll it. */
  resetDemo(confirm: string, dataset: string): Promise<DemoResetStatus>;
  getDemoResetStatus(): Promise<DemoResetStatus>;
  getPlannerCompare(draftId: string): Promise<PlannerCompare>;

  /** Release 7: check and save one hand edit in a DRAFT. */
  previewPlannerAssignment(
    draftId: string,
    input: PlannerAssignmentCheck,
  ): Promise<RuleCheckOutcome>;
  addPlannerAssignment(
    draftId: string,
    version: number,
    input: PlannerAssignmentInput,
  ): Promise<PlannerAssignmentResult>;
  updatePlannerAssignment(
    draftId: string,
    assignmentId: string,
    version: number,
    input: PlannerAssignmentInput,
  ): Promise<PlannerAssignmentResult>;
  removePlannerAssignment(
    draftId: string,
    assignmentId: string,
    version: number,
  ): Promise<PlannerAssignmentResult>;

  /** Preferences: the officer's own, and the planner's read of everyone's. */
  getMyPreferences(): Promise<MyPreferences>;
  putMyPreferences(input: MyPreferencesInput): Promise<MyPreferences>;
  deleteMyPreferences(): Promise<void>;
  getPlannerPreferences(unitId?: string): Promise<PlannerPreferenceRow[]>;
  /** Release 3: units, their dated closures, flagged shifts and staffing. */
  getPlannerUnits(): Promise<PlannerUnit[]>;
  addUnitClosure(
    unitId: string,
    input: { closedFrom: string; reopensOn?: string | null; reason: string },
  ): Promise<UnitClosure>;
  updateUnitClosure(
    unitId: string,
    closureId: string,
    input: { closedFrom?: string; reopensOn?: string | null; reason: string },
  ): Promise<UnitClosure>;
  removeUnitClosure(unitId: string, closureId: string): Promise<void>;
  previewUnitClosure(
    unitId: string,
    input: { closedFrom: string; reopensOn?: string | null },
  ): Promise<{ officersHomed: number; publishedShiftsAffected: number }>;
  getFlaggedShifts(): Promise<FlaggedShift[]>;
  getStaffing(): Promise<StaffingReport>;
  setUnitAllocation(unitId: string, allocated: number, reason: string): Promise<StaffingUnitRow>;
  setLeaveAllowance(percent: number, reason: string): Promise<{ leaveAllowance: number }>;
  getPlannerCommitPreview(draftId: string): Promise<PlannerCommitPreview>;
  commitPlannerDraft(
    draftId: string,
    version: number,
    acceptedWarningCount: number,
  ): Promise<PlannerCommitResult>;
  discardPlannerDraft(draftId: string): Promise<void>;

  /** PATCH /assignments/{id}; the version goes in If-Match. */
  moveAssignment(
    assignmentId: string,
    version: number,
    request: SaveRequest,
  ): Promise<AssignmentChangeResult>;

  /** DELETE /assignments/{id} with a reason; the version goes in If-Match. */
  cancelAssignment(
    assignmentId: string,
    version: number,
    reason: string,
  ): Promise<AssignmentChangeResult>;

  // Overtime.
  getOpenShifts(query: OpenShiftQuery): Promise<OpenShift[]>;
  getOpenShiftCandidates(openShiftId: string): Promise<OpenShiftCandidates>;
  createOffers(openShiftId: string, employeeIds: string[]): Promise<OfferRecord[]>;
  confirmOffer(offerId: string): Promise<OfferRecord>;
  assignOpenShift(openShiftId: string, employeeId: string): Promise<SaveOutcome>;

  // My schedule.
  getMySchedule(query: ScheduleQuery): Promise<MySchedulePayload>;
  getMyOffers(): Promise<MyOffer[]>;
  respondToOffer(offerId: string, response: OfferResponse): Promise<MyOffer>;

  // Shift proposals, the officer's side (docs/07 §4.4, v1.3 P3).
  /** POST /proposals/preview: every draft checked with the drafts that start before it. */
  previewProposal(items: ProposalItemInput[]): Promise<ProposalPreview>;
  /** POST /proposals: send the drafts with an optional note (201). */
  submitProposal(note: string, items: ProposalItemInput[]): Promise<MyProposal>;
  /** GET /me/proposals: the caller's own proposals, newest first. */
  getMyProposals(): Promise<MyProposal[]>;
  /** POST /proposals/{id}/withdraw; the version goes in If-Match. */
  withdrawProposal(proposalId: string, version: number): Promise<MyProposal>;

  // Shift proposals, the decider's side (docs/07 §4.4, v1.3 P4).
  /** GET /proposals: the inbox cards the caller may see (a supervisor's units; the planner all). */
  getProposalInbox(query: ProposalInboxQuery): Promise<ProposalInboxCard[]>;
  /** GET /proposals/count?status=WAITING: for the nav. */
  getProposalCount(): Promise<number>;
  /** GET /proposals/{id}: rules when sent and now, overtime hours, the open-shift match. */
  getProposal(proposalId: string): Promise<ProposalDetail>;
  /** POST /proposals/{id}/decision; the version goes in If-Match. 422 carries `items`. */
  decideProposal(
    proposalId: string,
    version: number,
    items: ProposalDecisionInput[],
  ): Promise<ProposalDetail>;

  // Reference data.
  getUnits(): Promise<Unit[]>;

  // Audit log.
  getAuditEvents(query: AuditQuery): Promise<AuditPage>;

  // Mock sign-in.
  getDemoUsers(): Promise<DemoUser[]>;
  mockLogin(userId: string): Promise<MockLoginResult>;

  // Rules administration.
  getRuleSets(): Promise<RuleSetVersion[]>;
  createRuleSetDraft(basedOn: number, reason: string): Promise<RuleSetVersion>;
  getRuleTable(version: number, code: string): Promise<RuleTable>;
  saveRuleRows(version: number, code: string, rows: RuleTableRow[]): Promise<RuleTable>;
  buildRuleSet(version: number): Promise<BuildReport>;
  submitRuleSet(version: number): Promise<RuleSetVersion>;
  approveRuleSet(version: number): Promise<RuleSetVersion>;
  publishRuleSet(version: number, effectiveDate: string): Promise<RuleSetVersion>;

  // Reports.
  getCoverageReport(query: ReportQuery): Promise<CoverageReport>;
  getHoursReport(query: ReportQuery): Promise<HoursReport>;
  getOvertimeReport(query: ReportQuery): Promise<OvertimeReport>;
  getOverrides(query: ReportQuery): Promise<OverrideRow[]>;
  exportReportCsv(
    report: 'coverage' | 'hours' | 'overtime' | 'overrides',
    query: ReportQuery,
  ): Promise<{ fileName: string; content: string }>;

  // Time and attendance.
  getPayPeriods(): Promise<PayPeriod[]>;
  getTimeEntries(payPeriodId: string): Promise<TimeEntry[]>;
  recordActual(entryId: string, input: RecordActualInput): Promise<RecordActualResult>;
  /** DELETE /time-entries/{assignmentId}: back to "needs actual". */
  clearActual(assignmentId: string): Promise<RecordActualResult>;
  lockPayPeriod(payPeriodId: string): Promise<PayPeriod>;
  unlockPayPeriod(payPeriodId: string, reason: string): Promise<PayPeriod>;
  exportPayroll(payPeriodId: string): Promise<{ fileName: string; content: string }>;

  // Wall display (counts only, no names).
  getDisplayToday(): Promise<DisplayToday>;
}

/**
 * One block of one unit on the wall display (docs/07 §4.8). Counts only.
 * `actual` is null until the day has recorded actuals.
 */
export interface DisplayBlock {
  block: Block;
  required: number;
  scheduled: HourlyCoverage;
  actual: HourlyCoverage | null;
  covered: boolean;
}

export interface DisplayUnit {
  unit: { id: string; name: string };
  coverage: DisplayBlock[];
  openShifts: number;
  officersInOvertime: number;
  /** Release 3: the unit is closed today; the card says so instead of counts. */
  closedToday?: boolean;
  closedNote?: string | null;
}

/**
 * A supervisor post on the wall (release v1.3 S7): counts only. `area` is the
 * post's name without "Supervision · " ("Operations").
 */
export interface DisplayPost {
  post: { id: string; name: string };
  area: string;
  coverage: DisplayBlock[];
}

/** `GET /display/today`: no names, employee numbers or employee ids, by contract. */
export interface DisplayToday {
  /** The demo day the counts are for (YYYY-MM-DD). */
  asOf: string;
  /** When the api built the answer (an instant). */
  generatedAt: string;
  units: DisplayUnit[];
  totalOpenShifts: number;
  totalOfficersInOvertime: number;
  /** The supervisor posts in scope (release v1.3 S7); the unit tiles and totals exclude them. */
  posts: DisplayPost[];
}

export interface OpenShiftQuery {
  unitId?: string;
  from?: string;
  to?: string;
  status?: OpenShiftStatus;
}
