import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { demoUsers } from '../api/fixtures/demoUsers';
import { setActingUser } from '../api/session';
import type { Unit } from '../api/types';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderReports(path = '/reports/coverage') {
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

describe('Reports', () => {
  it('shows the coverage chart with its summary and the figures', async () => {
    renderReports();

    // The heading is drawn while the charts load; the chart below is the wait.
    await screen.findByRole('heading', { name: 'Reports' });

    const chart = await screen.findByRole('img', { name: /Weekly coverage/ });
    expect(chart).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Actual ranges from 97.4% to 99.2%'),
    );

    // Of which extra shifts: the column, with the per-block detail on its title.
    const extraCell = screen.getByText('0.6% · 24.5 h');
    expect(extraCell).toBeInTheDocument();
    expect(extraCell.getAttribute('title')).toBe('Days 8.0 h · Evenings 8.0 h · Nights 8.5 h');

    // The axis starts at 94% and says so.
    expect(screen.getByText(/The axis starts at 94%/)).toBeInTheDocument();

    // The figures are in a table as well, so the chart is not the only way in.
    const table = screen.getByRole('table');
    expect(within(table).getByText('16 – 22 Nov')).toBeInTheDocument();
    expect(within(table).getByText('101.2%')).toBeInTheDocument();
    expect(within(table).getByText('99.2%')).toBeInTheDocument();
    expect(within(table).getByText('Planned only')).toBeInTheDocument();
  });

  it('shows the overtime by officer with the facility average', async () => {
    const user = userEvent.setup();
    renderReports();

    // The coverage tab no longer carries the overtime bars (observation 31);
    // the Overtime tab still does.
    await screen.findByRole('heading', { name: 'Reports' });
    expect(screen.queryByRole('heading', { name: /Overtime this quarter/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Overtime' }));
    expect(await screen.findByRole('heading', { name: /Overtime this quarter/ })).toBeInTheDocument();
    expect(screen.getByText(/Facility average: 12.4 h per officer/)).toBeInTheDocument();
    expect(screen.getByText('34.5 h')).toBeInTheDocument();
  });

  it('shows the hours by officer for the locked period', async () => {
    const user = userEvent.setup();
    renderReports();

    await screen.findByRole('heading', { name: 'Reports' });
    await user.click(screen.getByRole('button', { name: 'Hours' }));

    expect(await screen.findByRole('heading', { name: /Hours by officer/ })).toBeInTheDocument();
    expect(await screen.findByText('Locked')).toBeInTheDocument();
    expect(screen.getByText(/by M. Ellis on 9 Nov/)).toBeInTheDocument();

    // The 2x band is off by default, so the column is hidden.
    expect(screen.queryByRole('columnheader', { name: 'OT 2×' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'OT 1.5×' })).toBeInTheDocument();
  });

  it('lists the emergency overrides with their reasons', async () => {
    const user = userEvent.setup();
    renderReports();

    await screen.findByRole('heading', { name: 'Reports' });
    await user.click(screen.getByRole('button', { name: 'Overrides' }));

    expect(await screen.findByRole('heading', { name: 'Emergency overrides' })).toBeInTheDocument();
    expect(await screen.findByText('Lockdown, relief unavailable')).toBeInTheDocument();
    expect(screen.getByText('U-05')).toBeInTheDocument();
  });

  it('exports the report as CSV', async () => {
    const user = userEvent.setup();
    renderReports();

    await screen.findByRole('heading', { name: 'Reports' });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText(/The export coverage-by-week.csv is downloaded/)).toBeInTheDocument();
  });
});

describe('the coverage report against the real api shape', () => {
  it('reads a planned week with a null actual percentage', async () => {
    // The api sends null for a week that has not happened yet. The fixtures
    // leave the field out, so only the api's shape catches this.
    vi.spyOn(api, 'getCoverageReport').mockResolvedValue({
      weeks: [
        { label: '9 – 15 Nov', scheduledPercent: 98.6, actualPercent: 97.4, planned: false },
        { label: '16 – 22 Nov', scheduledPercent: 101.2, actualPercent: null, planned: true },
      ],
      axisFrom: 94,
      axisTo: 102,
      requiredHours: 3904,
      scheduledHours: 3908,
    });

    renderReports();

    await screen.findByRole('heading', { name: 'Reports' });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('16 – 22 Nov')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('lets a keyboard user reach the report table that scrolls sideways', async () => {
    // D10: the Hours report is wider than a tablet screen and the scroll had no
    // keyboard access (axe scrollable-region-focusable, serious).
    renderReports('/reports/hours');

    const region = await screen.findByRole('region', { name: 'Hours by officer' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('says so when there are no emergency overrides', async () => {
    // D2: an empty Overrides report showed an empty table and no sentence.
    vi.spyOn(api, 'getOverrides').mockResolvedValue([]);

    renderReports('/reports/overrides');

    expect(await screen.findByRole('heading', { name: 'Emergency overrides' })).toBeInTheDocument();
    expect(await screen.findByText(/no emergency overrides/i)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument();
  });

  it('says so when the reports cannot be loaded, and tries again', async () => {
    // D4: a failed load left an empty screen with no message and no way back.
    const failed = () => Promise.reject(new TypeError('Failed to fetch'));
    const coverage = vi.spyOn(api, 'getCoverageReport').mockImplementation(failed);
    const hours = vi.spyOn(api, 'getHoursReport').mockImplementation(failed);
    const overtime = vi.spyOn(api, 'getOvertimeReport').mockImplementation(failed);
    const overrides = vi.spyOn(api, 'getOverrides').mockImplementation(failed);

    const user = userEvent.setup();
    renderReports();

    expect(await screen.findByText(/could not load the reports/i)).toBeInTheDocument();
    // The browser's raw words never reach the screen.
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();

    for (const spy of [coverage, hours, overtime, overrides]) spy.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('img', { name: /Weekly coverage/ })).toBeInTheDocument();
  });

  it('opens the report the address names, and keeps the address in step', async () => {
    const user = userEvent.setup();
    // D3: the route is /reports/:tab, but the page always opened on Coverage.
    renderReports('/reports/hours');

    await screen.findByRole('heading', { name: 'Reports' });
    const group = screen.getByRole('group', { name: 'Report' });
    expect(within(group).getByRole('button', { name: 'Hours' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('heading', { name: /Hours by officer/ })).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'Coverage' }));
    expect(within(group).getByRole('button', { name: 'Coverage' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('the report range and unit (FR-60/61/62)', () => {
  const unit = (code: string): Unit => ({
    id: `unit-${code}`,
    code,
    name: `Unit ${code}`,
    kind: 'LIVING',
    allows_12h: true,
    allows_16h: false,
  });

  function withDemoToday() {
    // The version endpoint carries the demo "today" the defaults count from.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ name: 'shiftcircle-api', asOf: '2026-11-19' }),
      })),
    );
  }

  function signInAs(name: string) {
    setActingUser(demoUsers.find((user) => user.displayName === name) ?? null);
  }

  it("shows each report's default range in the inputs and asks for it as before", async () => {
    withDemoToday();
    const coverage = vi.spyOn(api, 'getCoverageReport');
    const user = userEvent.setup();
    renderReports();

    const from = await screen.findByLabelText('From');
    const to = screen.getByLabelText('To');
    await waitFor(() => expect(from).toHaveValue('2026-10-12'));
    expect(to).toHaveValue('2026-11-29');
    expect(screen.getByText(/Each report covers its own default range/)).toBeInTheDocument();
    // No range is sent until the person picks one: the demo numbers stay put.
    expect(coverage).toHaveBeenCalledWith({ from: undefined, to: undefined, unitId: undefined });

    // The Hours tab shows its own default: the last locked pay period.
    await user.click(screen.getByRole('button', { name: 'Hours' }));
    await waitFor(() => expect(from).toHaveValue('2026-10-26'));
    expect(to).toHaveValue('2026-11-08');
    await user.click(screen.getByRole('button', { name: 'Overtime' }));
    expect(from).toHaveValue('2026-10-01');
    expect(to).toHaveValue('2026-11-19');
    coverage.mockRestore();
  });

  it('reads every report and the CSV for the chosen range and unit', async () => {
    withDemoToday();
    signInAs('M. Ellis');
    vi.spyOn(api, 'getUnits').mockResolvedValue([unit('A'), unit('B'), unit('C')]);
    const coverage = vi.spyOn(api, 'getCoverageReport');
    const hours = vi.spyOn(api, 'getHoursReport');
    const overtime = vi.spyOn(api, 'getOvertimeReport');
    const overrides = vi.spyOn(api, 'getOverrides');
    const exportCsv = vi.spyOn(api, 'exportReportCsv');
    const user = userEvent.setup();
    renderReports('/reports/overtime');

    // The unit picker offers only the units in M. Ellis's scope (A and B).
    const unitPicker = await screen.findByLabelText('Unit');
    await waitFor(() =>
      expect(within(unitPicker).getAllByRole('option').map((option) => option.textContent)).toEqual([
        'All my units',
        'Unit A',
        'Unit B',
      ]),
    );

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.clear(from);
    await user.type(from, '2026-11-01');
    await user.clear(to);
    await user.type(to, '2026-11-14');
    await user.selectOptions(unitPicker, 'unit-B');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    const wanted = { from: '2026-11-01', to: '2026-11-14', unitId: 'unit-B' };
    await waitFor(() => expect(coverage).toHaveBeenLastCalledWith(wanted));
    expect(hours).toHaveBeenLastCalledWith(wanted);
    expect(overtime).toHaveBeenLastCalledWith(wanted);
    expect(overrides).toHaveBeenLastCalledWith(wanted);
    expect(screen.getByText(/Every report covers 1 Nov 2026 – 14 Nov 2026 · Unit B/)).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Overtime 1 Nov 2026 – 14 Nov 2026' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(exportCsv).toHaveBeenLastCalledWith('overtime', wanted));

    // The chosen range holds on another tab, and Reset goes back to the defaults.
    await user.click(screen.getByRole('button', { name: 'Hours' }));
    expect(
      await screen.findByRole('heading', { name: 'Hours by officer · 1 Nov 2026 – 14 Nov 2026' }),
    ).toBeInTheDocument();
    expect(from).toHaveValue('2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(hours).toHaveBeenLastCalledWith({ from: undefined, to: undefined, unitId: undefined }),
    );
    await waitFor(() => expect(from).toHaveValue('2026-10-26'));
    expect(await screen.findByRole('heading', { name: /Hours by officer · pay period/ })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('refuses a reversed or too long range with a clear message and asks for nothing', async () => {
    withDemoToday();
    const coverage = vi.spyOn(api, 'getCoverageReport');
    const user = userEvent.setup();
    renderReports();

    const from = await screen.findByLabelText('From');
    const to = screen.getByLabelText('To');
    await waitFor(() => expect(from).toHaveValue('2026-10-12'));
    const callsBefore = coverage.mock.calls.length;

    await user.clear(from);
    await user.type(from, '2026-12-01');
    await user.clear(to);
    await user.type(to, '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The To date must be on or after the From date.',
    );
    expect(from).toHaveAttribute('aria-invalid', 'true');

    await user.clear(from);
    await user.type(from, '2025-01-01');
    await user.clear(to);
    await user.type(to, '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The range can be at most 366 days. Choose a shorter range.',
    );

    await user.clear(to);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose both a From and a To date.');
    expect(coverage.mock.calls.length).toBe(callsBefore);
    coverage.mockRestore();
  });

  it('has no unit picker for an account with no unit scope', async () => {
    signInAs('T. Nakamura');
    renderReports();
    await screen.findByLabelText('From');
    expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
  });
});
