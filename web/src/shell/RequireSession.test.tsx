import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

// The real-api build: a session is required, and the fixtures switch is not.
const ELLIS = {
  id: 'user-ellis',
  displayName: 'M. Ellis',
  username: 'm.ellis',
  roles: ['SUPERVISOR'],
  units: ['unit-a', 'unit-b'],
  employeeId: null,
};
// The picker's list; a test may swap in the eight demo users.
const listed = vi.hoisted(() => ({ users: [] as Record<string, unknown>[] }));
vi.mock('../api/client', async () => {
  const { ApiError } = await import('../api/http');
  return {
    usingFixtures: false,
    ApiError,
    api: {
      getDemoUsers: vi.fn(async () => (listed.users.length > 0 ? listed.users : [ELLIS])),
      mockLogin: vi.fn(async (id: string) => ({
        token: 'a-token',
        user: [...listed.users, ELLIS].find((entry) => entry.id === id),
      })),
    },
  };
});

const { LoginPage } = await import('../pages/LoginPage');
const { RoleProvider } = await import('./nav');
const { RequireSession } = await import('./RequireSession');
const { theme } = await import('../theme/theme');

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={[path]}>
          <RequireSession>
            <Routes>
              <Route path="/" element={<Navigate to="/planning" replace />} />
              <Route path="/planning" element={<h1>Planning board</h1>} />
              <Route path="/planner" element={<h1>Quarter plan</h1>} />
              <Route path="/me/schedule" element={<h1>My schedule</h1>} />
              <Route path="/rules" element={<h1>Rules</h1>} />
              <Route path="/rules/:version/:table" element={<h1>Rules</h1>} />
              <Route path="/display" element={<h1>Wall display</h1>} />
              <Route path="/reports/:tab" element={<h1>Reports</h1>} />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </RequireSession>
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

/**
 * D11: the token lives in memory, so a hard reload or a deep link arrives with
 * no session. The screens rendered and called the api with no token (401s and
 * page errors) instead of asking for a sign-in.
 */
describe('the session guard', () => {
  it('sends a visitor with no session to sign-in, and back to the route asked for', async () => {
    const user = userEvent.setup();
    renderAt('/reports/hours');

    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reports' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /M\. Ellis/ }));

    // The asked route, not the supervisor's landing page.
    expect(await screen.findByRole('heading', { name: 'Reports', level: 1 })).toBeInTheDocument();
  });

  it('keeps a signed-in visitor on the route', async () => {
    const { setSession } = await import('../api/session');
    setSession('a-token', {
      id: 'user-ellis',
      displayName: 'M. Ellis',
      username: 'm.ellis',
      roles: ['SUPERVISOR'],
      units: ['unit-a'],
      employeeId: null,
    } as never);

    renderAt('/planning');

    expect(await screen.findByRole('heading', { name: 'Planning board', level: 1 })).toBeInTheDocument();
  });

  it('sends a person who signed out to their own landing, not back to the route', async () => {
    // A sign-out on a protected route must not leave "from" behind: the next
    // person may be an employee who cannot open the supervisor's screen.
    const { act } = await import('@testing-library/react');
    const { setSession, signOut } = await import('../api/session');
    setSession('a-token', {
      id: 'user-ellis',
      displayName: 'M. Ellis',
      username: 'm.ellis',
      roles: ['SUPERVISOR'],
      units: ['unit-a'],
      employeeId: null,
    } as never);

    renderAt('/reports/hours');
    expect(await screen.findByRole('heading', { name: 'Reports', level: 1 })).toBeInTheDocument();

    act(() => signOut());

    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Please sign in to continue.')).not.toBeInTheDocument();
  });

  // Install verification, 26 Nov 2026: the bare address the installer printed
  // was remembered as the route asked for, so every user landed on the
  // Planning board and an officer, a rules user or the TV saw an error there.
  const DEMO = [
    { ...ELLIS, id: 'm-ellis', displayName: 'M. Ellis', roles: ['SUPERVISOR', 'EMPLOYEE'], employeeId: 'e-ellis' },
    { ...ELLIS, id: 'j-chen', displayName: 'J. Chen', roles: ['SUPERVISOR', 'EMPLOYEE'], employeeId: 'e-chen' },
    { ...ELLIS, id: 't-nakamura', displayName: 'T. Nakamura', roles: ['EMPLOYEE'], employeeId: 'e-tara' },
    { ...ELLIS, id: 'l-fraser', displayName: 'L. Fraser', roles: ['RULES_ADMIN'], employeeId: '' },
    { ...ELLIS, id: 'p-singh', displayName: 'P. Singh', roles: ['RULES_APPROVER'], employeeId: '' },
    { ...ELLIS, id: 'a-reviewer', displayName: 'A. Reviewer', roles: ['AUDITOR'], employeeId: '' },
    { ...ELLIS, id: 'p-planner', displayName: 'P. Planner', roles: ['PLANNER'], employeeId: '' },
    { ...ELLIS, id: 'unit-office-tv', displayName: 'Unit office TV', roles: ['DISPLAY'], employeeId: '' },
  ];
  it.each([
    ['M. Ellis', 'Planning board'],
    ['J. Chen', 'Planning board'],
    ['T. Nakamura', 'My schedule'],
    ['L. Fraser', 'Rules'],
    ['P. Singh', 'Rules'],
    ['A. Reviewer', 'Reports'],
    ['P. Planner', 'Quarter plan'],
    ['Unit office TV', 'Wall display'],
  ])('from the bare address, %s lands on their own home (%s)', async (name, heading) => {
    // A fresh visit: no session, and not a sign-out (which never remembers a route).
    const { resetSession } = await import('../api/session');
    resetSession();
    listed.users = DEMO;
    try {
      renderAt('/');
      expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument();
      // Nobody asked for a route, so no "Please sign in to continue."
      expect(screen.queryByText('Please sign in to continue.')).not.toBeInTheDocument();
      await userEvent.setup().click(await screen.findByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`) }));
      expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
    } finally {
      listed.users = [];
    }
  });
});
