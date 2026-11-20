import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { createHttpApi } from '../api/http';
import { RoleProvider } from './nav';
import { theme } from '../theme/theme';

const DISCLAIMER = 'Not an official Government of Saskatchewan service · fictional, synthetic data only';

function renderShell(path = '/planning') {
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

describe('AppShell', () => {
  it('shows the required footer disclaimer on every screen', () => {
    const { unmount } = renderShell('/planning');
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    unmount();

    renderShell('/overtime');
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it('renders the supervisor navigation', () => {
    renderShell('/planning');
    const nav = screen.getByRole('navigation', { name: 'Main' });

    for (const label of [
      'Planning board',
      'Overtime',
      'Reports',
      'Rules',
      'Wall display',
      'Employee view',
      'Time & attendance',
      'Audit log',
      'About & version',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the current page in the navigation', () => {
    renderShell('/overtime');
    const nav = screen.getByRole('navigation', { name: 'Main' });

    expect(within(nav).getByRole('link', { name: 'Overtime' })).toHaveClass('active');
    expect(within(nav).getByRole('link', { name: 'Planning board' })).not.toHaveClass('active');
  });

  it('shows the app name, the facility line and the mock role chip in the top bar', () => {
    renderShell('/planning');
    const banner = screen.getByRole('banner');

    expect(within(banner).getByText('ShiftCircle')).toBeInTheDocument();
    expect(
      within(banner).getByText('Prairie Provincial Correctional Centre · prototype, fictional data'),
    ).toBeInTheDocument();
    expect(within(banner).getByText('Supervisor · M. Ellis')).toBeInTheDocument();
    expect(within(banner).getByText('(mock sign-in)')).toBeInTheDocument();
  });

  it('switches the navigation when the mock sign-in role changes', async () => {
    const user = userEvent.setup();
    renderShell('/planning');

    await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), 'EMPLOYEE');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My schedule' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Propose shifts' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Overtime' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
    // The switch acts as the demo employee in the api's user list.
    expect(screen.getByText('Employee · T. Nakamura')).toBeInTheDocument();
  });

  it('gives an auditor the read-only audit log', async () => {
    const user = userEvent.setup();
    renderShell('/planning');

    await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), 'AUDITOR');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Planning board' })).toBeInTheDocument();
  });

  it('links only built screens in every role nav', async () => {
    const user = userEvent.setup();
    renderShell('/planning');
    const placeholders = ['Propose shifts', 'My hours', 'Proposals inbox', 'Rule version review'];

    for (const role of ['SUPERVISOR', 'EMPLOYEE', 'RULES_ADMIN', 'RULES_APPROVER', 'AUDITOR']) {
      await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), role);
      const nav = screen.getByRole('navigation', { name: 'Main' });
      for (const label of placeholders) {
        expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument();
      }
    }
  });

  it('keeps a planned screen reachable by its route, with the not-built page', async () => {
    renderShell('/proposals');

    expect(await screen.findByRole('heading', { name: 'Proposals inbox' })).toBeInTheDocument();
    expect(screen.getByText('Not built yet')).toBeInTheDocument();
  });

  it('shows no role chip on the sign-in screen (build notes 2.1)', () => {
    renderShell('/login');

    expect(screen.queryByText('(mock sign-in)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mock sign-in: choose a role')).not.toBeInTheDocument();
  });

  it('signs out from the account menu and returns to the sign-in screen', async () => {
    const user = userEvent.setup();
    renderShell('/login');

    await user.click(await screen.findByRole('button', { name: /M. Ellis/ }));
    await screen.findByRole('heading', { name: 'Planning board' });

    // A signed-in person gets an account menu, not the demo switch.
    expect(screen.getByText('Supervisor · M. Ellis')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mock sign-in: choose a role')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Account menu for M. Ellis' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Your session ended. Sign in again.')).not.toBeInTheDocument();
  });

  it('sends an expired session to the sign-in screen when the api answers 401', async () => {
    const user = userEvent.setup();
    renderShell('/login');

    await user.click(await screen.findByRole('button', { name: /M. Ellis/ }));
    await screen.findByRole('heading', { name: 'Planning board' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ title: 'Unauthorized', status: 401 }),
      })),
    );

    await expect(createHttpApi().getSchedule({})).rejects.toThrow();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Your session ended. Sign in again.')).toBeInTheDocument(),
    );
  });

  it('does not use a government logo, wheat sheaf or coat of arms', () => {
    const { container } = renderShell('/planning');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/coat of arms|wheat sheaf/i);
  });
});
