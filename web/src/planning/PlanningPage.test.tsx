import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { useLocation } from 'react-router-dom';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderBoard(path = '/planning') {
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

/** Shows the address, so a test can check what the board writes there. */
function SearchProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

/** The api's /version answer, with the demo day. */
function stubVersion(asOf = '2026-11-19') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/api/v1/version')
        ? { name: 'shiftcircle-api', asOf }
        : {};
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
    }),
  );
}

describe('the planning board', () => {
  it('says it is reading the demo fixtures', async () => {
    renderBoard();
    expect(await screen.findByText('Demo fixtures')).toBeInTheDocument();
  });

  it('keeps the footer disclaimer', async () => {
    renderBoard();
    expect(
      await screen.findByText(
        'Not an official Government of Saskatchewan service · fictional, synthetic data only',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the rule explanation behind the Rules help button', async () => {
    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Coverage gaps');
    expect(screen.queryByText(/Pick an empty cell to propose a shift/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rules help' }));
    expect(screen.getByText(/Pick an empty cell to propose a shift/)).toBeInTheDocument();
  });

  it('counts the coverage gaps from the hourly coverage (ADR-017)', async () => {
    renderBoard();

    const tile = await screen.findByText('Coverage gaps');
    const card = tile.closest('div');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Sat days, Fri evenings')).toBeInTheDocument();
  });

  it('names the hours that fall short instead of only showing a count', async () => {
    renderBoard();

    // Saturday's day block: 4 of 5 officers, short between 15:00 and 17:00.
    expect((await screen.findAllByText('4 / 5')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('short 15–17').length).toBeGreaterThan(0);
  });

  it('says when every hour of a block is over', async () => {
    renderBoard();
    expect((await screen.findAllByText('+1 over')).length).toBeGreaterThan(0);
  });

  it('uses the ADR-015 shift codes and the extra label', async () => {
    renderBoard();

    expect((await screen.findAllByText('A12')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('P12').length).toBeGreaterThan(0);
    // D12 and N12 are real crew templates since V6 (P3 amendments 18): they
    // belong in the key, unlike the mockup's old D12/N12 meaning.
    expect(screen.getAllByText('D12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('N12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('E · extra').length).toBeGreaterThan(0);
    expect(screen.queryByText('OT')).not.toBeInTheDocument();
  });

  it('shows the officer pay-period hours with the overtime status pill', async () => {
    renderBoard();

    expect((await screen.findAllByText('96 h')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('In overtime').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approaching').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Under').length).toBeGreaterThan(0);
  });

  it('B3: the proposed chip opens the rule check for the proposal', async () => {
    const user = userEvent.setup();
    renderBoard();

    // Nia's Saturday proposal is the planted case PC-01.
    const chip = await screen.findByRole('button', { name: /! D proposed for Nia Thompson/ });
    await user.click(chip);

    expect(await screen.findByRole('heading', { name: /Assign Nia Thompson/ })).toBeInTheDocument();
    expect(await screen.findByText('Blocked: 3 rules fail')).toBeInTheDocument();
    expect(screen.getByText(/U-01 · Minimum rest/)).toBeInTheDocument();
    // "Find eligible officer" carries the slot, so the overtime board can open
    // the matching open shift instead of whichever is first.
    expect(screen.getByRole('link', { name: 'Find eligible officer' })).toHaveAttribute(
      'href',
      '/overtime?unit=unit-b&startAt=2026-11-21T07%3A00%3A00-06%3A00',
    );
  });

  it('reads Off on the empty cells and only offers an assignment for today or later', async () => {
    renderBoard();

    expect(
      await screen.findByRole('button', {
        name: /assign a shift to Aiden Bergeron on 2026-11-19/,
      }),
    ).toBeInTheDocument();
  });

  it('returns focus to the chip when the verdict is closed', async () => {
    const user = userEvent.setup();
    renderBoard();

    const chip = await screen.findByRole('button', { name: /! D proposed for Nia Thompson/ });
    await user.click(chip);
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(chip).toHaveFocus());
  });

  it('returns focus to the chip when Escape closes the verdict', async () => {
    const user = userEvent.setup();
    renderBoard();

    const chip = await screen.findByRole('button', { name: /! D proposed for Nia Thompson/ });
    await user.click(chip);
    await screen.findByRole('region', { name: 'Rule check' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(chip).toHaveFocus());
  });

  it('offers a skip link straight to the roster', async () => {
    renderBoard();

    const link = await screen.findByRole('link', { name: 'Skip to roster' });
    expect(link).toHaveAttribute('href', '#roster');
    expect(document.getElementById('roster')).not.toBeNull();
  });

  it('B2: a Block with an ACKNOWLEDGE policy offers no override', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /! D proposed for Nia Thompson/ }));
    expect(await screen.findByText('Blocked: 3 rules fail')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Emergency override…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acknowledge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign shift' })).not.toBeInTheDocument();
  });

  it('reloads the board after a save', async () => {
    // D9: Assign, Acknowledge and assign and the emergency override all saved
    // through the api but never reloaded the board, so the saved cell still
    // said "Off" until the person left the screen.
    const user = userEvent.setup();
    const schedule = vi.spyOn(api, 'getSchedule');
    vi.spyOn(api, 'previewRuleCheck').mockResolvedValue({
      outcome: 'PASS',
      ruleSetVersion: 7,
      overridable: false,
      ruleResults: [],
    });
    vi.spyOn(api, 'saveChange').mockResolvedValue({
      assignmentId: 'assignment-new',
      version: 0,
      status: 'PLANNED',
      ruleOutcome: { outcome: 'PASS', ruleSetVersion: 7, overridable: false, ruleResults: [] },
    } as never);

    renderBoard();

    await user.click(
      await screen.findByRole('button', { name: /assign a shift to Aiden Bergeron on 2026-11-19/ }),
    );
    await user.click(await screen.findByRole('button', { name: /D8 · Day 8 h/ }));
    await user.click(await screen.findByRole('button', { name: 'Assign shift' }));

    // The first read is the board itself; the save must ask for a second one.
    await waitFor(() => expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('shows a plain sentence when the api cannot be reached', async () => {
    // Cosmetic: the board used to repeat the browser's raw "Failed to fetch".
    // The client maps that to this sentence (api/http.test.ts pins it).
    const spy = vi
      .spyOn(api, 'getSchedule')
      .mockRejectedValue(new ApiError('Could not reach the API. Check the connection and try again.', 0));

    renderBoard();

    expect(await screen.findByText('Could not load the schedule')).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the API/)).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('walks between weeks and comes back to today', async () => {
    // Observation #3: the board was pinned to the week of the demo day.
    stubVersion();
    const user = userEvent.setup();
    renderBoard();

    // The demo day 2026-11-19 is in the week of Mon 16 to Sun 22 Nov.
    expect(await screen.findByText('16 – 22 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByText('9 – 15 Nov 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByText('23 – 29 Nov 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('16 – 22 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  it('opens the week the address names, including a 2027 week', async () => {
    stubVersion();
    const schedule = vi.spyOn(api, 'getSchedule');

    renderBoard('/planning?week=2027-01-04');

    expect(await screen.findByText('4 – 10 Jan 2027')).toBeInTheDocument();
    expect(
      schedule.mock.calls.some(
        ([query]) => query.from === '2027-01-04' && query.to === '2027-01-10',
      ),
    ).toBe(true);
    vi.restoreAllMocks();
  });

  it('opens the unit the address names', async () => {
    stubVersion();

    renderBoard('/planning?unit=unit-b');

    const unit = await screen.findByLabelText('Unit');
    expect(unit).toHaveValue('unit-b');
  });

  it('keeps the unit and week in the address while walking', async () => {
    stubVersion();
    const user = userEvent.setup();

    renderBoard('/planning?unit=unit-b');

    await user.click(await screen.findByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('week=2026-11-23'));
    expect(screen.getByTestId('search').textContent).toContain('unit=unit-b');

    await user.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('week=2026-11-16'));
  });

  it('says when a week has no shifts at all', async () => {
    stubVersion();

    renderBoard('/planning?week=2027-01-04');

    expect(await screen.findByText(/No shifts on this week yet/)).toBeInTheDocument();
  });

  it('offers the supervisor the publish action for the roster week', async () => {    renderBoard();

    expect(await screen.findByText('Not published')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish period' })).toBeEnabled();
  });

  it('does not offer an auditor the publish action', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Coverage gaps');

    await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), 'AUDITOR');

    expect(screen.queryByRole('button', { name: 'Publish period' })).not.toBeInTheDocument();
  });
});
