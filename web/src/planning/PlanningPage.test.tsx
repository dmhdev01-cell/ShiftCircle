import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';

function renderBoard() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/planning']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
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
    expect(screen.queryByText('D12')).not.toBeInTheDocument();
    expect(screen.queryByText('N12')).not.toBeInTheDocument();
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
    expect(await screen.findByText('Blocked: 2 rules fail')).toBeInTheDocument();
    expect(screen.getByText(/U-01 · Minimum rest/)).toBeInTheDocument();
  });

  it('reads Off on the empty cells and only offers an assignment for today or later', async () => {
    renderBoard();

    expect(
      await screen.findByRole('button', {
        name: /assign a shift to Aiden Bergeron on 2026-11-19/,
      }),
    ).toBeInTheDocument();
  });

  it('offers a skip link straight to the roster', async () => {
    renderBoard();

    const link = await screen.findByRole('link', { name: 'Skip to roster' });
    expect(link).toHaveAttribute('href', '#roster');
    expect(document.getElementById('roster')).not.toBeNull();
  });

  it('B2: an emergency override acknowledges the warnings with it', async () => {
    const user = userEvent.setup();
    renderBoard();

    // PC-01 blocks on U-01 and U-05 and also warns on U-14.
    await user.click(await screen.findByRole('button', { name: /! D proposed for Nia Thompson/ }));
    expect(await screen.findByText('Blocked: 2 rules fail')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Emergency override…' }));
    expect(
      await screen.findByText(/The warnings are acknowledged with the override: U-14/),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Why is this override needed?'),
      'Unit B is short and no eligible officer is left tonight',
    );
    await user.click(screen.getByRole('button', { name: 'Emergency override' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
