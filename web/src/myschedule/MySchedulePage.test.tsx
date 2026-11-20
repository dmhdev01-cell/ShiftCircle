import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
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

  it('will not send a proposal without a note to the supervisor', async () => {
    renderMySchedule();

    const planner = await screen.findByRole('region', { name: 'Propose shifts' });
    expect(within(planner).getByRole('button', { name: 'Send to supervisor' })).toBeDisabled();
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

  it('shows no colleague hours or absences', async () => {
    renderMySchedule();

    expect(await screen.findByText(/Sam Abara/)).toBeInTheDocument();
    // Only the signed-in officer appears.
    expect(screen.queryByText('Tara Nakamura')).not.toBeInTheDocument();
    expect(screen.queryByText('Ruth Okafor')).not.toBeInTheDocument();
  });
});
