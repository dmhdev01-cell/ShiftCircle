import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
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
    await user.click(screen.getByRole('radio', { name: 'Days' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sun' }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Saved. The next plan will use these.')).toBeInTheDocument();
    expect(screen.getByText('Saved 21 Nov, 08:55')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear preferences' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Cleared.')).toBeInTheDocument();
  });

  it('shows the planner every officer\'s wishes, read-only', async () => {
    const user = userEvent.setup();
    renderAt('/planner/preferences');
    await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');

    expect(await screen.findByRole('heading', { name: 'Officer preferences' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Tara Nakamura')).toBeInTheDocument();
    expect(within(table).getByText('8 h')).toBeInTheDocument();
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
});
