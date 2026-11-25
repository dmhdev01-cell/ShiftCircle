import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { sortOffers } from './useMySchedule';
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

    expect(await screen.findByText(/Declined\. Thank you/)).toBeInTheDocument();
  });

  it('lets a keyboard reach the calendar when it scrolls sideways on a phone', async () => {
    renderMySchedule();

    const calendar = await screen.findByRole('region', { name: /^Calendar, / });
    expect(calendar).toHaveAttribute('tabindex', '0');
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
  // Demo verification D1: an offer sent while My schedule was open only showed
  // after a page refresh, and it was the 4th card, below the fold.
  it('D1: lists open offers first, the newest first', async () => {
    const [base] = await api.getMyOffers();
    const offer = (id: string, offeredAt: string, status: typeof base.status) => ({
      ...base,
      id,
      offeredAt,
      status,
    });
    const sorted = sortOffers([
      offer('dec-13', '2026-11-19T08:00:00-06:00', 'OFFERED'),
      offer('done', '2026-11-24T10:00:00-06:00', 'ACCEPTED'),
      offer('nov-25', '2026-11-20T08:00:00-06:00', 'OFFERED'),
      offer('nov-21', '2026-11-24T09:07:00-06:00', 'OFFERED'),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['nov-21', 'nov-25', 'dec-13', 'done']);
    // Review S3: a time that parses comes before one that does not.
    expect(
      sortOffers([offer('old', '14:20', 'OFFERED'), offer('new', new Date().toISOString(), 'OFFERED')]).map(
        (entry) => entry.id,
      ),
    ).toEqual(['new', 'old']);
    // Times that do not parse keep the api's order among themselves.
    expect(
      sortOffers([offer('a', '14:20', 'OFFERED'), offer('b', '15:05', 'OFFERED')]).map((entry) => entry.id),
    ).toEqual(['a', 'b']);
  });

  it('D1: fetches the offers again when the window regains focus or becomes visible', async () => {
    const offers = await api.getMyOffers();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const spy = vi.spyOn(api, 'getMyOffers').mockResolvedValue([offers[0]]);

    renderMySchedule();
    await screen.findByText(/Sam Abara/);
    expect(await screen.findAllByRole('region', { name: 'Overtime offer' })).toHaveLength(1);

    // A supervisor sends a second offer while the page is open.
    spy.mockResolvedValue([offers[0], offers[1]]);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findAllByRole('region', { name: 'Overtime offer' })).toHaveLength(2);

    // Later, the tab becomes visible again: another fetch.
    now += 5_000;
    const calls = spy.mock.calls.length;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(spy.mock.calls.length).toBe(calls + 1);

    // A failed background refresh keeps the offers on screen, with a quiet note.
    now += 5_000;
    spy.mockRejectedValue(new Error('offline'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getAllByRole('region', { name: 'Overtime offer' })).toHaveLength(2);
    expect(await screen.findByText(/could not be refreshed just now/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  // Review S2: one return to the tab fires visibilitychange and focus; that is
  // one GET, and an older answer that arrives late does not replace a newer one.
  it('S2: one return sends one request, and a late older answer is dropped', async () => {
    const offers = await api.getMyOffers();
    let now = 2_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const spy = vi.spyOn(api, 'getMyOffers').mockResolvedValue([offers[0]]);

    renderMySchedule();
    await screen.findByText(/Sam Abara/);
    expect(await screen.findAllByRole('region', { name: 'Overtime offer' })).toHaveLength(1);
    const afterMount = spy.mock.calls.length;

    // One return: both events, one request. This request is slow.
    let resolveOld: (value: typeof offers) => void = () => undefined;
    spy.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(spy.mock.calls.length).toBe(afterMount + 1);

    // The next return answers quickly with the newer list (two offers).
    now += 5_000;
    spy.mockResolvedValueOnce([offers[0], offers[1]]);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(spy.mock.calls.length).toBe(afterMount + 2);
    expect(await screen.findAllByRole('region', { name: 'Overtime offer' })).toHaveLength(2);

    // The slow, older request now answers with no offers: it is ignored.
    await act(async () => {
      resolveOld([]);
    });
    expect(screen.getAllByRole('region', { name: 'Overtime offer' })).toHaveLength(2);
    expect(screen.queryByText('No overtime is offered to you right now.')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
