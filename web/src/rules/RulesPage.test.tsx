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

  it('opens the Shift types table from the address, not the first table', async () => {
    renderRules('/rules/7/shift-types');

    const tables = await screen.findByRole('region', { name: 'Rule tables' });
    // The literal '/rules/:version/shift-types' route used to win over the
    // generic ':table' one without a table param, so the page fell back to
    // Rest between shifts and the Shift types table was unreachable.
    expect(within(tables).getByRole('button', { name: 'Shift types' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Shift types' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Rest between shifts' }),
    ).not.toBeInTheDocument();
  });

  it('shows the plain-language sentence the api sent', async () => {
    renderRules();

    expect(
      await screen.findByText(/After a 12 h 00–12 shift, an officer needs at least 8 hours off/),
    ).toBeInTheDocument();
  });

  it('composes the sentence with an article ("After a 16-hour shift")', async () => {
    const user = userEvent.setup();
    renderRules();
    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await actAsRulesAdmin(user);

    const u03 = screen.getByLabelText('Minimum hours off for U-03');
    await user.clear(u03);
    await user.type(u03, '14');

    expect(await screen.findByText(/After a 16-hour shift, an officer needs at least 14 hours off/)).toBeInTheDocument();
  });

  // Demo §4 / E3: the edit is U-02 12 -> 14 h. Its shift kind is stored as a
  // pattern; the sentence used to read "After (d8|e8|n8|a12|p12|d12|n12), ...
  // has to acknowledge it, and the supervisor has to acknowledge it."
  it('E3: U-02 at 14 h reads in plain words, with the shift kind named and the outcome said once', async () => {
    const user = userEvent.setup();
    renderRules();
    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await actAsRulesAdmin(user);

    const kind = screen.getByLabelText('Shift kind for U-02');
    expect(kind).toHaveDisplayValue('D8, E8, N8, A12, P12, D12 or N12');

    const u02 = screen.getByLabelText('Minimum hours off for U-02');
    await user.clear(u02);
    await user.type(u02, '14');

    const sentence = await screen.findByText(
      'After a D8, E8, N8, A12, P12, D12 or N12 shift, an officer needs at least 14 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
    );
    expect(sentence.textContent).not.toMatch(/[|()]/);
    expect(sentence.textContent?.match(/acknowledge/g)).toHaveLength(1);
    // The select still holds the stored pattern, so saving does not change the rule's scope.
    expect((kind as HTMLSelectElement).value).toBe('(D8|E8|N8|A12|P12|D12|N12)');
  });

  it('makes the read-only decision table a focusable scroll region', async () => {
    renderRules();

    const region = await screen.findByRole('region', { name: 'Decision table, scrolls sideways' });
    expect(region).toHaveAttribute('tabindex', '0');
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
      await screen.findByText('3 officers in Unit C go from Pass to Block under U-03'),
    ).toBeInTheDocument();
    // The impact is counts, never names (ADR-017).
    expect(screen.queryByText('Tara Nakamura')).not.toBeInTheDocument();
  });

  it('R3: Build and Submit use unsaved edits and say they will save them first', async () => {
    const user = userEvent.setup();
    renderRules();
    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await actAsRulesAdmin(user);

    // E3: the admin raises U-02 from 12 to 14 hours but does not press Save.
    const u02 = screen.getByLabelText('Minimum hours off for U-02');
    await user.clear(u02);
    await user.type(u02, '14');

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
    expect(saved.rows.find((row) => row.ruleCode === 'U-02')?.minHours).toBe(14);

    // Submit saves a later edit too, and rebuilds before the draft goes to
    // the approver.
    const u03 = screen.getByLabelText('Minimum hours off for U-03');
    await user.clear(u03);
    await user.type(u03, '16');
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));

    expect(
      await screen.findByText(
        'The unsaved edits were saved, the draft was rebuilt, and it is submitted for approval. A second approver has to review it.',
      ),
    ).toBeInTheDocument();
    const submitted = await api.getRuleTable(8, 'rest-between-shifts');
    expect(submitted.rows.find((row) => row.ruleCode === 'U-03')?.minHours).toBe(16);
  });

  it('starts a draft when the live version has none', async () => {
    const user = userEvent.setup();
    demoRuleSets[1].status = 'PUBLISHED';
    renderRules();
    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await actAsRulesAdmin(user);
    await screen.findByRole('heading', { name: 'Start a draft' });

    await user.type(
      screen.getByLabelText('Why is this change needed?'),
      'Raise the rest target between shifts to 14 hours',
    );
    await user.click(screen.getByRole('button', { name: 'Start a draft' }));

    expect(await screen.findByText(/Draft v9 is ready to edit/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Build and check' })).toBeInTheDocument();
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

    // The rules admin signs in, raises U-02, builds and submits.
    await signInAs(user, 'L. Fraser');
    // The page draws this heading while it loads and again when it is ready, so
    // wait on the content below instead of on the node this find returns.
    await screen.findByRole('heading', { name: 'Rules' });
    await screen.findByRole('heading', { name: 'Rest between shifts' });

    const u02 = screen.getByLabelText('Minimum hours off for U-02');
    await user.clear(u02);
    await user.type(u02, '14');
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
    await screen.findByRole('heading', { name: 'Rules' });
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(
      screen.queryByText('You created this version. Another approver must review it.'),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('The version is approved. It can be published.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Version 8 is live now.')).toBeInTheDocument();
    // D3: the status pill follows the publish; it read "Approved" next to "Live v8".
    expect(screen.getByText('Live v8 · no draft')).toBeInTheDocument();
    expect(screen.queryByText('Approved', { exact: true })).not.toBeInTheDocument();

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
      username: 'l.fraser',
      displayName: 'L. Fraser',
      roles: ['RULES_APPROVER'],
      units: [],
      employeeId: '',
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
      username: 'l.fraser',
      displayName: 'L. Fraser',
      roles: ['RULES_ADMIN'],
      units: [],
      employeeId: '',
    });
    await expect(api.approveRuleSet(8)).rejects.toThrow(/Another approver must review it/);

    setSession('test-token-2', {
      id: 'p-singh',
      username: 'p.singh',
      displayName: 'P. Singh',
      roles: ['RULES_APPROVER'],
      units: [],
      employeeId: '',
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

  it('names the real live and draft versions when the route shows the live version', async () => {
    renderRules('/rules/7/rest-between-shifts');

    expect(await screen.findByText('Live v7 · draft v8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Before draft v8 goes live' })).toBeInTheDocument();
    expect(screen.queryByText('Before draft v7 goes live')).not.toBeInTheDocument();
  });

  it('D2: the draft still shows its saved changes in the pill', async () => {
    renderRules();
    // The fixture tables are shared across this file, so earlier saves change the count.
    expect(await screen.findByText(/^\d+ changes? in draft$/)).toBeInTheDocument();
  });

  it('D2: the live version has no "change in draft" pill (its diff to the version before is not a draft)', async () => {
    renderRules('/rules/7/rest-between-shifts');
    await screen.findByRole('heading', { name: 'Rest between shifts' });
    await screen.findByText(/After a 12 h 00–12 shift/);
    expect(screen.queryByText(/in draft/)).not.toBeInTheDocument();
  });

  it('D2: a submitted version (the approver\'s screen) still shows its changes in the pill', async () => {
    demoRuleSets[1].status = 'SUBMITTED';
    renderRules();
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(await screen.findByText(/^\d+ changes? in draft$/)).toBeInTheDocument();
  });

  it('D3: the version history reads an api instant as a date and time in Regina, not raw ISO', async () => {
    const live = demoRuleSets.find((entry) => entry.version === 7)!;
    const before = live.publishedAt;
    live.publishedAt = '2026-11-24T15:08:19.884657Z';
    try {
      renderRules();
      expect(await screen.findByText('· 24 Nov 2026, 09:08')).toBeInTheDocument();
      expect(screen.queryByText(/2026-11-24T15:08/)).not.toBeInTheDocument();
    } finally {
      live.publishedAt = before;
    }
  });

  it('shows the version history', async () => {
    renderRules();

    expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument();
    expect(screen.getByText('Live v7 · draft v8')).toBeInTheDocument();
  });
});
