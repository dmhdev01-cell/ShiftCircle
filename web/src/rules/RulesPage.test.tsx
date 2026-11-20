import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { demoRuleSets } from '../api/fixtures/rules';
import { setSession } from '../api/session';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderRules(path = '/rules/8/rest-between-shifts') {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

/** The fixtures demo switch, so the screens act as a rules admin. */
async function actAsRulesAdmin(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), 'RULES_ADMIN');
}

/** Walk the real sign-in screen, the way a person would. */
async function signInAs(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(name) }));
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
    await actAsRulesAdmin(user);

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
    await actAsRulesAdmin(user);
    await user.click(screen.getByRole('button', { name: 'Build and check' }));

    expect(await screen.findByText('13 / 13 test scenarios passed.')).toBeInTheDocument();
    expect(
      screen.getByText(/3 published shifts in Unit C, 24 – 28 Nov, would now break U-03/),
    ).toBeInTheDocument();
    // The impact is counts, never names (ADR-017).
    expect(screen.queryByText('Tara Nakamura')).not.toBeInTheDocument();
  });

  it('R3: Build and Submit use unsaved edits and say they will save them first', async () => {
    const user = userEvent.setup();
    renderRules();
    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await actAsRulesAdmin(user);

    // E3: the admin raises U-03 from 12 to 14 hours but does not press Save.
    const u03 = screen.getByLabelText('Minimum hours off for U-03');
    await user.clear(u03);
    await user.type(u03, '14');

    expect(
      screen.getByText('You have unsaved edits. Build and Submit save them first.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Build and check' }));

    expect(
      await screen.findByText(
        'The unsaved edits were saved, then the draft was built and the test scenarios ran.',
      ),
    ).toBeInTheDocument();
    const saved = await api.getRuleTable(8, 'rest-between-shifts');
    expect(saved.rows.find((row) => row.ruleCode === 'U-03')?.minHours).toBe(14);

    // Submit saves a later edit too, and rebuilds before the draft goes to
    // the approver.
    const u02 = screen.getByLabelText('Minimum hours off for U-02');
    await user.clear(u02);
    await user.type(u02, '16');
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));

    expect(
      await screen.findByText(
        'The unsaved edits were saved, the draft was rebuilt, and it is submitted for approval. A second approver has to review it.',
      ),
    ).toBeInTheDocument();
    const submitted = await api.getRuleTable(8, 'rest-between-shifts');
    expect(submitted.rows.find((row) => row.ruleCode === 'U-02')?.minHours).toBe(16);
  });

  it('hides the approve action from the person who created the draft', async () => {
    const user = userEvent.setup();
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await actAsRulesAdmin(user);

    expect(
      await screen.findByText('You created this version. Another approver must review it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('R1/R2: walks E3 as two people, from the draft to a published version', async () => {
    const user = userEvent.setup();
    renderRules('/login');

    // The rules admin signs in, raises U-03, builds and submits.
    await signInAs(user, 'L. Fraser');
    expect(await screen.findByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Rest between shifts' });

    const u03 = screen.getByLabelText('Minimum hours off for U-03');
    await user.clear(u03);
    await user.type(u03, '14');
    await user.click(screen.getByRole('button', { name: 'Build and check' }));
    await screen.findByText('13 / 13 test scenarios passed.');
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));
    // Build already saved the edit, so this is the plain submit message.
    expect(await screen.findByText(/is submitted for approval/)).toBeInTheDocument();

    // The admin signs out. The sign-in screen is a real identity change, not a
    // role switch.
    await user.click(screen.getByRole('button', { name: 'Account menu for L. Fraser' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    // The approver signs in and lands on the Rules screen, not "Page not
    // found" (R1). The submitted version is the one on screen.
    await signInAs(user, 'P. Singh');
    expect(await screen.findByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(
      screen.queryByText('You created this version. Another approver must review it.'),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('The version is approved. It can be published.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Version 8 is live from/)).toBeInTheDocument();

    const versions = await api.getRuleSets();
    const published = versions.find((entry) => entry.version === 8);
    expect(published?.live).toBe(true);
    expect(demoRuleSets.find((entry) => entry.version === 8)?.status).toBe('PUBLISHED');
  });

  it('gates Build and Submit to a rules admin (docs/09 §2)', async () => {
    const user = userEvent.setup();
    renderRules('/login');

    await signInAs(user, 'P. Singh');
    await screen.findByRole('heading', { name: 'Rest between shifts' });

    expect(screen.queryByRole('button', { name: 'Build and check' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    // Read-only for the approver: the table is not theirs to edit.
    expect(screen.getByLabelText('Minimum hours off for U-01')).toBeDisabled();
  });

  it('canApprove excludes the draft author even with the approver role', async () => {
    demoRuleSets[1].status = 'SUBMITTED';
    setSession('test-token', {
      id: 'l-fraser',
      name: 'L. Fraser',
      roles: ['RULES_APPROVER'],
      scope: 'No unit scope',
    });
    renderRules();

    expect(await screen.findByRole('heading', { name: 'Rest between shifts' })).toBeInTheDocument();
    expect(await screen.findByText('You created this version. Another approver must review it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('R2: the fixture refuses only the author, not every approver', async () => {
    demoRuleSets[1].status = 'SUBMITTED';

    setSession('test-token', {
      id: 'l-fraser',
      name: 'L. Fraser',
      roles: ['RULES_ADMIN'],
      scope: 'No unit scope',
    });
    await expect(api.approveRuleSet(8)).rejects.toThrow(/Another approver must review it/);

    setSession('test-token-2', {
      id: 'p-singh',
      name: 'P. Singh',
      roles: ['RULES_APPROVER'],
      scope: 'No unit scope',
    });
    const approved = await api.approveRuleSet(8);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('P. Singh');
  });

  it('B6: does not offer the approve action to a supervisor', async () => {
    renderRules();

    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await userEvent.setup().selectOptions(
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
