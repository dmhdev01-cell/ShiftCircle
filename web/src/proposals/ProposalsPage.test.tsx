import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { createHttpApi } from '../api/http';
import { ShiftChip } from '../components/ShiftChip';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { BLOCKED_BY_RULES } from '../api/types';

/**
 * v1.3 P4: the Proposals inbox, the decider's side, against the fixtures
 * (M. Ellis, Units A and B; Tara waiting with two shifts, Ellis's own
 * proposal, Omar declined).
 */

function renderInbox(path = '/proposals') {
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

type User = ReturnType<typeof userEvent.setup>;

async function shiftRow(name: RegExp) {
  const list = await screen.findByRole('list', { name: 'Shifts in this proposal' });
  return within(list).getByRole('listitem', { name });
}

const SAT_21 = /^Sat 21 Nov · D8 07:00 – 15:00 · Unit B/;
const SAT_28 = /^Sat 28 Nov · E8 15:00 – 23:00 · Unit B/;

async function choose(user: User, row: HTMLElement, choice: 'Approve' | 'Decline') {
  await user.click(within(row).getByRole('radio', { name: choice }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Proposals inbox (v1.3 P4)', () => {
  it('shows the waiting count in the nav for a supervisor, under Overtime', async () => {
    renderInbox('/planning');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    // Ellis's own proposal is not his to decide, so the count is Tara's alone.
    const link = await within(nav).findByRole('link', { name: 'Proposals (1)' });
    const labels = within(nav).getAllByRole('link').map((entry) => entry.textContent);
    expect(labels.indexOf('Proposals (1)')).toBe(labels.indexOf('Overtime') + 1);
    expect(link).toHaveAttribute('href', '/proposals');
  });

  it('shows the inbox to the planner too, under Quarter plan', async () => {
    const user = userEvent.setup();
    renderInbox('/planning');
    await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), 'PLANNER');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await within(nav).findByRole('link', { name: /^Proposals/ });
    const labels = within(nav).getAllByRole('link').map((entry) => entry.textContent ?? '');
    expect(labels[labels.indexOf('Quarter plan') + 1]).toMatch(/^Proposals/);
  });

  it('lists the waiting proposals and opens the first, with the note as text and the hours', async () => {
    renderInbox();
    const list = await screen.findByRole('list', { name: 'Proposals' });
    const cards = within(list).getAllByRole('button');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Tara Nakamura');
    expect(cards[0]).toHaveTextContent('Unit B · 2 shifts');
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true');
    expect(cards[1]).toHaveTextContent('Yours');

    const pane = screen.getByRole('region', { name: 'Selected proposal' });
    expect(await within(pane).findByRole('heading', { name: 'Tara Nakamura' })).toBeInTheDocument();
    expect(within(pane).getByText('Free both Saturdays. Happy to take nights if that helps more.')).toBeInTheDocument();
    expect(within(pane).getByText('72 h of 80 h this pay period')).toBeInTheDocument();
    expect(within(pane).getByText('Approaching')).toBeInTheDocument();
  });

  it('filters Waiting / All and by unit', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'getProposalInbox');
    renderInbox();
    const list = await screen.findByRole('list', { name: 'Proposals' });
    expect(within(list).queryByText('Omar Reid')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(await within(screen.getByRole('list', { name: 'Proposals' })).findByText('Omar Reid')).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith({ status: 'ALL' });

    const unit = screen.getByLabelText('Unit');
    await waitFor(() => expect(within(unit).getAllByRole('option').length).toBeGreaterThan(1));
    const option = within(unit).getAllByRole('option')[1] as HTMLOptionElement;
    await user.selectOptions(unit, option.value);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ status: 'ALL', unitId: option.value }));
  });

  it('says when nothing is waiting', async () => {
    vi.spyOn(api, 'getProposalInbox').mockResolvedValue([]);
    renderInbox();
    expect(
      await screen.findByText('No proposals waiting. When officers propose shifts, they appear here.'),
    ).toBeInTheDocument();
  });

  it('shows the rules when sent and now, "was / now" when they moved, the overtime and the open-shift match', async () => {
    renderInbox();
    const saturday = await shiftRow(SAT_21);
    const group = within(saturday).getByRole('group', { name: 'Rule result' });
    expect(within(group).getAllByText('Passes')).toHaveLength(2);
    expect(within(group).queryByText(/Changed since it was sent/)).not.toBeInTheDocument();
    expect(
      within(saturday).getByText(
        'Matches an open shift: Tara is 3rd of 12 in the overtime order. Approving fills it.',
      ),
    ).toBeInTheDocument();

    const evening = await shiftRow(SAT_28);
    expect(
      within(evening).getByText('Changed since it was sent: Was Passes, now Warning · U-14'),
    ).toBeInTheDocument();
    expect(
      within(evening).getByText('Would be overtime: 8 h · brings Tara to 88 h of 80 h in this pay period'),
    ).toBeInTheDocument();
    expect(
      within(evening).getByText('No open shift for this slot: approving adds an extra shift above minimum.'),
    ).toBeInTheDocument();
  });

  it('keeps Send off until every shift has a choice and a decline has a comment', async () => {
    const user = userEvent.setup();
    renderInbox();
    const send = await screen.findByRole('button', { name: 'Send decision (0 accepted, 0 declined)' });
    expect(send).toBeDisabled();
    expect(screen.getByText('Choose Approve or Decline for every shift.')).toBeInTheDocument();

    await choose(user, await shiftRow(SAT_21), 'Decline');
    await choose(user, await shiftRow(SAT_28), 'Decline');
    const counted = screen.getByRole('button', { name: 'Send decision (0 accepted, 2 declined)' });
    expect(counted).toBeDisabled();
    expect(screen.getByText('Each declined shift needs a comment, so the officer knows why.')).toBeInTheDocument();
    await user.type(within(await shiftRow(SAT_21)).getByLabelText('Comment for Tara (required)'), 'Fully staffed');
    await user.type(within(await shiftRow(SAT_28)).getByLabelText('Comment for Tara (required)'), 'Fully staffed');
    expect(counted).toBeEnabled();
  });

  it('asks for the warning and the overtime-order acknowledgements separately, then sends', async () => {
    const user = userEvent.setup();
    const decide = vi.spyOn(api, 'decideProposal');
    renderInbox();
    const saturday = await shiftRow(SAT_21);
    const evening = await shiftRow(SAT_28);
    await choose(user, saturday, 'Approve');
    await choose(user, evening, 'Decline');
    await user.type(within(evening).getByLabelText('Comment for Tara (required)'), 'Unit is fully staffed that night');

    // The day shift matches an open shift where Tara is 3rd: its own confirmation.
    const order = within(saturday).getByRole('checkbox', {
      name: "I'm approving outside the overtime order (Tara is 3rd of 12)",
    });
    expect(within(saturday).queryByRole('checkbox', { name: /acknowledge the warning/ })).not.toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' });
    expect(send).toBeDisabled();
    expect(screen.getByText('Confirm that you are approving outside the overtime order.')).toBeInTheDocument();
    await user.click(order);
    expect(send).toBeEnabled();

    // Now approve the evening too: its U-14 warning needs acknowledging.
    await choose(user, evening, 'Approve');
    const ack = within(evening).getByRole('checkbox', {
      name: 'I acknowledge the warning (U-14) and approve anyway',
    });
    expect(within(evening).queryByRole('checkbox', { name: /overtime order/ })).not.toBeInTheDocument();
    const both = screen.getByRole('button', { name: 'Send decision (2 accepted, 0 declined)' });
    expect(both).toBeDisabled();
    await user.click(ack);
    expect(both).toBeEnabled();
    await user.click(both);

    expect(decide).toHaveBeenCalledWith('inbox-tara', 0, [
      { id: 'inbox-tara-1', accept: true, acknowledgeWarnings: [], acknowledgeOutOfOrder: true },
      {
        id: 'inbox-tara-2',
        accept: true,
        comment: 'Unit is fully staffed that night',
        acknowledgeWarnings: ['U-14'],
      },
    ]);
    expect(
      await screen.findByText(/^Sent\. Accepted shifts are on the planning board\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the board for the week of Sat 21 Nov' })).toHaveAttribute(
      'href',
      '/planning?unit=unit-b&week=2026-11-21',
    );
    expect(within(await shiftRow(SAT_21)).getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Send decision/ })).not.toBeInTheDocument();
    // The nav count follows.
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'Proposals (0)' })).toBeInTheDocument();
  });

  it('declines with a comment and shows it as text', async () => {
    const user = userEvent.setup();
    renderInbox();
    for (const name of [SAT_21, SAT_28]) {
      const row = await shiftRow(name);
      await choose(user, row, 'Decline');
      await user.type(within(row).getByLabelText('Comment for Tara (required)'), '<b>Fully</b> staffed');
    }
    await user.click(screen.getByRole('button', { name: 'Send decision (0 accepted, 2 declined)' }));
    expect(await screen.findByText(/^Sent\. Tara sees the outcome/)).toBeInTheDocument();
    const row = await shiftRow(SAT_21);
    expect(within(row).getByText('Declined by M. Ellis: “<b>Fully</b> staffed”')).toBeInTheDocument();
    expect(row.querySelector('b')).toBeNull();
  });

  it('shows a refusal inline with the fresh result: a Block can only be declined, and there is no override', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'decideProposal').mockRejectedValueOnce(
      new ApiError('A shift you approved breaks a rule now', 422, {
        type: BLOCKED_BY_RULES,
        title: 'A shift you approved breaks a rule now',
        status: 422,
        items: [
          {
            id: 'inbox-tara-1',
            unit: 'B',
            shiftTemplate: 'D8',
            startAt: '2026-11-21T07:00:00-06:00',
            outcome: 'BLOCK',
            warnCodes: [],
            ruleResults: [
              {
                ruleCode: 'U-01',
                ruleTable: 'REST',
                outcome: 'BLOCK',
                overridePolicy: 'EMERGENCY',
                message: 'Only 0 h of rest after the night shift ending 07:00.',
              },
            ],
            otOrderPosition: 3,
            otOrderSize: 12,
            outOfOrder: true,
          },
        ],
      }),
    );
    renderInbox();
    const saturday = await shiftRow(SAT_21);
    await choose(user, saturday, 'Approve');
    await user.click(within(saturday).getByRole('checkbox', { name: /outside the overtime order/ }));
    const evening = await shiftRow(SAT_28);
    await choose(user, evening, 'Decline');
    await user.type(within(evening).getByLabelText('Comment for Tara (required)'), 'Not needed');
    await user.click(screen.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not sent: A shift you approved breaks a rule now. The rules were checked again just now',
    );
    expect(within(saturday).getByText('Changed since it was sent: Was Passes, now Blocked · U-01')).toBeInTheDocument();
    expect(within(saturday).getByText('Only 0 h of rest after the night shift ending 07:00.')).toBeInTheDocument();
    expect(within(saturday).getByRole('radio', { name: 'Approve' })).toBeDisabled();
    expect(within(saturday).getByRole('note')).toHaveTextContent(/can't be approved from a proposal/);
    // No acknowledgement can make a Block approvable, so none is offered.
    expect(within(saturday).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' })).toBeDisabled();
    expect(screen.getByText("A Blocked shift can't be approved from a proposal. Decline it.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /override/i })).not.toBeInTheDocument();

    // Declining it is the way out.
    await choose(user, saturday, 'Decline');
    await user.type(within(saturday).getByLabelText('Comment for Tara (required)'), 'Rest rule');
    expect(screen.getByRole('button', { name: 'Send decision (0 accepted, 2 declined)' })).toBeEnabled();
  });

  it('shows a new warning from a refusal and asks for it to be acknowledged', async () => {
    const user = userEvent.setup();
    const decide = vi.spyOn(api, 'decideProposal').mockRejectedValueOnce(
      new ApiError('Warnings need acknowledgement', 422, {
        type: 'https://shiftcircle.local/problems/warnings-need-acknowledgement',
        title: 'Warnings need acknowledgement',
        status: 422,
        items: [
          {
            id: 'inbox-tara-2',
            unit: 'B',
            shiftTemplate: 'E8',
            startAt: '2026-11-28T15:00:00-06:00',
            outcome: 'WARN',
            warnCodes: ['U-14', 'U-02'],
            ruleResults: [
              { ruleCode: 'U-14', ruleTable: 'HOURS', outcome: 'WARN', overridePolicy: 'ACKNOWLEDGE', message: 'Week over 48 h.' },
              { ruleCode: 'U-02', ruleTable: 'REST', outcome: 'WARN', overridePolicy: 'ACKNOWLEDGE', message: 'Short rest.' },
            ],
          },
        ],
      }),
    );
    renderInbox();
    const saturday = await shiftRow(SAT_21);
    await choose(user, saturday, 'Decline');
    await user.type(within(saturday).getByLabelText('Comment for Tara (required)'), 'Not needed');
    const evening = await shiftRow(SAT_28);
    await choose(user, evening, 'Approve');
    await user.click(within(evening).getByRole('checkbox', { name: /acknowledge the warning \(U-14\)/ }));
    await user.click(screen.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' }));

    await screen.findByRole('alert');
    const ack = within(evening).getByRole('checkbox', {
      name: 'I acknowledge the warnings (U-14, U-02) and approve anyway',
    });
    expect(ack).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' })).toBeDisabled();
    await user.click(ack);
    await user.click(screen.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1][2][1]).toMatchObject({ id: 'inbox-tara-2', acknowledgeWarnings: ['U-14', 'U-02'] });
  });

  it("shows a supervisor's own proposal read-only, waiting for another supervisor", async () => {
    const user = userEvent.setup();
    renderInbox();
    const list = await screen.findByRole('list', { name: 'Proposals' });
    await user.click(within(list).getByRole('button', { name: /Mel Ellis/ }));
    const pane = screen.getByRole('region', { name: 'Selected proposal' });
    expect(await within(pane).findByRole('heading', { name: 'Mel Ellis' })).toBeInTheDocument();
    expect(within(pane).getByRole('note')).toHaveTextContent(
      "Yours: waiting for another supervisor or the planner. You can't approve your own proposal.",
    );
    expect(within(pane).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: /^Send decision/ })).not.toBeInTheDocument();
  });

  it('says plainly when someone else answered first, and reloads', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'decideProposal').mockRejectedValueOnce(
      new ApiError('The shift on 2026-11-21 is accepted. Reload the proposal.', 409),
    );
    const load = vi.spyOn(api, 'getProposal');
    renderInbox();
    for (const name of [SAT_21, SAT_28]) {
      const row = await shiftRow(name);
      await choose(user, row, 'Decline');
      await user.type(within(row).getByLabelText('Comment for Tara (required)'), 'Not needed');
    }
    await user.click(screen.getByRole('button', { name: 'Send decision (0 accepted, 2 declined)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not sent: The shift on 2026-11-21 is accepted. Reload the proposal.',
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('opens the proposal named in the link', async () => {
    renderInbox('/proposals?proposal=inbox-own');
    const pane = screen.getByRole('region', { name: 'Selected proposal' });
    expect(await within(pane).findByRole('heading', { name: 'Mel Ellis' })).toBeInTheDocument();
  });
});

describe('the board chip of a shift from a proposal (v1.3 P4)', () => {
  it('says so in its tooltip and its name', () => {
    render(<ShiftChip template="D8" extra fromProposal context="for Tara on 2026-11-21" onClick={() => undefined} />);
    const chip = screen.getByRole('button', {
      name: 'D · extra for Tara on 2026-11-21 · from an approved proposal',
    });
    expect(chip).toHaveAttribute('title', 'Day 8 h · 07:00 – 15:00 · from an approved proposal');
  });

  it('is unchanged for any other shift', () => {
    render(<ShiftChip template="D8" extra />);
    expect(screen.getByText('D · extra')).not.toHaveAttribute('title', expect.stringMatching(/proposal/));
  });
});

describe('the decider calls on the http api (v1.3 P4)', () => {
  it('sends the decision with If-Match and reads the count', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => (url.includes('/count') ? { status: 'WAITING', count: 3 } : { id: 'p', items: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const http = createHttpApi();

    expect(await http.getProposalCount()).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/proposals/count?status=WAITING');

    await http.decideProposal('p', 4, [{ id: 'i', accept: false, comment: 'No' }]);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/proposals/p/decision');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"4"');
    expect(JSON.parse(init.body as string)).toEqual({ items: [{ id: 'i', accept: false, comment: 'No' }] });

    await http.getProposalInbox({ status: 'ALL', unitId: 'u1' });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/proposals?status=ALL&unitId=u1');
  });
});
