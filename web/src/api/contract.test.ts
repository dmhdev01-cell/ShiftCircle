import { describe, expect, it, vi } from 'vitest';

import { createHttpApi } from './http';

/**
 * Payloads copied from the api, not from the fixtures
 * (AuthController's describe() and RuleCheckService.ResultView). These tests
 * fail if the web starts expecting a field the api does not send.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => jsonResponse(body, status));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the api contract the web parses', () => {
  it('reads a demo user in the shape AuthController sends', async () => {
    stubFetch([
      {
        id: '22222222-2222-2222-2222-000000000001',
        username: 'm.ellis',
        displayName: 'M. Ellis',
        roles: ['SUPERVISOR', 'EMPLOYEE'],
        units: ['A', 'B'],
        employeeId: '',
      },
    ]);

    const users = await createHttpApi().getDemoUsers();

    expect(users[0].username).toBe('m.ellis');
    expect(users[0].displayName).toBe('M. Ellis');
    expect(users[0].units).toEqual(['A', 'B']);
    expect(users[0].employeeId).toBe('');
  });

  it('reads a mock-login answer with the token and the same user shape', async () => {
    stubFetch({
      token: 'signed-token',
      expiresAt: '2026-11-20T12:00:00Z',
      user: {
        id: '22222222-2222-2222-2222-000000000005',
        username: 'p.singh',
        displayName: 'P. Singh',
        roles: ['RULES_APPROVER'],
        units: [],
        employeeId: '',
      },
    });

    const result = await createHttpApi().mockLogin('22222222-2222-2222-2222-000000000005');

    expect(result.token).toBe('signed-token');
    expect(result.user.displayName).toBe('P. Singh');
    expect(result.user.roles).toEqual(['RULES_APPROVER']);
  });

  it('reads rule results with ruleTable, overridePolicy and label-only evidence', async () => {
    stubFetch({
      outcome: 'BLOCK',
      ruleSetVersion: 1,
      overridable: true,
      ruleResults: [
        {
          ruleCode: 'U-01',
          ruleTable: 'REST',
          outcome: 'BLOCK',
          message: 'Only 7 hours of rest.',
          facts: { required: 8, actual: 7, unit: 'hours' },
          evidence: [{ label: 'Fri 20 P12 12:00–24:00' }],
          overridePolicy: 'EMERGENCY',
        },
      ],
    });

    const result = await createHttpApi().previewRuleCheck({
      change: {
        type: 'ASSIGN',
        employeeId: 'employee-id',
        unitId: 'unit-id',
        shiftTemplate: 'D8',
        startAt: '2026-11-21T07:00:00-06:00',
      },
    });

    expect(result.ruleResults[0].ruleTable).toBe('REST');
    expect(result.ruleResults[0].overridePolicy).toBe('EMERGENCY');
    expect(result.ruleResults[0].evidence?.[0]?.label).toBe('Fri 20 P12 12:00–24:00');
  });

  it('posts an EXTRA change to /assignments, and never a move or cancel', async () => {
    const fetchMock = stubFetch({ assignmentId: 'assignment-id', ruleOutcome: null }, 201);

    await createHttpApi().saveChange({
      change: {
        type: 'EXTRA',
        employeeId: 'employee-id',
        unitId: 'unit-id',
        shiftTemplate: 'E8',
        startAt: '2026-11-21T15:00:00-06:00',
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/assignments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).change.type).toBe('EXTRA');
  });

  it('posts one planned absence to /planner/absences in the shape PlannerController reads', async () => {
    // PlannerService.absenceBody: id, employeeId, date, type (201 new, 200 already recorded).
    const fetchMock = stubFetch(
      { id: 'absence-id', employeeId: 'employee-id', date: '2027-02-08', type: 'VACATION' },
      201,
    );

    const saved = await createHttpApi().planAbsence({
      employeeId: 'employee-id',
      date: '2027-02-08',
      type: 'VACATION',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/planner/absences');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      employeeId: 'employee-id',
      date: '2027-02-08',
      type: 'VACATION',
    });
    expect(saved.id).toBe('absence-id');
  });

  it('reads planned leave on the draft roster as ABSENCE items (PlannerViews.LeaveItem)', async () => {
    // A leave-only row and a shift + sick day, as PlannerService.schedule sends them.
    stubFetch({
      unit: { id: 'unit-b', name: 'Unit B', closedFrom: null, closedTo: null, closedLabel: null, closedReason: null, closedDates: [] },
      from: '2027-02-08',
      to: '2027-02-09',
      days: ['2027-02-08', '2027-02-09'],
      asOf: '2026-11-19',
      coverage: [],
      officers: [
        {
          employeeId: 'away',
          name: 'Away Officer',
          rotation: 'On leave',
          qualifications: [],
          payPeriodHours: 0,
          payPeriodThreshold: 80,
          overtimeStatus: 'UNDER',
          cells: [
            { date: '2027-02-08', items: [{ type: 'ABSENCE', absenceType: 'VACATION' }] },
            { date: '2027-02-09', items: [{ type: 'ABSENCE', absenceType: 'VACATION' }] },
          ],
        },
      ],
      warningCount: 0,
      blockCount: 0,
      publishedState: { published: false, unpublishedChanges: null },
      period: null,
    });

    const payload = await createHttpApi().getPlannerSchedule('draft-id', {
      unitId: 'unit-b',
      from: '2027-02-08',
      to: '2027-02-09',
    });

    const item = payload.officers[0].cells[0].items[0];
    expect(item.type).toBe('ABSENCE');
    expect(item.type === 'ABSENCE' ? item.absenceType : null).toBe('VACATION');
  });
});
