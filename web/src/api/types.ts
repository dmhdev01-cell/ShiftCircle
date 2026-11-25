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
  };
  from: string;
  to: string;
  /** ISO dates of the days on the board. */
  days: string[];
  /** The server's "today" (`SC_DEMO_TODAY` on the demo profile). */
  asOf: string;
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
    role: string;
    unit: { id: string; name: string };
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

export interface PlannerScorecard {
  coverage: { shortBlockDays: number; totalBlockDays: number };
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
  pattern8h?: string;
  overtime: { officersOver: number; hoursOver: number; thresholdHours: number };
  generatedMs: number;
  /** Hours per officer across the quarter, min/avg/max. */
  quarterHours?: { min: number; avg: number; max: number };
  weekends?: { min: number; avg: number; max: number };
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
  step: 'clean' | 'audit' | 'generating' | 'rules' | 'checksum' | 'done' | null;
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
  /** Present when more than three periods were collapsed. */
  truncatedNote?: string;
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
  shiftsToWrite: number;
  officers: number;
  shortBlockDays: number;
  warningCount: number;
  from: string;
  to: string;
}

export interface PlannerCommitResult {
  shiftsWritten: number;
  committedAt: string;
  auditEventId: number;
  units: string[];
  firstWeek: string;
}

export interface PlannerCommitFailure {
  unitCode: string;
  date: string;
  employeeName: string;
  shift: string;
  ruleResults: RuleResult[];
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
  createPlannerDraft(body: { seed: number; pattern8h?: string }): Promise<PlannerDraft>;
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
  // Sending proposals is not built: the api has no /proposals endpoint (M1).

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

/** `GET /display/today`: no names, employee numbers or employee ids, by contract. */
export interface DisplayToday {
  /** The demo day the counts are for (YYYY-MM-DD). */
  asOf: string;
  /** When the api built the answer (an instant). */
  generatedAt: string;
  units: DisplayUnit[];
  totalOpenShifts: number;
  totalOfficersInOvertime: number;
}

export interface OpenShiftQuery {
  unitId?: string;
  from?: string;
  to?: string;
  status?: OpenShiftStatus;
}
