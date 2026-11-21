import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderPlanner() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/planner']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

/** The fixtures build's role switch is how a test becomes the planner. */
async function asPlanner(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');
}

describe('the quarter plan', () => {
  it('says plainly that other roles cannot plan', async () => {
    renderPlanner();

    expect(await screen.findByText(/may not plan the quarter/)).toBeInTheDocument();
  });

  it('generates a draft and shows its scorecard', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);

    // The landing first: nothing generated, the window from the api.
    expect(await screen.findByRole('heading', { name: 'Quarter plan', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/4 Jan – 11 Apr 2027/)).toBeInTheDocument();
    expect(screen.getByText('No plan for this quarter yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generate draft' }));

    // The scorecard: the six tiles and the two panels.
    expect(await screen.findByText('Coverage gaps')).toBeInTheDocument();
    expect(screen.getByText('Rule warnings')).toBeInTheDocument();
    expect(screen.getByText('Preferences met')).toBeInTheDocument();
    expect(screen.getByText('Night fairness')).toBeInTheDocument();
    expect(screen.getByText('Overtime built in')).toBeInTheDocument();
    expect(screen.getByText('Generated in')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Night shifts by seniority' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preferences by kind' })).toBeInTheDocument();
    // A draft is not a roster: the tab says so rather than showing an empty grid.
    expect(screen.getByRole('tab', { name: /Gaps/ })).toBeInTheDocument();
  });

  it('lists the gaps and can show a gap week', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    await user.click(await screen.findByRole('tab', { name: /Gaps/ }));

    const table = await screen.findByRole('table');
    expect(within(table).getAllByText(/Unit A · Living unit/).length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('button', { name: /Show week of/ }).length).toBeGreaterThan(0);
  });

  it("compares the draft with what is on the board, in the api's direction", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    await user.click(await screen.findByRole('tab', { name: 'Compare' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Block-days short')).toBeInTheDocument();
    expect(within(table).getByText('Rule warnings')).toBeInTheDocument();
    // Fewer gaps and fewer warnings in the draft: the api says lower is better.
    expect(within(table).getAllByText('better').length).toBeGreaterThan(0);
  });

  it('asks for the warnings to be accepted before committing, then commits', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    await user.click(await screen.findByRole('button', { name: 'Commit plan…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Rule warnings in this plan/)).toBeInTheDocument();

    const commit = within(dialog).getByRole('button', { name: 'Commit plan' });
    expect(commit).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox'));
    expect(commit).toBeEnabled();
    await user.click(commit);

    expect(await screen.findByText('Plan committed')).toBeInTheDocument();
    expect(await screen.findByText(/Supervisors can now change shifts/)).toBeInTheDocument();
  });

  it('discards a draft without touching the board', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    await user.click(await screen.findByRole('button', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    expect(await screen.findByText(/The draft was discarded/)).toBeInTheDocument();
    expect(await screen.findByText('No plan for this quarter yet.')).toBeInTheDocument();
  });
});
