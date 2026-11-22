import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { whenWords } from './plannerTime';
import { api } from '../api/client';
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
    expect(await screen.findByText(/4 Jan – 11 Apr 2027/)).toBeInTheDocument();
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
    expect(explained).toHaveLength(7);
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
    expect(screen.getByText('Full time')).toBeInTheDocument();
    expect(screen.getByText('0.7 to 0.9 FTE')).toBeInTheDocument();
    expect(screen.getByText(/not guaranteed hours/)).toBeInTheDocument();
    // The api's band keys in plain words, never raw.
    expect(screen.getByText('0.7 to 0.9 FTE')).toBeInTheDocument();
    expect(screen.queryByText('0.7_TO_0.9')).not.toBeInTheDocument();
    expect(screen.queryByText('UNDER_0.7')).not.toBeInTheDocument();
    // A kind nobody asked for says so, and a missing hire year is not a dash.
    expect(screen.getByText('none asked')).toBeInTheDocument();
    expect(screen.queryByText(/hired –/)).not.toBeInTheDocument();

    // The N12 crew figures and the api's crew sentence, and the 5/2 changeover
    // note, are the api's words, shown as sent.
    expect(screen.getByText(/N12 night crew: 38 officers/)).toBeInTheDocument();
    expect(screen.getByText(/fixed separate crews/)).toBeInTheDocument();
    expect(screen.getByText(/one rest-day warning and one weekly-hours warning/)).toBeInTheDocument();

    // Option C: the facility pattern picker is gone, and the scorecard names
    // each officer's own pattern in words (never a raw code).
    expect(screen.queryByLabelText('8-hour pattern')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shift patterns' })).toBeInTheDocument();
    expect(screen.getByText('Rotating 5 on, 2 off (weekends rotate)')).toBeInTheDocument();
    expect(screen.queryByText('ROTATING_5_2')).not.toBeInTheDocument();
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

    const panel = await screen.findByRole('tabpanel');
    const table = within(panel).getByRole('table');
    expect(within(table).getAllByText(/Unit A · Living unit/).length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('button', { name: /Show week of/ }).length).toBeGreaterThan(0);
  });

  it('generates without a facility pattern: each officer keeps their own', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, 'createPlannerDraft');
    renderPlanner();
    await asPlanner(user);

    await user.click(screen.getByRole('button', { name: 'Generate draft' }));

    await screen.findByText('Coverage gaps');
    expect(create).toHaveBeenCalledWith({ seed: 20261001 });
    expect(create.mock.calls[0][0]).not.toHaveProperty('pattern8h');
    vi.restoreAllMocks();
  });

  it("compares the draft with what is on the board, in the api's direction", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));

    await user.click(await screen.findByRole('tab', { name: 'Compare' }));

    const panel = await screen.findByRole('tabpanel');
    const table = within(panel).getByRole('table');
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
    // Observation 32: the unit's name heads the grid. The fixtures' own unit
    // list has one unit; the exact per-unit counts are tested on the tab itself.
    expect(await screen.findByRole('heading', { name: /Unit B/ })).toBeInTheDocument();
    const options = () =>
      within(screen.getByLabelText('Unit'))
        .getAllByRole('option')
        .map((option) => option.textContent ?? '');
    expect(options().every((text) => / · (no gaps|1 gap|\d+ gaps)$/.test(text))).toBe(true);

    const week = screen.getByRole('group', { name: 'Week' });
    expect(week).toHaveTextContent('4 – 10 Jan 2027');
    expect(within(week).getByRole('button', { name: 'Previous week' })).toBeDisabled();

  });

  it('shows staffing before a draft, the tile after one, and the flagged shifts', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);

    // No draft: the panel sits under the empty card, with the demo closure split.
    expect(await screen.findByRole('heading', { name: 'Staffing by unit' })).toBeInTheDocument();
    expect(screen.getByText('Leave allowance: 20%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How "needed" is worked out' })).toBeInTheDocument();
    expect(screen.getAllByText(/4 Jan 2027 – 14 Feb 2027/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/15 Feb 2027 – 11 Apr 2027/).length).toBeGreaterThan(0);

    // Published shifts in a closed unit are listed for a supervisor, never deleted.
    expect(
      screen.getByRole('heading', { name: 'Shifts in closed units (2)' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /Show Unit C, week of 15 Feb 2027, on the planning board/ })
        .length,
    ).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    await screen.findByText('Coverage gaps');
    // The floor wording (release-3 addition): the label, the line and the pill.
    expect(screen.getAllByText('Needed (at least)').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/least staff the unit minimums need with 20% leave/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Short').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'What this means' })).toHaveLength(7);
    expect(screen.getByRole('heading', { name: 'Staffing by unit' })).toBeInTheDocument();

    // The formula's own words, and the per-unit How line from the api breakdown.
    await user.click(screen.getByRole('button', { name: 'How' }));
    expect(screen.getAllByText(/day 12-hour posts × 2 =/).length).toBeGreaterThan(0);
  });

  it('changes the leave allowance and refreshes the numbers', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await asPlanner(user);
    await screen.findByRole('heading', { name: 'Staffing by unit' });

    await user.click(screen.getByRole('button', { name: 'Change leave allowance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave allowance' });
    await user.clear(within(dialog).getByLabelText('Leave allowance (%)'));
    await user.type(within(dialog).getByLabelText('Leave allowance (%)'), '25');
    await user.type(within(dialog).getByLabelText('Reason'), 'More training this year');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Leave allowance: 25%')).toBeInTheDocument();
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

    // The commit line is Regina time, one format (the api's commit result
    // sends only a Regina date; the plan state carries the instant).
    expect(screen.getByText(/Committed 21 Nov, 09:40/)).toBeInTheDocument();
    // The first week reads as a date, and the unit links follow the board's
    // order (by unit code), not the api's set order.
    expect(screen.getByText(/shifts from 4 Jan 2027/)).toBeInTheDocument();
    const links = screen
      .getAllByRole('button', { name: /^Open .* on the planning board$/ })
      .map((button) => button.textContent);
    expect(links).toEqual([
      'Open Unit A on the planning board',
      'Open Admissions on the planning board',
      'Open Unit B on the planning board',
      'Open Unit C on the planning board',
      'Open Control on the planning board',
      'Open Escort & transport on the planning board',
    ]);
  });

  it('reads a date-only committed value as a date, not as UTC midnight', () => {
    // The api's commit result sent LocalDate.now(Regina): parsed as an instant
    // it showed the previous evening ("20 Nov 18:00") in the planner banner.
    expect(whenWords('2026-11-21')).toBe('21 Nov 2026');
    // An instant is Regina time, the same format everywhere.
    expect(whenWords('2026-11-21T07:02:00Z')).toBe('21 Nov, 01:02');
  });

  it('keeps the committed state after a reload, with the commit figures', async () => {
    // The api keeps the committed summary in committedDraft, not a draft, so a
    // reload must not say 'No draft' and its tabs must answer.
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

    // A committed quarter cannot generate another draft (the api answers
    // ALREADY_COMMITTED_WINDOW), so the landing says how to start over instead
    // of offering a button the api refuses.
    expect(
      screen.getByText(/This quarter is committed. To plan it again/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Generate draft|Generate a new draft/ }),
    ).not.toBeInTheDocument();
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
