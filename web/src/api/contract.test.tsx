import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { api } from './client';
import { demoSchedule } from './fixtures/schedule';
import auditEvents from './contract-samples/audit-events.json';
import displayToday from './contract-samples/display-today.json';
import meOffers from './contract-samples/me-offers.json';
import meSchedule from './contract-samples/me-schedule.json';
import openShiftCandidates from './contract-samples/open-shift-candidates.json';
import openShifts from './contract-samples/open-shifts.json';
import payPeriods from './contract-samples/pay-periods.json';
import reportsCoverage from './contract-samples/reports-coverage.json';
import reportsCoverageAuditor from './contract-samples/reports-coverage-auditor.json';
import reportsHours from './contract-samples/reports-hours.json';
import reportsOvertime from './contract-samples/reports-overtime.json';
import reportsOverrides from './contract-samples/reports-overrides.json';
import ruleSets from './contract-samples/rule-sets.json';
import scheduleAuditor from './contract-samples/schedule-auditor.json';
import scheduleDraft from './contract-samples/schedule-draft.json';
import schedulePublished from './contract-samples/schedule-published.json';
import timeEntries from './contract-samples/time-entries.json';
import units from './contract-samples/units.json';
import version from './contract-samples/version.json';
import plannerInputs from './contract-samples/planner-inputs.json';
import plannerStaffing from './contract-samples/planner-staffing.json';
import { PlanInputsCard } from '../planner/PlanInputsCard';
import { StaffingPanel } from '../planner/StaffingPanel';
import { staffingTile } from '../planner/staffingWords';
import { fixtureStaffing } from './fixtures/plannerUnits';
import { PLAN_INPUTS_120 } from './fixtures/planInputs';
import type { PlanInputs, StaffingReport } from './types';

/**
 * The screens against the api's own answers.
 *
 * The samples in contract-samples are the responses a running stack gave
 * (scripts/capture-contract-samples.sh). The fixtures and the api drift: the
 * api sends null for a field the fixtures leave out, and a screen that
 * assumes otherwise leaves a blank page. Every screen is rendered from the
 * real shape here, so a null cannot crash one again.
 */
function renderScreen(path: string) {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

function mockTheApi() {
  // The version is the one call the screens make outside the client.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(version), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  vi.spyOn(api, 'getUnits').mockResolvedValue(units as never);
  vi.spyOn(api, 'getSchedule').mockResolvedValue(scheduleDraft as never);
  vi.spyOn(api, 'getCoverageReport').mockResolvedValue(reportsCoverage as never);
  vi.spyOn(api, 'getHoursReport').mockResolvedValue(reportsHours as never);
  vi.spyOn(api, 'getOvertimeReport').mockResolvedValue(reportsOvertime as never);
  vi.spyOn(api, 'getOverrides').mockResolvedValue(reportsOverrides as never);
  vi.spyOn(api, 'getAuditEvents').mockResolvedValue({
    items: auditEvents.items as never,
    nextBeforeId: null,
  });
  vi.spyOn(api, 'getOpenShifts').mockResolvedValue(openShifts as never);
  vi.spyOn(api, 'getOpenShiftCandidates').mockResolvedValue(openShiftCandidates as never);
  vi.spyOn(api, 'getMySchedule').mockResolvedValue(meSchedule as never);
  vi.spyOn(api, 'getMyOffers').mockResolvedValue(meOffers as never);
  vi.spyOn(api, 'getDisplayToday').mockResolvedValue(displayToday as never);
  vi.spyOn(api, 'getRuleSets').mockResolvedValue(ruleSets as never);
  vi.spyOn(api, 'getPayPeriods').mockResolvedValue(payPeriods as never);
  vi.spyOn(api, 'getTimeEntries').mockResolvedValue(timeEntries as never);
}

/** The screen came up: its heading is there and the boundary did not fire. */
async function expectScreen(path: string, heading: string) {
  renderScreen(path);
  await waitFor(() => expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument());
  // Let the screen finish the renders that carry the api's data: a null in one
  // of them throws, and the boundary says so.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByText('This screen could not be shown')).not.toBeInTheDocument();
}

describe('the screens against the real api shapes', () => {
  it('shows the planning board', async () => {
    mockTheApi();
    await expectScreen('/planning', 'Planning board');
  });

  it('shows the reports, with the coverage report an auditor sees', async () => {
    mockTheApi();
    vi.spyOn(api, 'getCoverageReport').mockResolvedValue(reportsCoverageAuditor as never);
    await expectScreen('/reports/coverage', 'Reports');
  });

  it('shows the overtime board', async () => {
    mockTheApi();
    await expectScreen('/overtime', 'Overtime board');
  });

  it('shows the audit log', async () => {
    mockTheApi();
    await expectScreen('/audit', 'Audit log');
  });

  it('shows my schedule', async () => {
    mockTheApi();
    await expectScreen('/me/schedule', 'My schedule');
  });

  it('shows time and attendance', async () => {
    mockTheApi();
    await expectScreen('/time', 'Time & attendance');
  });

  it('shows the rules screen', async () => {
    mockTheApi();
    await expectScreen('/rules', 'Rules');
  });

  it('shows the wall display', async () => {
    mockTheApi();
    await expectScreen('/display', "Today's coverage");
  });
});

describe('the board against the real api shapes', () => {
  it('offers the publish action on a draft week', async () => {
    mockTheApi();
    vi.spyOn(api, 'getSchedule').mockResolvedValue(scheduleDraft as never);

    renderScreen('/planning');
    await screen.findByText('Coverage gaps');

    expect(screen.getByText('Not published')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish period' })).toBeEnabled();
  });

  it('closes the publish action on a published week', async () => {
    mockTheApi();
    vi.spyOn(api, 'getSchedule').mockResolvedValue(schedulePublished as never);

    renderScreen('/planning');
    await screen.findByText('Coverage gaps');

    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish period' })).toBeDisabled();
  });

  it('shows the auditor the same board', async () => {
    mockTheApi();
    vi.spyOn(api, 'getSchedule').mockResolvedValue(scheduleAuditor as never);

    renderScreen('/planning');
    await screen.findByText('Coverage gaps');

    expect(screen.queryByText('This screen could not be shown')).not.toBeInTheDocument();
  });

});

describe('the fixture period against the api', () => {
  it('has the same keys and types as the api sends', () => {
    const fixture = demoSchedule.period;
    const sample = schedulePublished.period;

    expect(fixture, 'the fixture has a period').not.toBeNull();
    expect(sample, 'the api sent a period').not.toBeNull();
    expect(Object.keys(fixture!).sort()).toEqual(Object.keys(sample!).sort());
    expect(typeof fixture!.id).toBe(typeof sample!.id);
    expect(typeof fixture!.label).toBe(typeof sample!.label);
    expect(typeof fixture!.status).toBe(typeof sample!.status);
  });

  it('names the roster week the way the api does', () => {
    expect(demoSchedule.period?.label).toBe('16 – 22 Nov 2026');
    expect(demoSchedule.period?.status).toBe('DRAFT');
  });
});

describe('plan inputs against the api (PR-M)', () => {
  it('renders the inputs the api sent, headline and detail', async () => {
    const sample = plannerInputs as unknown as PlanInputs;
    render(
      <ThemeProvider theme={theme}>
        <PlanInputsCard inputs={sample} fromDraft={false} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('plan-inputs-headline').textContent).toContain(
      `Planning ${sample.officers.total} officers`,
    );
    act(() => screen.getByRole('button', { name: 'Show plan inputs' }).click());
    expect(await screen.findByRole('region', { name: 'Plan inputs detail' })).toBeInTheDocument();
    expect(screen.queryByText('This screen could not be shown')).not.toBeInTheDocument();
  });

  it('keeps the fixture in the api shape', () => {
    const sample = plannerInputs as unknown as Record<string, unknown>;
    const fixture = PLAN_INPUTS_120 as unknown as Record<string, unknown>;
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(sample).sort());
    for (const key of Object.keys(sample)) {
      const value = sample[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        expect(Object.keys(fixture[key] as object).sort(), key).toEqual(Object.keys(value).sort());
      }
    }
  });
});

describe('staffing against the api (v1.2 walk D1)', () => {
  // GET /planner/staffing on Dataset 120, captured by the v1.2 release walk
  // (24 Nov 2026) during demo script §7 step 10, with Unit C closed from
  // 15 Feb 2027 (reopening 29 Mar 2027 set later), so it has three periods;
  // a fresh Dataset 120 without the closure answers one period with the same
  // first-period figures. The capture script's planner-staffing line saves the
  // current dataset's answer instead. Four units are short by 7 in all
  // (Admissions 1, Unit B 1, Unit C 2, Escort & transport 3). The api names
  // the figure "shortfall"; the screen read "short" and showed 0 everywhere.
  const sample = plannerStaffing as unknown as StaffingReport;

  it('says the tile is short when the api says a unit is short', () => {
    const tile = staffingTile(sample);
    expect(tile.value).toBe('127');
    expect(tile.note).toBe('120 on staff · short 7 · from 29 Mar 2027: at least 127');
    expect(tile.pill).toEqual({ tone: 'warn', text: 'Short' });
  });

  it('shows each short unit and the total in the panel', () => {
    render(
      <ThemeProvider theme={theme}>
        <StaffingPanel report={sample} draftGaps={null} onChanged={() => undefined} />
      </ThemeProvider>,
    );
    expect(
      screen.getByText(
        'Do we need more staff? Yes, at least 7 more: Admissions (1), Unit B (1), Unit C (2), Escort & transport (3).',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Every unit meets the floor/)).not.toBeInTheDocument();
  });

  it('keeps the fixture rows and totals in the api shape', () => {
    const fixture = fixtureStaffing();
    const apiPeriod = sample.periods[0] as unknown as Record<string, Record<string, unknown>>;
    const fixturePeriod = fixture.periods[0] as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(fixturePeriod.totals).sort()).toEqual(Object.keys(apiPeriod.totals).sort());
    const apiRow = (apiPeriod.units as unknown as Record<string, unknown>[])[0];
    const fixtureRow = (fixturePeriod.units as unknown as Record<string, unknown>[])[0];
    expect(Object.keys(fixtureRow).sort()).toEqual(Object.keys(apiRow).sort());
  });
});
