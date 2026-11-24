import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { useLocation } from 'react-router-dom';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { demoRuleTables } from '../api/fixtures/rules';
import { scheduleForRange } from '../api/fixtures/schedule';
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
    const dialog = await screen.findByRole('dialog', { name: /^Rules help$/ });
    expect(dialog).toHaveAccessibleName('Rules help');
    expect(within(dialog).getByText(/Pick an empty cell to propose a shift/)).toBeInTheDocument();
  });

  it('explains the outcomes and the main rules from the live rule tables', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Coverage gaps');
    await user.click(screen.getByRole('button', { name: 'Rules help' }));
    const dialog = await screen.findByRole('dialog', { name: /^Rules help$/ });
    expect(dialog).toHaveAccessibleName('Rules help');

    for (const pill of ['Block', 'Warn', 'Info', 'Pass']) {
      expect(within(dialog).getAllByText(pill).length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByText(/can never be overridden/)).toBeInTheDocument();
    expect(within(dialog).getByText(/at least 10 characters/)).toBeInTheDocument();

    // The tables load asynchronously; wait for the live version line, then
    // every listed code, read from the published tables.
    await within(dialog).findByText(/Rule tables v7/);
    for (const code of ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-08', 'U-09', 'U-10', 'U-11', 'U-12', 'U-14', 'P-01']) {
      expect(within(dialog).getByText(new RegExp(`^${code} · `))).toBeInTheDocument();
    }
    // U-14's two lines, and a Block+ACKNOWLEDGE row that never says "acknowledge it before".
    expect(within(dialog).getByText(/Warns above 48 h in 7 days; blocks above 60 h\./)).toBeInTheDocument();
    expect(within(dialog).getAllByText('No override: choose someone else').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/acknowledge it before the change is saved/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Rule tables v7/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Full rules are on the Rules screen' })).toBeInTheDocument();

    // Esc closes and focus returns to the trigger.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Rules help$/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Rules help' })).toHaveFocus();
  });

  it('follows the published params: a changed limit reads in the legend', async () => {
    const rest = demoRuleTables.find((table) => table.code === 'rest-between-shifts')!;
    const u01 = rest.rows.find((row) => row.ruleCode === 'U-01')!;
    const original = u01.params!.minRestHours;
    u01.params = { ...u01.params, minRestHours: 10 };
    try {
      const user = userEvent.setup();
      renderBoard();
      await screen.findByText('Coverage gaps');
      await user.click(screen.getByRole('button', { name: 'Rules help' }));
      const dialog = await screen.findByRole('dialog', { name: /^Rules help$/ });
    expect(dialog).toHaveAccessibleName('Rules help');
      expect(await within(dialog).findByText('At least 10 h off in any 24 h.')).toBeInTheDocument();
    } finally {
      u01.params = { ...u01.params, minRestHours: original };
    }
  });

  it('gives the planner the outcomes and usage, without the rule tables or the link', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.selectOptions(
      await screen.findByLabelText('Mock sign-in: choose a role'),
      'PLANNER',
    );
    await expect(screen.findByRole('button', { name: 'Rules help' })).resolves.toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rules help' }));
    const dialog = await screen.findByRole('dialog', { name: /^Rules help$/ });
    expect(dialog).toHaveAccessibleName('Rules help');
    expect(
      within(dialog).getByText(/The facility planner reads the board only\./),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('The main rules')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('link', { name: 'Full rules are on the Rules screen' }),
    ).not.toBeInTheDocument();
  });

  it('counts the coverage gaps from the hourly coverage (ADR-017)', async () => {
    renderBoard();

    const tile = await screen.findByText('Coverage gaps');
    const card = tile.closest('div');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('2')).toBeInTheDocument();
    // A2: the gap words are buttons that open the fill panel.
    expect(within(card as HTMLElement).getByRole('button', { name: /^Fill gap: Sat days/ })).toHaveTextContent('Sat days');
    expect(within(card as HTMLElement).getByRole('button', { name: /^Fill gap: Fri evenings/ })).toBeInTheDocument();
    expect(card).toHaveTextContent('Sat days, Fri evenings');
  });

  describe('A2: fill a gap from the board', () => {
    const BLOCKED = {
      outcome: 'BLOCK' as const,
      ruleSetVersion: 7,
      overridable: false,
      ruleResults: [
        {
          ruleCode: 'U-01',
          ruleTable: 'rest',
          outcome: 'BLOCK' as const,
          message: 'Less than 8 hours rest between shifts',
          overridePolicy: 'ACKNOWLEDGE' as const,
        },
      ],
    };

    it('opens the panel from a gap word, lists the free officers ranked, and Close returns focus', async () => {
      const user = userEvent.setup();
      renderBoard();

      const word = await screen.findByRole('button', { name: /^Fill gap: Sat days/ });
      await user.click(word);

      const panel = await screen.findByRole('region', { name: /Sat 21 Nov · Days 07:00 – 15:00/ });
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveFocus();
      // The template defaults to the block's 8 h shift.
      expect(within(panel).getByRole('button', { name: /^D8 / })).toHaveAttribute('aria-pressed', 'true');
      const rows = within(within(panel).getByRole('list', { name: 'Free officers' })).getAllByRole('listitem');
      expect(rows.length).toBeGreaterThan(0);
      const hours = rows.map((row) => Number(/([\d.]+) h this pay period/.exec(row.textContent ?? '')?.[1]));
      expect(hours).toEqual([...hours].sort((a, b) => a - b));
      // Nia's Saturday holds the proposal, so she is not free.
      expect(within(panel).queryByText('Nia Thompson')).not.toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: /Overtime board/ })).toHaveAttribute(
        'href',
        '/overtime?unit=unit-b&startAt=2026-11-21T07%3A00%3A00-06%3A00',
      );

      await user.click(within(panel).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('region', { name: /Sat 21 Nov · Days/ })).not.toBeInTheDocument();
      await waitFor(() => expect(word).toHaveFocus());
    });

    it('opens from the short coverage cell, and Escape closes it', async () => {
      const user = userEvent.setup();
      renderBoard();

      const cell = await screen.findByRole('button', { name: /^Fill gap: Fri 20 Nov evenings, 4 \/ 5 short 15–17/ });
      await user.click(cell);
      expect(cell).toHaveAttribute('aria-pressed', 'true');
      const panel = await screen.findByRole('region', { name: /Fri 20 Nov · Evenings 15:00 – 23:00/ });
      expect(within(panel).getByRole('button', { name: /^E8 / })).toHaveAttribute('aria-pressed', 'true');

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('region', { name: /Fri 20 Nov · Evenings/ })).not.toBeInTheDocument();
      await waitFor(() => expect(cell).toHaveFocus());
    });

    it('Check & assign runs the existing rule check; a Block shows the reasons and no assign', async () => {
      const user = userEvent.setup();
      const preview = vi.spyOn(api, 'previewRuleCheck').mockResolvedValue(BLOCKED);
      const save = vi.spyOn(api, 'saveChange');
      renderBoard();

      await user.click(await screen.findByRole('button', { name: /^Fill gap: Sat days/ }));
      const panel = await screen.findByRole('region', { name: /Sat 21 Nov · Days/ });
      await user.click(within(panel).getByRole('button', { name: /^D12 / }));
      const first = within(panel).getAllByRole('button', { name: /^Check & assign D12: .*, Sat 21 Nov$/ })[0];
      const name = /Check & assign D12: (.*), Sat/.exec(first.getAttribute('aria-label') ?? '')?.[1];
      await user.click(first);

      expect(preview).toHaveBeenCalledWith({
        change: expect.objectContaining({
          type: 'ASSIGN',
          unitId: 'unit-b',
          shiftTemplate: 'D12',
          startAt: '2026-11-21T07:00:00-06:00',
        }),
      });
      const dock = await screen.findByRole('region', { name: 'Rule check' });
      expect(within(dock).getByRole('heading', { name: new RegExp(`Assign ${name}`) })).toBeInTheDocument();
      expect(await within(dock).findByText(/U-01 · Minimum rest/)).toBeInTheDocument();
      expect(within(dock).queryByRole('button', { name: /^Assign shift$/ })).not.toBeInTheDocument();
      // The panel steps aside while the verdict is open, then comes back.
      expect(screen.queryByRole('region', { name: /Sat 21 Nov · Days/ })).not.toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();

      await user.click(within(dock).getByRole('button', { name: 'Close' }));
      expect(await screen.findByRole('region', { name: /Sat 21 Nov · Days/ })).toBeInTheDocument();
      await waitFor(() => expect(first).toHaveFocus());
      vi.restoreAllMocks();
    });

    it('saves through the existing flow and reloads the board', async () => {
      const user = userEvent.setup();
      const schedule = vi.spyOn(api, 'getSchedule');
      vi.spyOn(api, 'previewRuleCheck').mockResolvedValue({
        outcome: 'PASS',
        ruleSetVersion: 7,
        overridable: false,
        ruleResults: [],
      });
      const save = vi.spyOn(api, 'saveChange').mockResolvedValue({
        assignmentId: 'assignment-new',
        version: 0,
        status: 'PLANNED',
        ruleOutcome: { outcome: 'PASS', ruleSetVersion: 7, overridable: false, ruleResults: [] },
      } as never);
      renderBoard();

      await user.click(await screen.findByRole('button', { name: /^Fill gap: Sat days/ }));
      const panel = await screen.findByRole('region', { name: /Sat 21 Nov · Days/ });
      await user.click(within(panel).getAllByRole('button', { name: /^Check & assign / })[0]);
      await user.click(await screen.findByRole('button', { name: 'Assign shift' }));

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ change: expect.objectContaining({ shiftTemplate: 'D8' }) }),
      );
      await waitFor(() => expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(2));
      vi.restoreAllMocks();
    });

    it('keeps the empty-cell flow as it was (demo §2)', async () => {
      const user = userEvent.setup();
      renderBoard();
      await user.click(
        await screen.findByRole('button', { name: /assign a shift to Aiden Bergeron on 2026-11-19/ }),
      );
      expect(await screen.findByRole('dialog', { name: /Assign a shift to Aiden Bergeron/ })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /· Days|· Evenings|· Nights/ })).not.toBeInTheDocument();
    });
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
    // The retired 16 h template is not in the assignable list (release 5).
    expect(screen.queryByRole('button', { name: /L16 · / })).not.toBeInTheDocument();
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

  it('says when the shown unit is closed, in the api\'s words', async () => {
    vi.spyOn(api, 'getSchedule').mockImplementation(async (query) => {
      const base = scheduleForRange(query.from, query.to);
      return {
        ...base,
        unit: {
          ...base.unit,
          closedFrom: '2027-02-15',
          closedTo: null,
          closedLabel: 'Closed from 15 Feb 2027',
          closedReason: 'Renovation (demo)',
        },
      };
    });
    renderBoard();
    await screen.findByText('Coverage gaps');
    expect(
      await screen.findByText(/Unit B is closed from Mon 15 Feb 2027 \("Renovation \(demo\)"\)\./),
    ).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  describe('A1: pay period and month views, density and totals', () => {
    it('keeps the week and the full tiles by default', async () => {
      stubVersion();
      renderBoard();
      expect(await screen.findByText('16 – 22 Nov 2026')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('list', { name: 'Board figures' })).not.toBeInTheDocument();
      expect(screen.getByTestId('search').textContent).not.toContain('view=');
    });

    it('shows the pay period, compact, and walks it by periods', async () => {
      stubVersion();
      const schedule = vi.spyOn(api, 'getSchedule');
      const user = userEvent.setup();
      renderBoard('/planning?unit=unit-b');

      await user.click(await screen.findByRole('button', { name: 'Pay period' }));
      expect(await screen.findByText('9 – 22 Nov 2026')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('view=period'));
      expect(
        schedule.mock.calls.some(([query]) => query.from === '2026-11-09' && query.to === '2026-11-22'),
      ).toBe(true);
      // A longer span opens compact: the figures are one strip of chips.
      expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
      const strip = screen.getByRole('list', { name: 'Board figures' });
      expect(within(strip).getAllByRole('listitem')).toHaveLength(5);
      expect(within(strip).getByText('Coverage gaps')).toBeInTheDocument();
      expect(within(strip).getByText('In overtime')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Pay period' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Next period' }));
      expect(await screen.findByText('23 Nov – 6 Dec 2026')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Today' }));
      expect(await screen.findByText('9 – 22 Nov 2026')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
      vi.restoreAllMocks();
    });

    it('opens a month from the address, at most 31 days', async () => {
      stubVersion();
      const schedule = vi.spyOn(api, 'getSchedule');
      renderBoard('/planning?view=month&week=2026-12-07');

      expect(await screen.findByText('1 – 31 Dec 2026')).toBeInTheDocument();
      expect(
        schedule.mock.calls.some(([query]) => query.from === '2026-12-01' && query.to === '2026-12-31'),
      ).toBe(true);
      expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it('keeps a density choice in the address and switches back to the tiles', async () => {
      stubVersion();
      const user = userEvent.setup();
      renderBoard('/planning?view=period');

      await user.click(await screen.findByRole('button', { name: 'Comfortable' }));
      await waitFor(() =>
        expect(screen.getByTestId('search').textContent).toContain('density=comfortable'),
      );
      expect(screen.queryByRole('list', { name: 'Board figures' })).not.toBeInTheDocument();
      // Back to the week: its own default density again.
      await user.click(screen.getByRole('button', { name: 'Week' }));
      await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('density='));
      expect(screen.getByTestId('search').textContent).not.toContain('view=');
    });

    it('adds shifts and hours in view per officer, a day-totals footer and qualification badges', async () => {
      renderBoard();
      const roster = await screen.findByRole('region', { name: 'Roster, scrolls sideways' });
      expect(within(roster).getByRole('columnheader', { name: /Shifts · h/ })).toBeInTheDocument();
      expect(within(roster).getByRole('rowheader', { name: 'On duty · hours' })).toBeInTheDocument();
      expect(within(roster).getAllByLabelText(/^\d+ shifts?, \d+(\.\d)? h in this view$/).length).toBeGreaterThan(0);
      expect(within(roster).getAllByLabelText(/^\d+ on duty, \d+(\.\d)? h$/)).toHaveLength(7);
      expect(within(roster).getAllByRole('img', { name: /^Qualified: / }).length).toBeGreaterThan(0);
    });
  });
});
