import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { sessionExpired } from '../api/session';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderLogin() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/login']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('the mock sign-in', () => {
  it('lists the demo users with their roles and scope', async () => {
    renderLogin();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/Mock sign-in · demo only/);

    await screen.findByRole('button', { name: /M. Ellis/ });
    const users = screen.getAllByRole('button');
    expect(users.length).toBe(7);
    expect(within(users[0]).getByText('M. Ellis')).toBeInTheDocument();
    expect(within(users[0]).getByText('Supervisor · Employee')).toBeInTheDocument();
    expect(within(users[0]).getByText('Units A, B')).toBeInTheDocument();
    expect(within(users[2]).getByText('T. Nakamura')).toBeInTheDocument();
    expect(within(users[2]).getByText('Employee')).toBeInTheDocument();
  });

  it('signs in and lands on the screen for the role', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: /T. Nakamura/ }));

    expect(await screen.findByRole('heading', { name: 'My schedule' })).toBeInTheDocument();
  });

  it('sends a supervisor to the planning board', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: /M. Ellis/ }));

    expect(await screen.findByRole('heading', { name: 'Planning board' })).toBeInTheDocument();
  });

  it('says mock sign-in is turned off when the endpoint is missing', async () => {
    vi.spyOn(api, 'getDemoUsers').mockRejectedValueOnce(new ApiError('Not found', 404));

    renderLogin();

    expect(
      await screen.findByText('Mock sign-in is turned off in this environment.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /M. Ellis/ })).not.toBeInTheDocument();
  });

  it('explains an ended session', async () => {
    sessionExpired();

    renderLogin();

    expect(await screen.findByText('Your session ended. Sign in again.')).toBeInTheDocument();
  });
});
