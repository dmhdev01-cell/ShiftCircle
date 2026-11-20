import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { api } from '../api/client';
import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderBoard(path = '/overtime') {
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

describe('the overtime board', () => {
  it('lists the open shifts with their status', async () => {
    renderBoard();

    const list = await screen.findByRole('region', { name: 'Open shifts' });
    expect(within(list).getByText('Sat 21 Nov · Days 07:00 – 15:00')).toBeInTheDocument();
    expect(within(list).getByText('Fri 20 Nov · Evenings 15:00 – 23:00')).toBeInTheDocument();
    expect(within(list).getByText('Sun 22 Nov · Nights 23:00 – 07:00 +1')).toBeInTheDocument();
    expect(within(list).getByText('Open')).toBeInTheDocument();
    expect(within(list).getByText('Offers sent')).toBeInTheDocument();
    expect(within(list).getByText('Filled')).toBeInTheDocument();
  });

  it('keeps the officers who were skipped in their place in the ranking', async () => {
    renderBoard();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);

    expect(within(rows[0]).getByText('Leah Morin')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Aiden Bergeron')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Sam Abara')).toBeInTheDocument();
    // The skipped officer is still in the list, with the reason the api sent.
    expect(within(rows[1]).getAllByText('Skipped').length).toBeGreaterThan(0);
    expect(
      within(rows[1]).getByText('Night shift ends Sat 07:00: no rest. Keeps their place.'),
    ).toBeInTheDocument();
  });

  it('offers a Select only to the officers who can take the shift', async () => {
    renderBoard();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);

    // Leah is on vacation, Aiden would break a rest rule.
    expect(within(rows[0]).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(rows[1]).queryByRole('checkbox')).not.toBeInTheDocument();
    // Sam is eligible, Tara is eligible with a warning.
    expect(within(rows[2]).getByRole('checkbox')).toBeInTheDocument();
    expect(within(rows[4]).getByText('Eligible · warning')).toBeInTheDocument();
  });

  it('shows the overtime hours and the seniority the api ranked on', async () => {
    renderBoard();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);

    expect(within(rows[2]).getByText('8.0 h')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Nov 2016')).toBeInTheDocument();
  });

  it('records an offer for the officers the supervisor selected', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('checkbox', { name: 'Select Sam Abara for this shift' }));

    const offer = screen.getByRole('button', { name: 'Offer to selected (1)' });
    expect(offer).toBeEnabled();

    await user.click(offer);

    expect(await screen.findByText(/1 offer recorded/)).toBeInTheDocument();
  });

  it('will not offer anything until an officer is selected', async () => {
    renderBoard();

    const offer = await screen.findByRole('button', { name: 'Offer to selected (0)' });
    expect(offer).toBeDisabled();
  });

  it('shows the fair-distribution order the api ranked on', async () => {
    renderBoard();

    expect(await screen.findByText(/Fair-distribution order \(O-02, rule tables v7\)/)).toBeInTheDocument();
    expect(screen.getByText(/skipped without losing their place/)).toBeInTheDocument();
  });

  it('B1: acknowledging a warning on a direct assign assigns the open shift', async () => {
    const user = userEvent.setup();
    const assignOpenShift = vi.spyOn(api, 'assignOpenShift');
    const saveChange = vi.spyOn(api, 'saveChange');
    renderBoard();

    // Tara is eligible with a warning, so the acknowledge path is offered.
    await user.click(await screen.findByRole('checkbox', { name: 'Select Tara Nakamura for this shift' }));
    await user.click(screen.getByRole('button', { name: 'Assign directly…' }));

    await screen.findByRole('heading', { name: /Assign Tara/ });
    await user.click(await screen.findByRole('button', { name: 'Acknowledge and assign' }));

    expect(assignOpenShift).toHaveBeenCalled();
    expect(saveChange).not.toHaveBeenCalled();
    assignOpenShift.mockRestore();
    saveChange.mockRestore();
  });

  it('shows the offer history, with a confirm action for an accepted offer', async () => {
    renderBoard();

    expect(await screen.findByText('Offer history')).toBeInTheDocument();
    expect(screen.getByText('Fri evenings → Ruth Okafor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('opens the shift named in the "Find eligible officer" link', async () => {
    renderBoard('/overtime?shift=os-fri-evenings');

    expect(
      await screen.findByRole('heading', { name: /Fri 20 Nov · Evenings/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Sat 21 Nov · Days/ })).not.toBeInTheDocument();
  });

  it('matches a link that names the unit and start instead of the shift id', async () => {
    renderBoard(
      `/overtime?unit=admissions&startAt=${encodeURIComponent('2026-11-22T23:00:00-06:00')}`,
    );

    expect(
      await screen.findByRole('heading', { name: /Sun 22 Nov · Nights/ }),
    ).toBeInTheDocument();
  });

  it('E2: an offer reaches the employee, comes back accepted, and can be confirmed', async () => {
    const user = userEvent.setup();
    const supervisor = renderBoard();

    // The supervisor offers the Saturday day shift to Sam.
    await user.click(
      await screen.findByRole('checkbox', { name: 'Select Sam Abara for this shift' }),
    );
    await user.click(screen.getByRole('button', { name: 'Offer to selected (1)' }));
    expect(await screen.findByText(/1 offer recorded/)).toBeInTheDocument();
    supervisor.unmount();

    // The employee sees the offer and accepts it.
    const employee = renderBoard('/me/schedule');
    const regions = await screen.findAllByRole('region', { name: 'Overtime offer' });
    const offered = regions.find(
      (region) =>
        within(region).queryByText(/Sat 21 Nov/) && within(region).queryByText(/07:00 – 15:00/),
    );
    expect(offered).toBeDefined();
    await user.click(within(offered as HTMLElement).getByRole('button', { name: 'Accept' }));
    expect(
      await within(offered as HTMLElement).findByText(/Accepted/),
    ).toBeInTheDocument();
    employee.unmount();

    // The supervisor sees the answer and confirms it (S-04).
    renderBoard();
    const accepted = await screen.findByRole('group', { name: 'Sam Abara · Accepted' });
    await user.click(within(accepted).getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByRole('group', { name: 'Sam Abara · Confirmed' }),
    ).toBeInTheDocument();
  });
});
