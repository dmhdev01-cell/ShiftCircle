import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShell } from './AppShell';
import { ErrorBoundary } from './ErrorBoundary';
import { RoleProvider } from './nav';
import { theme } from '../theme/theme';

const DISCLAIMER =
  'Not an official Government of Saskatchewan service · fictional, synthetic data only';

/** A screen that throws, the way a bad field from the api makes one throw. */
function ThrowingScreen(): never {
  throw new Error('Cannot read properties of null (reading toFixed)');
}

function renderShell(children: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/planning']}>
          <AppShell>{children}</AppShell>
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('a screen that throws', () => {
  it('says so in plain words instead of leaving a blank page', () => {
    // React logs the error; the test does not need the noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderShell(
      <ErrorBoundary>
        <ThrowingScreen />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This screen could not be shown');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the navigation and the footer working', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderShell(
      <ErrorBoundary>
        <ThrowingScreen />
      </ErrorBoundary>,
    );

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Planning board' })).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it('gives the screen another chance when Try again is pressed', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let broken = true;
    function SometimesBroken() {
      if (broken) {
        throw new Error('The screen could not read the data.');
      }
      return <p>The screen is back.</p>;
    }

    renderShell(
      <ErrorBoundary>
        <SometimesBroken />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('The screen is back.')).toBeInTheDocument();
  });
});

describe('the shell', () => {
  it('catches a screen that throws and keeps the navigation and the footer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // The shell puts the boundary around the screen, so the person still sees
    // where they are and can go somewhere else.
    renderShell(<ThrowingScreen />);

    expect(screen.getByRole('alert')).toHaveTextContent('This screen could not be shown');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Planning board' })).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });
});
