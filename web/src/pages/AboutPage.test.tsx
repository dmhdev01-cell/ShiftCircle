import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

describe('About page', () => {
  it('shows the build information from /api/v1/version', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ buildVersion: '1.2.3', gitCommit: 'abc1234', ruleSetVersion: 7 }),
    );

    renderAbout();

    expect(await screen.findByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows a clear error instead of a blank when the api cannot be reached', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    renderAbout();

    expect(await screen.findByText(/Could not read the build information/)).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('shows the raw response when the api answers with an unexpected shape', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ somethingElse: true }));

    renderAbout();

    expect(await screen.findByText(/not with the fields this screen expects/)).toBeInTheDocument();
    expect(screen.getByText(/"somethingElse": true/)).toBeInTheDocument();
  });
});
