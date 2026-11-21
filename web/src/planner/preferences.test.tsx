import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderAt(path: string) {
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

describe('preferences', () => {
  it('saves the officer\'s own wishes and says they are wishes', async () => {
    const user = userEvent.setup();
    renderAt('/me/schedule');

    expect(await screen.findByRole('heading', { name: 'My preferences' })).toBeInTheDocument();
    expect(screen.getByText(/These are wishes, not guarantees/)).toBeInTheDocument();
    expect(screen.getByText('Not set yet')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '8 h' }));
    await user.click(screen.getByRole('checkbox', { name: 'Days' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sun' }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Saved. The next plan will use these.')).toBeInTheDocument();
    expect(screen.getByText('Saved 21 Nov, 08:55')).toBeInTheDocument();

    // An edit after the save makes the green message stale.
    await user.click(screen.getByRole('checkbox', { name: 'Sat' }));
    expect(screen.queryByText('Saved. The next plan will use these.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear preferences' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Cleared.')).toBeInTheDocument();
  });

  it('lets an officer choose more than one time of day, with No preference as the empty set', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(api, 'putMyPreferences');
    renderAt('/me/schedule');
    await screen.findByRole('heading', { name: 'My preferences' });

    const days = screen.getByRole('checkbox', { name: 'Days' });
    const evenings = screen.getByRole('checkbox', { name: 'Evenings' });
    const nights = screen.getByRole('checkbox', { name: 'Nights' });
    const none = screen.getByRole('checkbox', { name: 'No preference' });
    // No preference is the empty set and is the starting state.
    expect(none).toBeChecked();

    await user.click(days);
    await user.click(evenings);
    expect(none).not.toBeChecked();
    // The nights note is about the 12 h crews and appears only when Nights is chosen.
    expect(screen.queryByText(/Only 12-hour night crews work nights/)).not.toBeInTheDocument();
    await user.click(nights);
    expect(screen.getByText(/Only 12-hour night crews work nights/)).toBeInTheDocument();
    await user.click(nights);

    // No preference clears every part; ticking a part clears No preference.
    await user.click(none);
    expect(days).not.toBeChecked();
    expect(evenings).not.toBeChecked();
    expect(none).toBeChecked();
    await user.click(days);
    expect(none).not.toBeChecked();

    await user.click(evenings);
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ timesOfDay: ['DAY', 'EVENING'] }));
    expect(put.mock.calls[0][0]).not.toHaveProperty('timeOfDay');
    vi.restoreAllMocks();
  });

  it('shows the planner every officer\'s wishes, read-only', async () => {
    const user = userEvent.setup();
    renderAt('/planner/preferences');
    await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');

    expect(await screen.findByRole('heading', { name: 'Officer preferences' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Tara Nakamura')).toBeInTheDocument();
    expect(within(table).getByText('8 h')).toBeInTheDocument();
    // A set reads in words and never as raw enum text.
    expect(within(table).getByText('Evenings, Nights')).toBeInTheDocument();
    expect(within(table).queryByText(/EVENING|NIGHT/)).not.toBeInTheDocument();
    // No draft in the fixtures until one is generated: every row says so.
    expect(within(table).getAllByText('No draft').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 officers · 3 gave preferences/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Find an officer'), 'sam');
    expect(within(table).getByText('Sam Abara')).toBeInTheDocument();
    expect(within(table).queryByText('Tara Nakamura')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Find an officer'));
    await user.click(screen.getByRole('checkbox', { name: 'Not met only' }));
    expect(within(table).queryByText('Tara Nakamura')).not.toBeInTheDocument();
  });

  it("lets the planner set an 8 h pattern, and shows a 12 h officer's crew pattern read-only", async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(api, 'setPlannerOfficerPattern');
    renderAt('/planner/preferences');
    await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');

    const select = await screen.findByLabelText('Pattern for Tara Nakamura');
    expect(select).toHaveValue('ROTATING_5_2');
    await user.selectOptions(select, '7_ON_3_OFF');
    expect(put).toHaveBeenCalledWith('emp-tara', '7_ON_3_OFF');
    expect(await screen.findByLabelText('Pattern for Tara Nakamura')).toHaveValue('7_ON_3_OFF');

    // A 12 h officer keeps the crew pattern: words, no picker.
    expect(screen.queryByLabelText('Pattern for Ruth Okafor')).not.toBeInTheDocument();
    expect(screen.getByText('4 on, 4 off')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
