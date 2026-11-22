import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { resetPlannerUnitFixtures } from '../api/fixtures/plannerUnits';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderAt(path: string) {
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

async function asPlanner(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText('Mock sign-in: choose a role'),
    'PLANNER',
  );
}

describe('the Units screen', () => {
  beforeEach(() => resetPlannerUnitFixtures());

  it('lists the units, their closures and their staff numbers', async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await asPlanner(user);

    expect(await screen.findByRole('heading', { name: 'Units', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/6 units/)).toBeInTheDocument();
    // The demo closure reads in the person's words.
    const row = screen.getByRole('row', { name: /Unit C · Living unit/ });
    expect(within(row).getByText('Closed from 15 Feb 2027 · no reopening date set')).toBeInTheDocument();
    expect(within(row).getByText(/"Renovation \(demo\)"/)).toBeInTheDocument();
    // Allocated and on staff are both 21 for Unit C in the fixtures.
    expect(within(row).getAllByText('21').length).toBeGreaterThanOrEqual(2);
    // An open-ended closure cannot get another one.
    expect(
      screen.queryByRole('button', { name: 'Close Unit C from a date' }),
    ).not.toBeInTheDocument();
  });

  it("closes a unit from a date, with the api's preview in the effect text", async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await asPlanner(user);

    await user.click(await screen.findByRole('button', { name: 'Close Unit A from a date' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close Unit A from a date' });
    await user.type(within(dialog).getByLabelText('Closed from'), '2027-03-15');
    await user.type(within(dialog).getByLabelText('Reason'), 'Renovation');
    // The api's preview: 23 officers homed; no published shifts in Unit A.
    expect(await within(dialog).findByText(/Its 23 officers stay employed/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/shifts already published/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close Unit A' }));

    expect(
      await screen.findByText(/Unit A is closed from 15 Mar 2027\. Generate a new draft/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Quarter plan' })).toBeInTheDocument();
  });

  it('names the published shifts a closure would flag, in the Change dialog', async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await asPlanner(user);

    const row = await screen.findByRole('row', { name: /Unit C · Living unit/ });
    await user.click(within(row).getByRole('button', { name: 'Change…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the closure of Unit C' });
    expect(await within(dialog).findByText(/Its 21 officers stay employed/)).toBeInTheDocument();
    expect(within(dialog).getByText(/12 shifts already published in Unit C/)).toBeInTheDocument();
  });

  it('says why a closure cannot be saved', async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Close Unit A from a date' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close Unit A from a date' });
    await user.type(within(dialog).getByLabelText('Closed from'), '2027-03-15');
    await user.type(within(dialog).getByLabelText('Reason'), 'no');
    // Live validation: the reason error is under the field and the button is
    // disabled, so there is no click that could send a short reason.
    expect(
      within(dialog).getByText('Write a reason of at least 5 characters.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close Unit A' })).toBeDisabled();
  });

  it('removes a closure and edits the allocated headcount', async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await asPlanner(user);

    const row = await screen.findByRole('row', { name: /Unit C · Living unit/ });
    await user.click(within(row).getByRole('button', { name: 'Remove…' }));
    const remove = await screen.findByRole('dialog', { name: 'Remove this closure?' });
    expect(within(remove).getByText(/will be open on every day from 15 Feb 2027 again/)).toBeInTheDocument();
    await user.click(within(remove).getByRole('button', { name: 'Remove closure' }));
    expect(await screen.findByText(/Unit C is open again/)).toBeInTheDocument();

    const fresh = await screen.findByRole('row', { name: /Unit A · Living unit/ });
    await user.click(within(fresh).getByRole('button', { name: 'Edit allocated headcount for Unit A' }));
    const allocated = await screen.findByRole('dialog', { name: 'Allocated headcount for Unit A' });
    await user.clear(within(allocated).getByLabelText('Allocated officers'));
    await user.type(within(allocated).getByLabelText('Allocated officers'), '25');
    await user.type(within(allocated).getByLabelText('Reason'), 'New funding');
    await user.click(within(allocated).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Allocated headcount saved.')).toBeInTheDocument();
    expect(
      within(await screen.findByRole('row', { name: /Unit A · Living unit/ })).getByText('25'),
    ).toBeInTheDocument();
  });

  it('is the facility planner only', async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await user.selectOptions(
      await screen.findByLabelText('Mock sign-in: choose a role'),
      'SUPERVISOR',
    );
    expect(
      await screen.findByText('Only the facility planner can close or reopen a unit.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('validates the reopening date as it is typed', async () => {
    const user = userEvent.setup();
    renderAt('/planner/units');
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Close Unit A from a date' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close Unit A from a date' });

    await user.type(within(dialog).getByLabelText('Closed from'), '2027-03-15');
    await user.type(within(dialog).getByLabelText('Reason'), 'Renovation');
    await user.type(within(dialog).getByLabelText('Reopens on'), '2027-03-10');

    // The impossible date shows its error as it is typed, the button is
    // disabled, and the effect text does not claim the unit reopens.
    expect(
      within(dialog).getByText('The reopening date must be after the closing date.'),
    ).toBeInTheDocument();
    const close = within(dialog).getByRole('button', { name: 'Close Unit A' });
    expect(close).toBeDisabled();
    expect(within(dialog).queryByText(/The unit is open again from/)).not.toBeInTheDocument();

    // A valid date enables the button and adds the reopening sentence.
    await user.clear(within(dialog).getByLabelText('Reopens on'));
    await user.type(within(dialog).getByLabelText('Reopens on'), '2027-03-20');
    expect(close).toBeEnabled();
    expect(
      within(dialog).getByText(/The unit is open again from Sat 20 Mar 2027\./),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('The reopening date must be after the closing date.'),
    ).not.toBeInTheDocument();
  });
});
