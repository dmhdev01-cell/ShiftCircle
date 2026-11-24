import type {
  CoverageReport,
  DemoUser,
  HoursReport,
  MockLoginResult,
  MyOffer,
  MySchedulePayload,
  OvertimeReport,
  OverrideRow,
  PayPeriod,
  PlannerAssignmentCheck,
  PlannerAssignmentInput,
  PlannerAssignmentResult,
  PlannerCommitPreview,
  PlannerCompare,
  MyPreferences,
  AuditActorChoice,
  DemoResetStatus,
  MyPreferencesInput,
  PlannedAbsence,
  PlannedAbsenceInput,
  PlannerPreferenceRow,
  PlannerUnit,
  UnitClosure,
  FlaggedShift,
  StaffingReport,
  StaffingUnitRow,
  PlannerUnitCoverage,
  PlannerCommitResult,
  PlannerDraft,
  PlannerGap,
  PlannerPlan,
  PlanInputs,
  PlannerWarningGroup,
  RecordActualInput,
  RecordActualResult,
  TimeEntry,
  Unit,
  OfferRecord,
  OfferResponse,
  OpenShift,
  OpenShiftCandidates,
  OpenShiftQuery,
  ProblemDetails,
  PublishedPeriod,
  RuleCheckOutcome,
  BuildReport,
  ReportQuery,
  RuleCheckRequest,
  RuleSetVersion,
  RuleTable,
  RuleTableRow,
  SaveOutcome,
  SaveRequest,
  AuditPage,
  AuditQuery,
  SchedulePayload,
  ScheduleQuery,
  AssignmentChangeResult,
  ShiftCircleApi,
} from './types';

import { getToken, sessionExpired } from './session';
import { toDisplayToday } from '../display/displayPayload';

export const API_BASE = '/api/v1';

/**
 * The sentence a screen shows when the browser could not reach the api at all.
 * fetch's own message ("Failed to fetch") is about the browser, not the work.
 */
export const UNREACHABLE_MESSAGE = 'Could not reach the API. Check the connection and try again.';

/** An api answer that was not a success. Carries the Problem Details body. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem?: ProblemDetails;

  constructor(message: string, status: number, problem?: ProblemDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  /** True when the api blocked the change with a rule result. */
  get blockedByRules(): boolean {
    return this.problem?.type === 'https://shiftcircle.local/problems/blocked-by-rules';
  }

  /** True when the api wants Warn results acknowledged. */
  get needsAcknowledgement(): boolean {
    return (
      this.problem?.type === 'https://shiftcircle.local/problems/warnings-need-acknowledgement'
    );
  }
}

async function readProblem(response: Response): Promise<ProblemDetails | undefined> {
  try {
    const body = await response.json();
    return typeof body === 'object' && body !== null ? (body as ProblemDetails) : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // The browser's own words ("Failed to fetch") are not an answer a
    // supervisor can act on.
    throw new ApiError(UNREACHABLE_MESSAGE, 0);
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    if (response.status === 401) {
      // The token is gone or expired: end the session so the shell can send
      // the person to the sign-in screen (docs/ui/build-notes.md §2.1).
      sessionExpired();
    }
    throw new ApiError(
      problem?.detail ?? problem?.title ?? `${response.status} ${response.statusText}`,
      response.status,
      problem,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** The payroll export is text/csv, not JSON. */
async function requestCsv(path: string): Promise<{ fileName: string; content: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: 'text/csv',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
    });
  } catch {
    // The browser's own words ("Failed to fetch") are not an answer a
    // supervisor can act on.
    throw new ApiError(UNREACHABLE_MESSAGE, 0);
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    if (response.status === 401) {
      sessionExpired();
    }
    throw new ApiError(
      problem?.detail ?? problem?.title ?? `${response.status} ${response.statusText}`,
      response.status,
      problem,
    );
  }

  return {
    fileName: path.split('/').pop() ?? 'payroll-export.csv',
    content: await response.text(),
  };
}

function queryString(query: {
  unitId?: string;
  from?: string;
  to?: string;
  status?: string;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const asString = params.toString();
  return asString ? `?${asString}` : '';
}

/** The real api over HTTP. */
export function createHttpApi(): ShiftCircleApi {
  return {
    getSchedule(query: ScheduleQuery): Promise<SchedulePayload> {
      return request<SchedulePayload>(`/schedule${queryString(query)}`);
    },

    previewRuleCheck(body: RuleCheckRequest): Promise<RuleCheckOutcome> {
      return request<RuleCheckOutcome>('/rule-checks', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },

    saveChange(save: SaveRequest): Promise<SaveOutcome> {
      const body = JSON.stringify({
        change: save.change,
        ...(save.acknowledgeWarnings ? { acknowledgeWarnings: save.acknowledgeWarnings } : {}),
        ...(save.override ? { override: save.override } : {}),
      });
      // The api creates a rostered (ASSIGN) or extra (EXTRA) shift here. It has
      // no move or cancel endpoint yet, so the screens never send one.
      return request<SaveOutcome>('/assignments', {
        method: 'POST',
        body,
      });
    },

    publishSchedulePeriod(periodId: string): Promise<PublishedPeriod> {
      return request<PublishedPeriod>(`/schedule-periods/${periodId}/publish`, {
        method: 'POST',
      });
    },

    // Quarter planner (docs/07 §4.9). The commit is optimistic: If-Match holds
    // the draft version the planner saw.
    getPlannerPlan(): Promise<PlannerPlan> {
      return request<PlannerPlan>('/planner/plan');
    },
    getPlannerInputs(): Promise<PlanInputs> {
      return request<PlanInputs>('/planner/inputs');
    },
    createPlannerDraft(body: { seed: number; pattern8h?: string }): Promise<PlannerDraft> {
      return request<PlannerDraft>('/planner/drafts', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getPlannerDraft(draftId: string): Promise<PlannerDraft> {
      return request<PlannerDraft>(`/planner/drafts/${draftId}`);
    },
    getPlannerGaps(draftId: string): Promise<PlannerGap[]> {
      return request<PlannerGap[]>(`/planner/drafts/${draftId}/gaps`);
    },
    getPlannerWarnings(draftId: string): Promise<PlannerWarningGroup[]> {
      return request<PlannerWarningGroup[]>(`/planner/drafts/${draftId}/warnings`);
    },
    getPlannerSchedule(
      draftId: string,
      query: { unitId: string; from: string; to: string },
    ): Promise<SchedulePayload> {
      const params = new URLSearchParams({
        unitId: query.unitId,
        from: query.from,
        to: query.to,
      });
      return request<SchedulePayload>(`/planner/drafts/${draftId}/schedule?${params.toString()}`);
    },
    getPlannerCoverage(
      draftId: string,
      range: { from: string; to: string },
    ): Promise<PlannerUnitCoverage[]> {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      return request<PlannerUnitCoverage[]>(`/planner/drafts/${draftId}/coverage?${params.toString()}`);
    },
    resetDemo(confirm: string, dataset: string): Promise<DemoResetStatus> {
      return request<DemoResetStatus>('/demo/reset', {
        method: 'POST',
        body: JSON.stringify({ confirm, dataset }),
      });
    },
    getDemoResetStatus(): Promise<DemoResetStatus> {
      return request<DemoResetStatus>('/demo/reset/status');
    },
    getAuditActors(): Promise<AuditActorChoice[]> {
      return request<AuditActorChoice[]>('/audit-events/actors');
    },
    getMyPreferences(): Promise<MyPreferences> {
      return request<MyPreferences>('/me/preferences');
    },
    putMyPreferences(input: MyPreferencesInput): Promise<MyPreferences> {
      return request<MyPreferences>('/me/preferences', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    deleteMyPreferences(): Promise<void> {
      return request<void>('/me/preferences', { method: 'DELETE' });
    },
    getPlannerUnits(): Promise<PlannerUnit[]> {
      return request<PlannerUnit[]>('/planner/units');
    },
    addUnitClosure(
      unitId: string,
      input: { closedFrom: string; reopensOn?: string | null; reason: string },
    ): Promise<UnitClosure> {
      return request<UnitClosure>(`/planner/units/${unitId}/closures`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    updateUnitClosure(
      unitId: string,
      closureId: string,
      input: { closedFrom?: string; reopensOn?: string | null; reason: string },
    ): Promise<UnitClosure> {
      return request<UnitClosure>(`/planner/units/${unitId}/closures/${closureId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    removeUnitClosure(unitId: string, closureId: string): Promise<void> {
      return request<void>(`/planner/units/${unitId}/closures/${closureId}`, {
        method: 'DELETE',
      });
    },
    previewUnitClosure(
      unitId: string,
      input: { closedFrom: string; reopensOn?: string | null },
    ): Promise<{ officersHomed: number; publishedShiftsAffected: number }> {
      return request<{ officersHomed: number; publishedShiftsAffected: number }>(
        `/planner/units/${unitId}/closures/preview`,
        { method: 'POST', body: JSON.stringify(input) },
      );
    },
    getFlaggedShifts(): Promise<FlaggedShift[]> {
      return request<FlaggedShift[]>('/planner/flagged-shifts');
    },
    getStaffing(): Promise<StaffingReport> {
      return request<StaffingReport>('/planner/staffing');
    },
    setUnitAllocation(unitId: string, allocated: number, reason: string): Promise<StaffingUnitRow> {
      return request<StaffingUnitRow>(`/planner/units/${unitId}/staffing`, {
        method: 'PUT',
        body: JSON.stringify({ allocated, reason }),
      });
    },
    setLeaveAllowance(percent: number, reason: string): Promise<{ leaveAllowance: number }> {
      return request<{ leaveAllowance: number }>('/planner/settings/leave-allowance', {
        method: 'PUT',
        body: JSON.stringify({ percent, reason }),
      });
    },
    planAbsence(input: PlannedAbsenceInput): Promise<PlannedAbsence> {
      return request<PlannedAbsence>('/planner/absences', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    setPlannerOfficerPattern(employeeId: string, pattern: string): Promise<PlannerPreferenceRow> {
      return request<PlannerPreferenceRow>(`/planner/preferences/${employeeId}/pattern`, {
        method: 'PUT',
        body: JSON.stringify({ pattern }),
      });
    },
    getPlannerPreferences(unitId?: string): Promise<PlannerPreferenceRow[]> {
      const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
      return request<PlannerPreferenceRow[]>(`/planner/preferences${query}`);
    },

    getPlannerCompare(draftId: string): Promise<PlannerCompare> {
      return request<PlannerCompare>(`/planner/drafts/${draftId}/compare`);
    },
    getPlannerCommitPreview(draftId: string): Promise<PlannerCommitPreview> {
      return request<PlannerCommitPreview>(`/planner/drafts/${draftId}/commit-preview`);
    },
    commitPlannerDraft(
      draftId: string,
      version: number,
      acceptedWarningCount: number,
    ): Promise<PlannerCommitResult> {
      return request<PlannerCommitResult>(`/planner/drafts/${draftId}/commit`, {
        method: 'POST',
        headers: { 'If-Match': `"${version}"` },
        body: JSON.stringify({ acceptedWarningCount }),
      });
    },
    discardPlannerDraft(draftId: string): Promise<void> {
      return request<void>(`/planner/drafts/${draftId}/discard`, { method: 'POST' });
    },

    previewPlannerAssignment(
      draftId: string,
      input: PlannerAssignmentCheck,
    ): Promise<RuleCheckOutcome> {
      return request<RuleCheckOutcome>(`/planner/drafts/${draftId}/assignment-checks`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    addPlannerAssignment(
      draftId: string,
      version: number,
      input: PlannerAssignmentInput,
    ): Promise<PlannerAssignmentResult> {
      return request<PlannerAssignmentResult>(`/planner/drafts/${draftId}/assignments`, {
        method: 'POST',
        headers: { 'If-Match': `"${version}"` },
        body: JSON.stringify(input),
      });
    },
    updatePlannerAssignment(
      draftId: string,
      assignmentId: string,
      version: number,
      input: PlannerAssignmentInput,
    ): Promise<PlannerAssignmentResult> {
      return request<PlannerAssignmentResult>(
        `/planner/drafts/${draftId}/assignments/${assignmentId}`,
        {
          method: 'PUT',
          headers: { 'If-Match': `"${version}"` },
          body: JSON.stringify(input),
        },
      );
    },
    removePlannerAssignment(
      draftId: string,
      assignmentId: string,
      version: number,
    ): Promise<PlannerAssignmentResult> {
      return request<PlannerAssignmentResult>(
        `/planner/drafts/${draftId}/assignments/${assignmentId}`,
        { method: 'DELETE', headers: { 'If-Match': `"${version}"` } },
      );
    },

    moveAssignment(
      assignmentId: string,
      version: number,
      save: SaveRequest,
    ): Promise<AssignmentChangeResult> {
      return request<AssignmentChangeResult>(`/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'If-Match': `"${version}"` },
        body: JSON.stringify({
          change: save.change,
          ...(save.acknowledgeWarnings ? { acknowledgeWarnings: save.acknowledgeWarnings } : {}),
          ...(save.override ? { override: save.override } : {}),
        }),
      });
    },

    cancelAssignment(
      assignmentId: string,
      version: number,
      reason: string,
    ): Promise<AssignmentChangeResult> {
      return request<AssignmentChangeResult>(`/assignments/${assignmentId}`, {
        method: 'DELETE',
        headers: { 'If-Match': `"${version}"` },
        body: JSON.stringify({ reason }),
      });
    },

    getOpenShifts(query: OpenShiftQuery): Promise<OpenShift[]> {
      return request<OpenShift[]>(`/open-shifts${queryString(query)}`);
    },

    getOpenShiftCandidates(openShiftId: string): Promise<OpenShiftCandidates> {
      return request<OpenShiftCandidates>(`/open-shifts/${openShiftId}/candidates`);
    },

    createOffers(openShiftId: string, employeeIds: string[]): Promise<OfferRecord[]> {
      return request<OfferRecord[]>(`/open-shifts/${openShiftId}/offers`, {
        method: 'POST',
        body: JSON.stringify({ employeeIds, ordered: false }),
      });
    },

    confirmOffer(offerId: string): Promise<OfferRecord> {
      return request<OfferRecord>(`/offers/${offerId}/confirm`, { method: 'POST' });
    },

    assignOpenShift(openShiftId: string, employeeId: string): Promise<SaveOutcome> {
      return request<SaveOutcome>(`/open-shifts/${openShiftId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ employeeId }),
      });
    },

    getMySchedule(query: ScheduleQuery): Promise<MySchedulePayload> {
      return request<MySchedulePayload>(`/me/schedule${queryString(query)}`);
    },

    getMyOffers(): Promise<MyOffer[]> {
      // All of this officer's offers, so an accepted or confirmed one stays visible.
      return request<MyOffer[]>('/me/offers');
    },

    respondToOffer(offerId: string, response: OfferResponse): Promise<MyOffer> {
      return request<MyOffer>(`/offers/${offerId}/${response.toLowerCase()}`, {
        method: 'POST',
      });
    },

    getUnits(): Promise<Unit[]> {
      return request<Unit[]>('/units');
    },

    getAuditEvents(query: AuditQuery): Promise<AuditPage> {
      const params = new URLSearchParams();
      for (const key of [
        'actor',
        'action',
        'entityType',
        'entityId',
        'from',
        'to',
        'beforeId',
        'limit',
      ] as const) {
        const value = query[key];
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const suffix = params.toString();
      return request<AuditPage>(`/audit-events${suffix ? '?' + suffix : ''}`);
    },

    async getDisplayToday() {
      // Only whitelisted fields reach the shared screen.
      return toDisplayToday(await request<unknown>('/display/today'));
    },

    getDemoUsers(): Promise<DemoUser[]> {
      return request<DemoUser[]>('/auth/demo-users');
    },

    mockLogin(userId: string): Promise<MockLoginResult> {
      return request<MockLoginResult>('/auth/mock-login', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
    },

    getRuleSets(): Promise<RuleSetVersion[]> {
      return request<RuleSetVersion[]>('/rule-sets');
    },

    createRuleSetDraft(basedOn: number, reason: string): Promise<RuleSetVersion> {
      return request<RuleSetVersion>('/rule-sets/drafts', {
        method: 'POST',
        body: JSON.stringify({ basedOn, reason }),
      });
    },

    getRuleTable(version: number, code: string): Promise<RuleTable> {
      return request<RuleTable>(`/rule-sets/${version}/tables/${code}`);
    },

    saveRuleRows(version: number, code: string, rows: RuleTableRow[]): Promise<RuleTable> {
      return request<RuleTable>(`/rule-sets/${version}/tables/${code}/rows`, {
        method: 'PUT',
        body: JSON.stringify({ rows }),
      });
    },

    buildRuleSet(version: number): Promise<BuildReport> {
      return request<BuildReport>(`/rule-sets/${version}/build`, { method: 'POST' });
    },

    submitRuleSet(version: number): Promise<RuleSetVersion> {
      return request<RuleSetVersion>(`/rule-sets/${version}/submit`, { method: 'POST' });
    },

    approveRuleSet(version: number): Promise<RuleSetVersion> {
      return request<RuleSetVersion>(`/rule-sets/${version}/approve`, { method: 'POST' });
    },

    publishRuleSet(version: number, effectiveDate: string): Promise<RuleSetVersion> {
      return request<RuleSetVersion>(`/rule-sets/${version}/publish`, {
        method: 'POST',
        body: JSON.stringify({ effectiveDate }),
      });
    },

    getCoverageReport(query: ReportQuery): Promise<CoverageReport> {
      return request<CoverageReport>(`/reports/coverage${queryString(query)}`);
    },

    getHoursReport(query: ReportQuery): Promise<HoursReport> {
      return request<HoursReport>(`/reports/hours${queryString(query)}`);
    },

    getOvertimeReport(query: ReportQuery): Promise<OvertimeReport> {
      return request<OvertimeReport>(`/reports/overtime${queryString(query)}`);
    },

    getOverrides(query: ReportQuery): Promise<OverrideRow[]> {
      return request<OverrideRow[]>(`/reports/overrides${queryString(query)}`);
    },

    exportReportCsv(
      report: 'coverage' | 'hours' | 'overtime' | 'overrides',
      query: ReportQuery,
    ): Promise<{ fileName: string; content: string }> {
      return requestCsv(`/reports/${report}${queryString(query)}`);
    },

    getPayPeriods(): Promise<PayPeriod[]> {
      return request<PayPeriod[]>('/pay-periods');
    },

    getTimeEntries(payPeriodId: string): Promise<TimeEntry[]> {
      return request<TimeEntry[]>(`/pay-periods/${payPeriodId}/time-entries`);
    },

    recordActual(entryId: string, input: RecordActualInput): Promise<RecordActualResult> {
      return request<RecordActualResult>(`/time-entries/${entryId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    clearActual(assignmentId: string): Promise<RecordActualResult> {
      return request<RecordActualResult>(`/time-entries/${assignmentId}`, { method: 'DELETE' });
    },

    lockPayPeriod(payPeriodId: string): Promise<PayPeriod> {
      return request<PayPeriod>(`/pay-periods/${payPeriodId}/lock`, { method: 'POST' });
    },

    unlockPayPeriod(payPeriodId: string, reason: string): Promise<PayPeriod> {
      return request<PayPeriod>(`/pay-periods/${payPeriodId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    },

    exportPayroll(payPeriodId: string): Promise<{ fileName: string; content: string }> {
      return requestCsv(`/pay-periods/${payPeriodId}/payroll-export`);
    },
  };
}
