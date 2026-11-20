import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderRules() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/rules/8/rest-between-shifts']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('Rules admin', () => {
  it('lists the rule tables and shows the decision table for the one in the route', async () => {
    renderRules();

    const tables = await screen.findByRole('region', { name: 'Rule tables' });
    expect(within(tables).getByText('Rest between shifts')).toBeInTheDocument();
    expect(within(tables).getByText('Shift types')).toBeInTheDocument();
    expect(within(tables).getByText('Overtime ranking')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Rest between shifts' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Rule' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '…needs at least' })).toBeInTheDocument();
  });

  it('shows the plain-language sentence the api sent', async () => {
    renderRules();

    expect(
      await screen.findByText(/After a 12 h 00–12 shift, an officer needs at least 8 hours off/),
    ).toBeInTheDocument();
  });

  it('updates the sentence when the hours change', async () => {
    const user = userEvent.setup();
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });

    const hours = screen.getByLabelText('Minimum hours off for U-01');
    await user.clear(hours);
    await user.type(hours, '12');

    expect(
      await screen.findByText(/an officer needs at least 12 hours off/),
    ).toBeInTheDocument();
  });

  it('builds the draft and reports the scenarios and the impact', async () => {
    const user = userEvent.setup();
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await user.click(screen.getByRole('button', { name: 'Build and check' }));

    expect(await screen.findByText('13 / 13 test scenarios passed.')).toBeInTheDocument();
    expect(
      screen.getByText(/3 published shifts in Unit C, 24 – 28 Nov, would now break U-03/),
    ).toBeInTheDocument();
    // The impact is counts, never names (ADR-017).
    expect(screen.queryByText('Tara Nakamura')).not.toBeInTheDocument();
  });

  it('hides the approve action from the person who created the draft', async () => {
    const user = userEvent.setup();
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await user.selectOptions(
      screen.getByLabelText('Mock sign-in: choose a role'),
      'RULES_ADMIN',
    );

    expect(
      await screen.findByText('You created this version. Another approver must review it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('offers the approve action to a second approver once the draft is submitted', async () => {
    const user = userEvent.setup();
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await user.selectOptions(
      screen.getByLabelText('Mock sign-in: choose a role'),
      'RULES_APPROVER',
    );

    // A draft that has not been submitted has nothing to approve.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Build and check' }));
    await user.click(await screen.findByRole('button', { name: 'Submit for approval' }));

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('B6: does not offer the approve action to a supervisor', async () => {
    const user = userEvent.setup();
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await user.selectOptions(
      screen.getByLabelText('Mock sign-in: choose a role'),
      'SUPERVISOR',
    );

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('shows the version history', async () => {
    renderRules();

    expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument();
    expect(screen.getByText('Live v7 · draft v8')).toBeInTheDocument();
  });
});
