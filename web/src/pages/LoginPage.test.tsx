import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { sessionExpired } from '../api/session';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';function renderLogin() {
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
    // Seven demo users plus the planner account the quarter plan needs.
    expect(users.length).toBe(8);
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

    // The destination page draws its heading while it loads and again when the
    // answers land, so this waits for the route rather than asserting a node.
    await screen.findByRole('heading', { name: 'My schedule' });
  });

  it('sends a supervisor to the planning board', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: /M. Ellis/ }));

    await screen.findByRole('heading', { name: 'Planning board' });
  });

  it('says mock sign-in is turned off when the endpoint is missing', async () => {
    vi.spyOn(api, 'getDemoUsers').mockRejectedValueOnce(new ApiError('Not found', 404));

    renderLogin();

    expect(
      await screen.findByText('Mock sign-in is turned off in this environment.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /M. Ellis/ })).not.toBeInTheDocument();
  });

  it('tries again on its own after a demo reset answers 409 (v1.2 walk D4)', async () => {
    vi.spyOn(api, 'getDemoUsers').mockRejectedValueOnce(
      new ApiError('The demo is reloading its seeded data. Try again in a moment.', 409),
    );

    renderLogin();

    expect(
      await screen.findByText('The demo is reloading its seeded data. Try again in a moment.'),
    ).toBeInTheDocument();
    // The first retry waits 1 s; no refresh is needed.
    expect(await screen.findByRole('button', { name: /M. Ellis/ }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('The demo is reloading its seeded data. Try again in a moment.')).not.toBeInTheDocument();
  });

  it('offers Retry when the demo users could not be loaded', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDemoUsers').mockRejectedValueOnce(new ApiError('Service unavailable', 503));

    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /M. Ellis/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('explains an ended session', async () => {
    sessionExpired();

    renderLogin();

    expect(await screen.findByText('Your session ended. Sign in again.')).toBeInTheDocument();
  });

  it('ignores a return path that would leave the app', async () => {
    // review-r2 NOTE 1: the route guard passes the asked-for path in router
    // state, and the sign-in screen must not navigate anywhere else.
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <RoleProvider>
          <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: 'https://evil.example' } }]}>
            <AppShellRoutes />
          </MemoryRouter>
        </RoleProvider>
      </ThemeProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /T\. Nakamura/ }));

    // The role's own landing page, not the hostile value. Wait for its content,
    // not for the heading: every screen draws the same h1 while it loads and
    // again when the answers land, and the node found first is replaced - the
    // intermittent failure this test had.
    expect(await screen.findByText(/Sam Abara|Tara Nakamura/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My schedule', level: 1 })).toBeInTheDocument();
  });
});
