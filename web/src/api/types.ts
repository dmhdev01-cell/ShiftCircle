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
  /** The shifts with no actual, when the api refuses to lock (ADR-017). */
  missing?: MissingActual[];
}

export const BLOCKED_BY_RULES = 'https://shiftcircle.local/problems/blocked-by-rules';
export const MISSING_ACTUALS = 'https://shiftcircle.local/problems/missing-actuals';
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
  /** The server's "today" (`SC_DEMO_TODAY` on the demo profile). */
  asOf: string;
  coverage: BlockCoverage[];
  officers: OfficerRow[];
  /** Rule warnings on the published week. */
  warnings: number;
  /** Emergency overrides recorded in the pay period on the board. */
  overridesThisPeriod: number;
  /** Whether the period is published, and how many changes are not. */
  publishedState: {
    published: boolean;
    unpublishedChanges: number;
  };
  /** The pay period the board shows. Not in the contract yet. */
  period?: {
    id: string;
    label: string;
  };
}

export interface ScheduleQuery {
  unitId?: string;
  from?: string;
  to?: string;
}

// --- Overtime (docs/07-api-spec.md §4.3) ---

export type OpenShiftStatus = 'OPEN' | 'OFFERS_SENT' | 'FILLED';

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
  status: OfferStatus;
}

export type OfferResponse = 'ACCEPT' | 'DECLINE';

// --- Time and attendance (docs/07-api-spec.md §4.5, ADR-017) ---

export type AbsenceType = 'SICK' | 'VACATION';

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
  actualPercent?: number;
  /** True for a week that has not happened yet. */
  planned: boolean;
}

export interface CoverageReport {
  weeks: CoverageWeek[];
  /** The axis starts here, and the screen says so. */
  axisFrom: number;
  axisTo: number;
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

export type RuleSetStatus = 'LIVE' | 'DRAFT' | 'SUBMITTED' | 'PUBLISHED' | 'REJECTED';

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
}

export interface RuleTable {
  code: string;
  name: string;
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
  impact?: { ruleCode: string; unit: string; from: string; to: string; count: number }[];
}

export interface BuildReport {
  steps: BuildStep[];
  scenarios: { total: number; passed: number };
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
  submitProposals(note: string, items: RuleCheckChange[]): Promise<{ id: string; accepted: number }>;

  // Rules administration.
  getRuleSets(): Promise<RuleSetVersion[]>;
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
  lockPayPeriod(payPeriodId: string): Promise<PayPeriod>;
  unlockPayPeriod(payPeriodId: string, reason: string): Promise<PayPeriod>;
  exportPayroll(payPeriodId: string): Promise<{ fileName: string; content: string }>;
}

export interface OpenShiftQuery {
  unitId?: string;
  from?: string;
  to?: string;
  status?: OpenShiftStatus;
}
