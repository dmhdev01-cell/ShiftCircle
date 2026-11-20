import { describe, expect, it } from 'vitest';
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

  it('offers an assignment on the empty cells', async () => {
    renderBoard();

    expect(
      await screen.findByRole('button', { name: 'Assign a shift to Aiden Bergeron on 2026-11-19' }),
    ).toBeInTheDocument();
  });
});
