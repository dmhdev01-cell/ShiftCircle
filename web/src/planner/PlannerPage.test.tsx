import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function SearchProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderPlanner(path = '/planner') {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShellRoutes />
          <SearchProbe />
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
    // The api's plain sentence about the warnings, and the quarter in numbers.
    expect(screen.getByText(/rotating pattern/)).toBeInTheDocument();
    expect(screen.getByText(/Quarter hours per officer: 480 min · 512 avg · 546 max/)).toBeInTheDocument();
    expect(screen.getByText(/Weekends worked: 4–11/)).toBeInTheDocument();
    // "What this means" explains each tile in the design's words, one at a time.
    const explained = screen.getAllByRole('button', { name: 'What this means' });
    expect(explained).toHaveLength(6);
    await user.click(explained[0]);
    expect(
      screen.getByRole('region', { name: 'What Coverage gaps means' }),
    ).toHaveTextContent(/never breaks a blocking rule to fill a gap/);
    await user.click(explained[0]);
    expect(screen.queryByRole('region', { name: 'What Coverage gaps means' })).not.toBeInTheDocument();

    // The FTE band table: officers, target, planned min/avg/max, the api's note.
    expect(
      screen.getByRole('heading', { name: 'Hours against target by FTE band' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Full-time')).toBeInTheDocument();
    expect(screen.getByText('Part-time (0.7–0.9)')).toBeInTheDocument();
    expect(screen.getByText(/not guaranteed hours/)).toBeInTheDocument();

    // The N12 crew figures and the api's crew sentence, and the 5/2 changeover
    // note, are the api's words, shown as sent.
    expect(screen.getByText(/N12 night crew: 38 officers/)).toBeInTheDocument();
    expect(screen.getByText(/fixed separate crews/)).toBeInTheDocument();
    expect(screen.getByText(/one rest-day warning and one weekly-hours warning/)).toBeInTheDocument();

    // The pattern picker speaks plainly, with the rotating default first.
    const pattern = screen.getByLabelText('8-hour pattern');
    expect(within(pattern).getAllByRole('option')[0]).toHaveTextContent(
      'Rotating 5 on, 2 off (weekends rotate)',
    );
    expect(screen.getByRole('heading', { name: 'Preferences by kind' })).toBeInTheDocument();
    // A draft is not a roster: the tab says so rather than showing an empty grid.
    expect(screen.getByRole('tab', { name: /Gaps/ })).toBeInTheDocument();
  });

  it('keeps the tab in the address, so a link and Back land on it', async () => {
    const user = userEvent.setup();
    const first = renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));
    await user.click(await screen.findByRole('tab', { name: /Gaps/ }));
    expect(screen.getByTestId('search').textContent).toContain('tab=gaps');

    // A fresh load of that address opens on Gaps (the fixture draft survives).
    first.unmount();
    renderPlanner('/planner?tab=gaps');
    expect(await screen.findByRole('tab', { name: /Gaps/ })).toHaveAttribute('aria-selected', 'true');
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

  it('shows the draft roster with the all-units strip and the not-on-the-board note', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    await user.click(await screen.findByRole('tab', { name: 'Roster' }));

    expect(await screen.findByRole('note')).toHaveTextContent(/not on the planning board yet/);
    expect(
      await screen.findByRole('region', { name: /All units · 4 – 10 Jan 2027/ }),
    ).toBeInTheDocument();
    // The grid is the board's own, read-only here.
    expect(await screen.findByRole('region', { name: 'Roster, scrolls sideways' })).toBeTruthy();
    const week = screen.getByRole('group', { name: 'Week' });
    expect(week).toHaveTextContent('4 – 10 Jan 2027');
    expect(within(week).getByRole('button', { name: 'Previous week' })).toBeDisabled();
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

    expect(await screen.findByRole('heading', { name: 'Plan committed' })).toBeInTheDocument();
    expect(await screen.findByText(/Supervisors can now change shifts/)).toBeInTheDocument();
  });

  it('keeps the committed state after a reload, with the commit figures', async () => {
    // The api keeps the committed summary in lastCommitted, not a draft, so a
    // reload must not say 'No draft'. The scorecard/tabs need committedDraft
    // (queued to the api); until then the figures and a plain sentence.
    const user = userEvent.setup();
    const first = renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));
    await user.click(await screen.findByRole('button', { name: 'Commit plan…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Commit plan' }));
    await screen.findByText(/Supervisors can now change shifts/);

    first.unmount();
    renderPlanner();
    await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');

    expect(await screen.findByText('Committed')).toBeInTheDocument();
    expect(screen.queryByText('No plan for this quarter yet.')).not.toBeInTheDocument();
    // The committed plan's own summary answers the read-only tabs.
    expect(screen.getByRole('tab', { name: 'Scorecard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Night shifts by seniority' })).toBeInTheDocument();
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
