import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

// The real-api build: a session is required, and the fixtures switch is not.
vi.mock('../api/client', async () => {
  const { ApiError } = await import('../api/http');
  const user = {
    id: 'user-ellis',
    displayName: 'M. Ellis',
    username: 'm.ellis',
    roles: ['SUPERVISOR'],
    units: ['unit-a', 'unit-b'],
    employeeId: null,
  };
  return {
    usingFixtures: false,
    ApiError,
    api: {
      getDemoUsers: vi.fn(async () => [user]),
      mockLogin: vi.fn(async () => ({ token: 'a-token', user })),
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
              <Route path="/planning" element={<h1>Planning board</h1>} />
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
});
