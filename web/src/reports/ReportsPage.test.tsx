import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderReports() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/reports/coverage']}>
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
    renderReports();

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

    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('16 – 22 Nov')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
  });
});
