import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { api } from './client';
import auditEvents from './contract-samples/audit-events.json';
import displayToday from './contract-samples/display-today.json';
import meOffers from './contract-samples/me-offers.json';
import meSchedule from './contract-samples/me-schedule.json';
import openShiftCandidates from './contract-samples/open-shift-candidates.json';
import openShifts from './contract-samples/open-shifts.json';
import payPeriods from './contract-samples/pay-periods.json';
import reportsCoverage from './contract-samples/reports-coverage.json';
import reportsHours from './contract-samples/reports-hours.json';
import reportsOvertime from './contract-samples/reports-overtime.json';
import reportsOverrides from './contract-samples/reports-overrides.json';
import ruleSets from './contract-samples/rule-sets.json';
import schedule from './contract-samples/schedule.json';
import timeEntries from './contract-samples/time-entries.json';
import units from './contract-samples/units.json';
import version from './contract-samples/version.json';

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
  vi.spyOn(api, 'getSchedule').mockResolvedValue(schedule as never);
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

  it('shows the reports', async () => {
    mockTheApi();
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
