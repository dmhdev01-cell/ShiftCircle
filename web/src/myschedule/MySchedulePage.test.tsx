import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { createFixtureApi } from '../api/fixtures/api';
import { createHttpApi } from '../api/http';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderMySchedule() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/me/schedule']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('the employee My schedule', () => {
  it('shows the officer and their own hours', async () => {
    renderMySchedule();

    // The heading is drawn while loading and again when the answers land, so
    // wait for the officer's line and then read the heading from the page that
    // is actually on screen.
    expect(await screen.findByText(/Sam Abara · Correctional officer/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My schedule' })).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('of 80 h')).toBeInTheDocument();
    expect(screen.getByText('60 h worked · 12 h still scheduled')).toBeInTheDocument();
    expect(screen.getByText('8.0 h')).toBeInTheDocument();
    expect(screen.getByText(/Rank 41 of 100 on the overtime list/)).toBeInTheDocument();
  });

  it('shows the next shift with the ADR-015 times', async () => {
    renderMySchedule();

    expect(await screen.findByText('Next shift')).toBeInTheDocument();
    expect(screen.getAllByText(/23:00 – 07:00 \+1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Night 8 h · Unit B/)).toBeInTheDocument();
  });

  it('shows a month calendar with the weekday headings', async () => {
    renderMySchedule();

    expect(await screen.findByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }
  });

  it('shows every pending overtime offer, not only the first', async () => {
    renderMySchedule();

    await screen.findByText(/Sam Abara/);

    // Two offers are waiting; an officer must not miss one.
    const offers = screen.getAllByRole('region', { name: 'Overtime offer' });
    expect(offers).toHaveLength(2);
    expect(screen.getByText('Sat 21 Nov · Evening 8 h 15:00 – 23:00')).toBeInTheDocument();
    expect(screen.getByText('Sun 22 Nov · Night 8 h 23:00 – 07:00 +1')).toBeInTheDocument();
    expect(screen.getByText(/offered by M. Ellis at 14:20/)).toBeInTheDocument();
    expect(screen.getByText(/offered by M. Ellis at 15:05/)).toBeInTheDocument();
    // Only the offer the api sent a rule result for claims a check.
    expect(screen.getAllByText('Rules OK for you')).toHaveLength(1);
  });

  it('offers Accept and Decline on each pending offer', async () => {
    renderMySchedule();

    await screen.findByText(/Sam Abara/);

    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Decline' })).toHaveLength(2);
  });

  it('records the acceptance and says the supervisor confirms it', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    await screen.findByText(/Sam Abara/);
    await user.click(screen.getAllByRole('button', { name: 'Accept' })[0]);

    expect(
      await screen.findByText('Accepted. Your supervisor will confirm the assignment.'),
    ).toBeInTheDocument();
  });

  it('records the decline', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    await screen.findByText(/Sam Abara/);
    await user.click(screen.getAllByRole('button', { name: 'Decline' })[0]);

    expect(await screen.findByText(/Declined/)).toBeInTheDocument();
  });

  it('checks the rules on a proposed shift and shows the block', async () => {
    const user = userEvent.setup();
    renderMySchedule();

    const planner = await screen.findByRole('region', { name: 'Propose shifts' });
    await user.click(within(planner).getByRole('button', { name: 'Add a shift' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /A12 · 12 h 00–12/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add and check the rules' }));

    // The A12 the day after a P12 leaves no rest, so the rules block it.
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText(/No rest after the 12 h shift that ends Wed 25 Nov 24:00/)).toBeInTheDocument();
  });

  it('M1: says sending a proposal is not available, and sends nothing', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderMySchedule();

    const planner = await screen.findByRole('region', { name: 'Propose shifts' });
    const note = within(planner).getByRole('note', { name: 'Sending a proposal' });
    expect(note).toHaveTextContent(/not available in this prototype/);
    // No send button and no note field that would lead to a 404.
    expect(within(planner).queryByRole('button', { name: 'Send to supervisor' })).toBeNull();
    expect(within(planner).queryByLabelText('Note to your supervisor')).toBeNull();
    // The rule check still works.
    await user.click(within(planner).getByRole('button', { name: 'Add a shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add and check the rules' }));
    expect(await within(planner).findByText(/add A12/)).toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes('/proposals')),
    ).toBe(false);
    fetchSpy.mockRestore();
  });

  it('M1: neither api offers a proposal call to reach the missing endpoint', () => {
    expect('submitProposals' in api).toBe(false);
    expect('submitProposals' in createHttpApi()).toBe(false);
    expect('submitProposals' in createFixtureApi()).toBe(false);
  });

  it('B4: does not claim a rule check the api did not send', async () => {
    renderMySchedule();

    await screen.findByText(/Sam Abara/);

    // The second offer has no rule results, so no check is claimed for it.
    const offers = screen.getAllByRole('region', { name: 'Overtime offer' });
    expect(within(offers[1]).queryByText('Rules OK for you')).not.toBeInTheDocument();
    // The first offer has a passing rule result, so the check is shown.
    expect(within(offers[0]).getByText('Rules OK for you')).toBeInTheDocument();
  });

  it('B5: does not promise overtime rates on the offer', async () => {
    renderMySchedule();

    await screen.findByText(/Sam Abara/);

    expect(screen.queryByText(/paid at overtime rates/)).not.toBeInTheDocument();
    // Overtime is a pay-period status, not a rate (ADR-016), and the sentence
    // has to read as a sentence.
    expect(screen.queryByText(/paid counts toward/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/count toward your pay-period hours/).length).toBeGreaterThan(0);
  });

  it('explains its chips and offer states in a key', async () => {
    // Observation #1: the calendar's chips had no key.
    renderMySchedule();

    const key = await screen.findByRole('region', { name: 'Key' });
    expect(within(key).getByText(/rostered shift, with its times/)).toBeInTheDocument();
    expect(within(key).getAllByText('Sick').length).toBeGreaterThan(0);
    expect(within(key).getAllByText('Vacation').length).toBeGreaterThan(0);
    expect(within(key).getByText(/Offers: waiting for reply/)).toBeInTheDocument();
  });

  it('shows no colleague hours or absences', async () => {
    renderMySchedule();

    expect(await screen.findByText(/Sam Abara/)).toBeInTheDocument();
    // Only the signed-in officer appears.
    expect(screen.queryByText('Tara Nakamura')).not.toBeInTheDocument();
    expect(screen.queryByText('Ruth Okafor')).not.toBeInTheDocument();
  });

  it('writes when an offer was made in plain words, and never an empty "offered by"', async () => {
    // V11: the api sends an instant and sometimes no name; the card printed
    // "offered by  at 2026-11-20T08:45:47.911291-06:00".
    const offers = await api.getMyOffers();
    expect(offers.length).toBeGreaterThan(0);
    vi.spyOn(api, 'getMyOffers').mockResolvedValue([
      { ...offers[0], offeredBy: '', offeredAt: '2026-11-20T08:45:47.911291-06:00' },
    ]);

    renderMySchedule();

    expect(await screen.findByText(/offered 20 Nov 08:45/)).toBeInTheDocument();
    expect(screen.queryByText(/offered by\s+at/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-11-20T08:45/)).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
