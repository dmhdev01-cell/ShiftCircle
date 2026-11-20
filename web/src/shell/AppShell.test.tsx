import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { RoleProvider } from './nav';
import { theme } from '../theme/theme';

const DISCLAIMER = 'Not an official Government of Saskatchewan service · fictional, synthetic data only';

function renderShell(path = '/planning') {
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

describe('AppShell', () => {
  it('shows the required footer disclaimer on every screen', () => {
    const { unmount } = renderShell('/planning');
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    unmount();

    renderShell('/overtime');
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it('renders the supervisor navigation', () => {
    renderShell('/planning');
    const nav = screen.getByRole('navigation', { name: 'Main' });

    for (const label of [
      'Planning board',
      'Overtime',
      'Reports',
      'Rules',
      'Wall display',
      'Employee view',
      'Time & attendance',
      'About & version',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the current page in the navigation', () => {
    renderShell('/overtime');
    const nav = screen.getByRole('navigation', { name: 'Main' });

    expect(within(nav).getByRole('link', { name: 'Overtime' })).toHaveClass('active');
    expect(within(nav).getByRole('link', { name: 'Planning board' })).not.toHaveClass('active');
  });

  it('shows the app name, the facility line and the mock role chip in the top bar', () => {
    renderShell('/planning');
    const banner = screen.getByRole('banner');

    expect(within(banner).getByText('ShiftCircle')).toBeInTheDocument();
    expect(
      within(banner).getByText('Prairie Provincial Correctional Centre · prototype, fictional data'),
    ).toBeInTheDocument();
    expect(within(banner).getByText('Supervisor · M. Ellis')).toBeInTheDocument();
    expect(within(banner).getByText('(mock sign-in)')).toBeInTheDocument();
  });

  it('switches the navigation when the mock sign-in role changes', async () => {
    const user = userEvent.setup();
    renderShell('/planning');

    await user.selectOptions(screen.getByLabelText('Mock sign-in: choose a role'), 'EMPLOYEE');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My schedule' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Propose shifts' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Overtime' })).not.toBeInTheDocument();
    expect(screen.getByText('Employee · N. Thompson')).toBeInTheDocument();
  });

  it('does not use a government logo, wheat sheaf or coat of arms', () => {
    const { container } = renderShell('/planning');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/coat of arms|wheat sheaf/i);
  });
});
