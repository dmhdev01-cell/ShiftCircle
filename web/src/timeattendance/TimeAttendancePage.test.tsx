import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderScreen() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/time']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('Time and attendance', () => {
  it('shows the period, the tiles and the shifts with no actual', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Time & attendance' })).toBeInTheDocument();
    // The pay-period select appears once the periods have loaded.
    expect(await screen.findByLabelText('Pay period')).toBeInTheDocument();
    // A grid row appears once the time entries have loaded.
    expect(await screen.findByText('Tara Nakamura')).toBeInTheDocument();
    expect(await screen.findByText('Scheduled h')).toBeInTheDocument();
    expect(screen.getByText('Worked h')).toBeInTheDocument();
    expect(screen.getByText('Overtime h')).toBeInTheDocument();
    expect(screen.getByText('Shifts needing actuals')).toBeInTheDocument();
    expect(screen.getByText('Short extensions')).toBeInTheDocument();

    // The shifts with no actual are named, not just counted.
    expect(screen.getByText('3 shifts with no actual recorded')).toBeInTheDocument();
  });

  it('takes a missing-actual line to its cell and opens the actual panel', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    await user.click(
      screen.getByRole('button', { name: /Marc Desjardins · 2026-11-16 07:00/ }),
    );

    expect(await screen.findByRole('heading', { name: /Record actual/ })).toBeInTheDocument();
  });

  it('will not lock the period while a shift has no actual', async () => {
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const lock = screen.getByRole('button', { name: 'Lock pay period' });
    expect(lock).toBeDisabled();
    expect(screen.getByText('Record 3 missing actuals first')).toBeInTheDocument();
  });

  it('records an actual and shows the recalculated pay codes', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const cell = await screen.findAllByRole('button', { name: /needs actual/ });
    await user.click(cell[0]);

    const panel = await screen.findByRole('heading', { name: /Record actual/ });
    expect(panel).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Worked as scheduled' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Now 82.5 h/)).toBeInTheDocument();
  });

  it('records an absence', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const cells = await screen.findAllByRole('button', { name: /needs actual/ });
    await user.click(cells[0]);
    await user.click(screen.getByRole('radio', { name: 'Absent' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/The actual is recorded/)).toBeInTheDocument();
  });

  it('shows a locked period as read-only with the payroll export', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    await user.selectOptions(screen.getByLabelText('Pay period'), 'period-2026-10-26');

    expect(await screen.findByText(/Locked · M. Ellis/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payroll export (CSV)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument();
    expect(screen.getByText(/Last export 9 Nov 08:14/)).toBeInTheDocument();
    expect(screen.getByText(/the actuals are read-only/)).toBeInTheDocument();
    // A read-only grid still has to be reachable for keyboard scrolling.
    expect(
      await screen.findByRole('region', { name: 'Time entries, scrolls sideways' }),
    ).toHaveAttribute('tabindex', '0');
  });

  it('asks for a reason before unlocking', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    await user.selectOptions(screen.getByLabelText('Pay period'), 'period-2026-10-26');

    await user.click(await screen.findByRole('button', { name: 'Unlock…' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Unlocking recalculates pay codes/)).toBeInTheDocument();

    const unlock = within(dialog).getByRole('button', { name: 'Unlock' });
    expect(unlock).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Why is this period being unlocked?'), 'Short');
    expect(unlock).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText('Why is this period being unlocked?'),
      ' reason enough',
    );
    expect(unlock).toBeEnabled();

    await user.click(unlock);
    expect(await screen.findByText(/The pay period is unlocked/)).toBeInTheDocument();
  });

  it('filters the grid by unit', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');

    expect(screen.getByText('Sam Abara')).toBeInTheDocument();
    expect(screen.getByText('Devon Clarke')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Unit'), 'control');

    expect(screen.getByText('Devon Clarke')).toBeInTheDocument();
    expect(screen.queryByText('Sam Abara')).not.toBeInTheDocument();
  });
});
