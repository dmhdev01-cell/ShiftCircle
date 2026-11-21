import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderAbout() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/about']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

/** The /version answer as the demo profile sends it, with demoMode. */
function stubVersion(demoMode: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/api/v1/version')
        ? { name: 'shiftcircle-api', version: '0.1.0', demoMode, asOf: '2026-11-19' }
        : {};
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
    }),
  );
}

describe('the demo reset', () => {
  it('is offered to the planner on the demo profile, behind the word RESET', async () => {
    stubVersion(true);
    const user = userEvent.setup();
    renderAbout();
    await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');

    expect(await screen.findByRole('heading', { name: 'Reset the demo data' })).toBeInTheDocument();
    expect(screen.getByText(/about 20 seconds/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Reset demo data' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Type RESET to confirm'), 'RESE');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Type RESET to confirm'), 'T');
    expect(button).toBeEnabled();

    vi.spyOn(api, 'resetDemo').mockResolvedValue({
      state: 'DONE',
      step: 'done',
      startedAt: '2026-11-21T10:00:00-06:00',
      elapsedMs: 19800,
      checksum: '3390148255db715844c4df90f553ae342530417621539b23499f638c5b126539',
      dataset: '100',
      error: null,
    });
    vi.spyOn(api, 'getDemoResetStatus').mockResolvedValue({
      state: 'DONE',
      step: 'done',
      startedAt: '2026-11-21T10:00:00-06:00',
      elapsedMs: 19800,
      checksum: '3390148255db715844c4df90f553ae342530417621539b23499f638c5b126539',
      dataset: '100',
      error: null,
    });

    await user.click(button);

    expect(await screen.findByText(/The demo data was rebuilt in 20 s/)).toBeInTheDocument();
    expect(screen.getByText(/3390148255db7158/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('is not offered when the profile is not the demo or the role is not the planner', async () => {
    stubVersion(false);
    renderAbout();
    expect(await screen.findByText('Application')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reset the demo data' })).not.toBeInTheDocument();
  });
});
