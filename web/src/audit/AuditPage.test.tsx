import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderAudit() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/audit']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

async function auditRows() {
  const table = await screen.findByRole('table', { name: 'Audit events' });
  return within(table).getAllByRole('row').slice(1);
}

describe('the audit log', () => {
  it('lists the events newest first with the actor, action, entity and summary', async () => {
    renderAudit();

    expect(await screen.findByRole('heading', { name: 'Audit log', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Demo fixtures')).toBeInTheDocument();

    const rows = await auditRows();
    expect(rows.length).toBe(20);
    expect(within(rows[0]).getByText(/04 Nov 2026 · 13:05/)).toBeInTheDocument();
    expect(within(rows[0]).getByText('M. Ellis')).toBeInTheDocument();
    expect(within(rows[0]).getByText('m.ellis')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Rule override')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Reason: Lockdown, relief unavailable/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/U-05/)).toBeInTheDocument();
    expect(
      screen.getByText('Who did what, newest first. Read-only: the audit table refuses edits and deletes.'),
    ).toBeInTheDocument();
  });

  it('filters by actor', async () => {
    const user = userEvent.setup();
    renderAudit();
    await auditRows();

    await user.type(screen.getByLabelText('Actor'), 'm.ellis');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.queryByText('j.chen')).not.toBeInTheDocument());
    const rows = await auditRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(within(row).getByText('M. Ellis')).toBeInTheDocument();
    }
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderAudit();
    await auditRows();

    await user.type(screen.getByLabelText('Action'), 'no-such-action');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('No audit events match these filters.')).toBeInTheDocument();
  });

  it('loads the next page on the cursor', async () => {
    const user = userEvent.setup();
    renderAudit();
    expect((await auditRows()).length).toBe(20);

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(async () => expect((await auditRows()).length).toBe(30));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('is read-only: no edit or delete action anywhere', async () => {
    renderAudit();
    await auditRows();

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('shows a not-allowed page when the api answers 403', async () => {
    vi.spyOn(api, 'getAuditEvents').mockRejectedValueOnce(new ApiError('Forbidden', 403));

    renderAudit();

    expect(await screen.findByRole('heading', { name: 'Not allowed', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Your role cannot read the audit log.')).toBeInTheDocument();
  });
});
