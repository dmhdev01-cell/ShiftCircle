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

/** The shape the api's VersionResponse actually sends. */
const apiVersionBody = {
  name: 'shiftcircle-api',
  version: '0.1.0',
  buildTime: '2026-11-20T03:04:11Z',
  gitCommit: '502c434',
  ruleSetVersion: '7',
  profiles: 'demo',
};

describe('About page', () => {
  it('shows the build information the api sends', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(apiVersionBody));

    renderAbout();

    expect(await screen.findByText('shiftcircle-api')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('2026-11-20T03:04:11Z')).toBeInTheDocument();
    expect(screen.getByText('502c434')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
  });

  it('labels each build fact', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(apiVersionBody));

    renderAbout();

    expect(await screen.findByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Build version')).toBeInTheDocument();
    expect(screen.getByText('Built')).toBeInTheDocument();
    expect(screen.getByText('Git commit')).toBeInTheDocument();
    expect(screen.getByText('Live rule set')).toBeInTheDocument();
    expect(screen.getByText('Profiles')).toBeInTheDocument();
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
