import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api, ApiError } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

/**
 * v1.3 P3: the officer's side of shift proposals on My schedule, against the
 * fixtures (Sam Abara, demo day 19 Nov 2026, Unit B).
 */

function renderMySchedule(path = '/me/schedule') {
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

/** Open Add a shift, pick a day and a shift type, and add it. */
async function addDraft(user: User, date: string, shift: RegExp) {
  const card = await screen.findByRole('region', { name: 'Propose shifts' });
  await user.click(within(card).getByRole('button', { name: 'Add a shift' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: date } });
  await user.click(within(dialog).getByRole('button', { name: shift }));
  await user.click(within(dialog).getByRole('button', { name: 'Add and check the rules' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  return card;
}

function draftRow(card: HTMLElement, name: RegExp) {
  return within(within(card).getByRole('list', { name: 'Draft shifts' })).getByRole('listitem', {
    name,
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Propose shifts (v1.3 P3)', () => {
  it('adds drafts, shows each live result, and removes one', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    const first = draftRow(card, /Sun 22 Nov · D8 07:00 – 15:00 · Unit B/);
    expect(await within(first).findByText('Passes')).toBeInTheDocument();

    await addDraft(user, '2026-11-26', /A12 · 12 h 00–12/);
    const second = draftRow(card, /Thu 26 Nov · A12/);
    expect(await within(second).findByText('Blocked · U-01')).toBeInTheDocument();
    expect(within(second).getByText(/No rest after the 12 h shift/)).toBeInTheDocument();

    await user.click(within(second).getByRole('button', { name: /Remove Thu 26 Nov · A12/ }));
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
    expect(within(card).queryByText(/Thu 26 Nov/)).not.toBeInTheDocument();
  });

  it('checks every draft together with the others', async () => {
    const user = userEvent.setup();
    const preview = vi.spyOn(api, 'previewProposal');
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /N8 · Night 8 h/);
    await addDraft(user, '2026-11-23', /D8 · Day 8 h/);

    const morning = draftRow(card, /Mon 23 Nov · D8/);
    expect(await within(morning).findByText('Blocked · U-01')).toBeInTheDocument();
    expect(within(morning).getByText(/rest after your other draft shift/)).toBeInTheDocument();
    expect(within(morning).getByText('Checked with your other drafts')).toBeInTheDocument();
    // One combined preview with both drafts, not one call per draft.
    expect(preview).toHaveBeenLastCalledWith([
      { unitId: 'unit-b', shiftTemplate: 'N8', startAt: '2026-11-22T23:00:00-06:00' },
      { unitId: 'unit-b', shiftTemplate: 'D8', startAt: '2026-11-23T07:00:00-06:00' },
    ]);
  });

  it('disables Send with the reason while a draft is Blocked', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(api, 'submitProposal');
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    await addDraft(user, '2026-11-26', /A12 · 12 h 00–12/);
    await within(card).findByText('Blocked · U-01');

    const send = within(card).getByRole('button', { name: 'Send to supervisor' });
    expect(send).toBeDisabled();
    expect(within(card).getByText("1 shift can't be sent. Remove it to send the others.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    await user.click(within(card).getByRole('button', { name: /Remove Thu 26 Nov/ }));
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Send to supervisor' })).toBeEnabled());
  });

  it('says Checking and keeps Send off until the answer arrives', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const real = api.previewProposal.bind(api);
    vi.spyOn(api, 'previewProposal').mockImplementation(
      (items) => new Promise((resolve) => (release = () => resolve(real(items)))),
    );
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    expect(within(card).getAllByText('Checking').length).toBeGreaterThan(0);
    expect(within(card).getByRole('button', { name: 'Send to supervisor' })).toBeDisabled();
    expect(within(card).getByText('Checking the rules…')).toBeInTheDocument();
    release();
    expect(await within(card).findByText('Passes')).toBeInTheDocument();
  });

  it('shows a failed check and keeps Send off', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewProposal').mockRejectedValue(
      new ApiError('Two of these shifts overlap.', 400),
    );
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    expect(
      await within(card).findByText('The rules could not be checked: Two of these shifts overlap.'),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Send to supervisor' })).toBeDisabled();
  });

  it('offers Check again after a failed check, and checks again on request', async () => {
    const user = userEvent.setup();
    const real = api.previewProposal.bind(api);
    const preview = vi
      .spyOn(api, 'previewProposal')
      .mockRejectedValueOnce(
        new ApiError('You can do this 60 times a minute. Try again in 42 seconds.', 429),
      )
      .mockImplementation((items) => real(items));
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    expect(
      await within(card).findByText(/The rules could not be checked: You can do this 60 times a minute/),
    ).toBeInTheDocument();
    const calls = preview.mock.calls.length;
    await user.click(within(card).getByRole('button', { name: 'Check again' }));

    expect(await within(card).findByText('Passes')).toBeInTheDocument();
    expect(preview.mock.calls.length).toBe(calls + 1);
    expect(within(card).queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Send to supervisor' })).toBeEnabled();
  });

  it('links to the Propose card and My proposals from the top of the page', async () => {
    renderMySchedule();

    const nav = await screen.findByRole('navigation', { name: 'On this page' });
    expect(within(nav).getByRole('link', { name: 'Propose shifts' })).toHaveAttribute('href', '#propose');
    expect(within(nav).getByRole('link', { name: 'My proposals' })).toHaveAttribute('href', '#my-proposals');
    expect(document.getElementById('propose')).toHaveAccessibleName('Propose shifts');
    expect(document.getElementById('my-proposals')).toHaveAccessibleName('My proposals');
  });

  it('limits the note to 500 characters and says not to include medical details', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    await within(card).findByText('Passes');
    const note = within(card).getByLabelText('Note to your supervisor (optional)');
    expect(within(card).getByText(/Don't include medical details/)).toBeInTheDocument();

    fireEvent.change(note, { target: { value: 'x'.repeat(501) } });
    expect(within(card).getByRole('button', { name: 'Send to supervisor' })).toBeDisabled();
    expect(within(card).getByText('The note is over 500 characters.')).toBeInTheDocument();

    fireEvent.change(note, { target: { value: 'x'.repeat(500) } });
    expect(within(card).getByRole('button', { name: 'Send to supervisor' })).toBeEnabled();
  });

  it('sends with a note, clears the drafts and shows the proposal as Waiting', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(api, 'submitProposal');
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    await within(card).findByText('Passes');
    await user.type(
      within(card).getByLabelText('Note to your supervisor (optional)'),
      'Free that weekend',
    );
    await user.click(within(card).getByRole('button', { name: 'Send to supervisor' }));

    expect(
      await within(card).findByText("Sent to your supervisor. You'll see the answer under My proposals."),
    ).toBeInTheDocument();
    expect(submit).toHaveBeenCalledWith('Free that weekend', [
      { unitId: 'unit-b', shiftTemplate: 'D8', startAt: '2026-11-22T07:00:00-06:00' },
    ]);
    expect(within(card).queryByRole('list', { name: 'Draft shifts' })).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);

    const mine = screen.getByRole('region', { name: 'My proposals' });
    const waiting = await within(mine).findByRole('listitem', { name: /Waiting$/ });
    expect(within(waiting).getByText('Your note: Free that weekend')).toBeInTheDocument();
    expect(within(waiting).getByText('Sun 22 Nov · D8 07:00 – 15:00 · Unit B · Living unit')).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: /Withdraw the proposal/ })).toBeInTheDocument();
  });

  it('shows a refused send and checks the drafts again', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'submitProposal').mockRejectedValue(
      new ApiError('You already have this shift waiting for an answer.', 409),
    );
    const preview = vi.spyOn(api, 'previewProposal');
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    await within(card).findByText('Passes');
    const calls = preview.mock.calls.length;
    await user.click(within(card).getByRole('button', { name: 'Send to supervisor' }));

    expect(
      await within(card).findByRole('alert'),
    ).toHaveTextContent('Not sent: You already have this shift waiting for an answer.');
    await waitFor(() => expect(preview.mock.calls.length).toBeGreaterThan(calls));
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders the note as text, never as markup', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    await within(card).findByText('Passes');
    const markup = '<img src=x onerror="alert(1)"><b>bold</b>';
    fireEvent.change(within(card).getByLabelText('Note to your supervisor (optional)'), {
      target: { value: markup },
    });
    await user.click(within(card).getByRole('button', { name: 'Send to supervisor' }));

    const mine = screen.getByRole('region', { name: 'My proposals' });
    const waiting = await within(mine).findByRole('listitem', { name: /Waiting$/ });
    expect(within(waiting).getByText(`Your note: ${markup}`)).toBeInTheDocument();
    expect(waiting.querySelector('img')).toBeNull();
    expect(waiting.querySelector('b')).toBeNull();
  });

  it('keeps the drafts across a refresh in this tab', async () => {
    const user = userEvent.setup();
    const { unmount } = renderMySchedule();
    await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    unmount();

    renderMySchedule();
    const card = await screen.findByRole('region', { name: 'Propose shifts' });
    expect(draftRow(card, /Sun 22 Nov · D8/)).toBeInTheDocument();
    expect(await within(card).findByText('Passes')).toBeInTheDocument();
  });

  it('still works when the browser refuses storage', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderMySchedule();

    const card = await addDraft(user, '2026-11-22', /D8 · Day 8 h/);
    expect(await within(card).findByText('Passes')).toBeInTheDocument();
  });

  it('offers the active units, with the home unit first chosen', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    const card = await screen.findByRole('region', { name: 'Propose shifts' });
    await user.click(within(card).getByRole('button', { name: 'Add a shift' }));
    const dialog = await screen.findByRole('dialog');
    const unit = within(dialog).getByLabelText('Unit') as HTMLSelectElement;
    expect(unit.value).toBe('unit-b');
    expect(within(unit).getByRole('option', { name: 'Unit B · Living unit (your unit)' })).toBeInTheDocument();
    // Retired L16 is not offered (ADR-029).
    expect(within(dialog).queryByRole('button', { name: /L16/ })).not.toBeInTheDocument();
    // A day on or before the demo day can't be proposed.
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-19' } });
    expect(within(dialog).getByRole('button', { name: 'Add and check the rules' })).toBeDisabled();
  });
});

describe('My proposals (v1.3 P3)', () => {
  it('shows each outcome with the decider and the comment', async () => {
    renderMySchedule();

    const mine = await screen.findByRole('region', { name: 'My proposals' });
    const approved = await within(mine).findByRole('listitem', { name: /Approved$/ });
    expect(within(approved).getByText('Approved by M. Ellis. The shift is on your schedule.')).toBeInTheDocument();
    expect(within(approved).getByText('Your note: Happy to cover the weekend.')).toBeInTheDocument();

    const declined = within(mine).getByRole('listitem', { name: /Declined$/ });
    expect(
      within(declined).getByText('Declined by M. Ellis: “Unit is fully staffed that night”'),
    ).toBeInTheDocument();

    const expired = within(mine).getByRole('listitem', { name: /Expired$/ });
    expect(
      within(expired).getByText('Expired: the shift started before anyone answered.'),
    ).toBeInTheDocument();

    // Nothing decided can be withdrawn.
    expect(within(mine).queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it('withdraws a waiting proposal after a confirm', async () => {
    const user = userEvent.setup();
    const withdraw = vi.spyOn(api, 'withdrawProposal');
    await api.submitProposal('', [
      { unitId: 'unit-b', shiftTemplate: 'D8', startAt: '2026-11-24T07:00:00-06:00' },
    ]);
    renderMySchedule();

    const mine = await screen.findByRole('region', { name: 'My proposals' });
    const waiting = await within(mine).findByRole('listitem', { name: /Waiting$/ });
    await user.click(within(waiting).getByRole('button', { name: /Withdraw the proposal/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Withdraw this proposal?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(withdraw).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(await within(waiting).findByRole('button', { name: /Withdraw the proposal/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw proposal' }),
    );

    expect(await within(mine).findByText(/Withdrawn\. Your supervisor no longer sees it/)).toBeInTheDocument();
    expect(withdraw).toHaveBeenCalledWith(expect.stringMatching(/^prop-fixture-/), 0);
    const withdrawn = await within(mine).findByRole('listitem', { name: /Withdrawn$/ });
    expect(within(withdrawn).queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it('says why a withdraw was refused and reloads', async () => {
    const user = userEvent.setup();
    await api.submitProposal('', [
      { unitId: 'unit-b', shiftTemplate: 'D8', startAt: '2026-11-24T07:00:00-06:00' },
    ]);
    vi.spyOn(api, 'withdrawProposal').mockRejectedValue(
      new ApiError('A shift in this proposal has already been answered.', 409),
    );
    const list = vi.spyOn(api, 'getMyProposals');
    renderMySchedule();

    const mine = await screen.findByRole('region', { name: 'My proposals' });
    const waiting = await within(mine).findByRole('listitem', { name: /Waiting$/ });
    const loads = list.mock.calls.length;
    await user.click(within(waiting).getByRole('button', { name: /Withdraw the proposal/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw proposal' }),
    );

    expect(await within(mine).findByRole('alert')).toHaveTextContent(
      'Not withdrawn: A shift in this proposal has already been answered.',
    );
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(loads));
  });

  it('shows a partly approved proposal with both outcomes', async () => {
    const shift = (id: string, day: string, decision: 'ACCEPTED' | 'DECLINED', comment: string | null) => ({
      id,
      unitId: 'unit-b',
      unit: 'B',
      unitName: 'Unit B · Living unit',
      shiftTemplate: 'E8',
      startAt: `${day}T15:00:00-06:00`,
      endAt: `${day}T23:00:00-06:00`,
      workDate: day,
      decision,
      outcomeAtSubmit: 'WARN' as const,
      decidedBy: 'P. Planner',
      decidedAt: '2026-11-19T17:00:00Z',
      comment,
    });
    vi.spyOn(api, 'getMyProposals').mockResolvedValue([
      {
        id: 'p-partly',
        status: 'DECIDED',
        displayState: 'PARTLY_APPROVED',
        note: null,
        submittedAt: '2026-11-18T15:00:00Z',
        withdrawnAt: null,
        version: 2,
        canWithdraw: false,
        items: [
          shift('a', '2026-11-21', 'ACCEPTED', null),
          shift('d', '2026-11-29', 'DECLINED', 'Sunday is covered already.'),
        ],
      },
    ]);
    renderMySchedule();

    const mine = await screen.findByRole('region', { name: 'My proposals' });
    const item = await within(mine).findByRole('listitem', { name: /: Partly approved$/ });
    expect(within(item).getByText('Partly approved')).toBeInTheDocument();
    expect(within(item).getByText('Approved')).toBeInTheDocument();
    expect(within(item).getByText('Declined')).toBeInTheDocument();
    expect(within(item).getByText('Approved by P. Planner. The shift is on your schedule.')).toBeInTheDocument();
    expect(within(item).getByText('Declined by P. Planner: “Sunday is covered already.”')).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    expect(within(item).queryByText(/Part of this proposal has been answered/)).not.toBeInTheDocument();
  });

  it('tells the officer to ask once part of a proposal is answered', async () => {
    vi.spyOn(api, 'getMyProposals').mockResolvedValue([
      {
        id: 'p-part',
        status: 'WAITING',
        displayState: 'WAITING',
        note: null,
        submittedAt: '2026-11-18T15:00:00Z',
        withdrawnAt: null,
        version: 1,
        canWithdraw: false,
        items: [
          {
            id: 'i1',
            unitId: 'unit-b',
            unit: 'B',
            unitName: 'Unit B · Living unit',
            shiftTemplate: 'D8',
            startAt: '2026-11-25T07:00:00-06:00',
            endAt: '2026-11-25T15:00:00-06:00',
            workDate: '2026-11-25',
            decision: 'ACCEPTED',
            outcomeAtSubmit: 'PASS',
            decidedBy: 'M. Ellis',
            decidedAt: '2026-11-19T15:00:00Z',
            comment: null,
          },
          {
            id: 'i2',
            unitId: 'unit-c',
            unit: 'C',
            unitName: 'Unit C · Living unit',
            shiftTemplate: 'D8',
            startAt: '2026-11-27T07:00:00-06:00',
            endAt: '2026-11-27T15:00:00-06:00',
            workDate: '2026-11-27',
            decision: 'PENDING',
            outcomeAtSubmit: 'WARN',
            decidedBy: null,
            decidedAt: null,
            comment: null,
          },
        ],
      },
    ]);
    renderMySchedule();

    const mine = await screen.findByRole('region', { name: 'My proposals' });
    const item = await within(mine).findByRole('listitem', { name: /Waiting$/ });
    expect(within(item).getByText(/Part of this proposal has been answered/)).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    expect(within(item).getAllByText('Waiting').length).toBeGreaterThan(0);
    expect(within(item).getByText('Approved')).toBeInTheDocument();
  });

  it('says so when nothing was sent, and when the list cannot load', async () => {
    const spy = vi.spyOn(api, 'getMyProposals').mockResolvedValue([]);
    const { unmount } = renderMySchedule();
    const mine = await screen.findByRole('region', { name: 'My proposals' });
    expect(await within(mine).findByText("You haven't sent any proposals yet.")).toBeInTheDocument();
    unmount();

    spy.mockRejectedValue(new ApiError('Could not reach the API.', 0));
    renderMySchedule();
    const again = await screen.findByRole('region', { name: 'My proposals' });
    expect(await within(again).findByRole('alert')).toHaveTextContent(
      'Could not load your proposals: Could not reach the API.',
    );
  });
});
