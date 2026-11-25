import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from './nav';
import { theme } from '../theme/theme';

/** The api's /version answer, as the demo profile sends it. */
function versionBody(asOf: string) {
  return {
    name: 'shiftcircle-api',
    version: '0.1.0-SNAPSHOT',
    buildTime: '2026-11-20T12:59:41.573Z',
    gitCommit: '3a4bbbd',
    ruleSetVersion: 'v1',
    profiles: 'demo',
    asOf,
  };
}

function renderShell() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/planning']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('the top bar', () => {
  it('shows the demo day the api reports, not the day before', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const body = String(input).includes('/api/v1/version') ? versionBody('2026-11-19') : {};
        return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
      }),
    );

    renderShell();

    // D1: asOf is a calendar day ("2026-11-19"), not an instant. Parsing it as
    // UTC midnight and formatting it in Regina time (UTC-6) showed the 18th.
    expect(await screen.findByText(/Thu 19 Nov 2026 · /)).toBeInTheDocument();
    expect(screen.queryByText(/Wed 18 Nov 2026/)).not.toBeInTheDocument();
  });

  it("shows the business clock's time with the demo day, not the wall clock (v1.2 walk D3)", async () => {
    // The wall clock reads 19:34 in Regina; the business clock is noon.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T01:34:00Z'));
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const body = String(input).includes('/api/v1/version') ? versionBody('2026-11-19') : {};
          return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
        }),
      );

      renderShell();

      expect(await screen.findByText('Thu 19 Nov 2026 · 12:00')).toBeInTheDocument();
      expect(screen.queryByText(/19:34/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
