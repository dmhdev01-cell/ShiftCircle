import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RoleProvider, useRole } from './nav';

// The real-api build, where the sign-in screen is a real gate: the fixtures
// demo is the only build that offers the role switch.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, usingFixtures: false };
});

function NavProbe() {
  const { nav } = useRole();
  return <div data-testid="nav">{nav.map((item) => item.label).join(' | ')}</div>;
}

describe('the role navigation', () => {
  it('is empty for a signed-out visitor in the api build', () => {
    // D8: with no session the role fell back to SUPERVISOR, so the sign-in
    // screen offered the supervisor's nine links to someone who cannot use them.
    render(
      <RoleProvider>
        <NavProbe />
      </RoleProvider>,
    );

    expect(screen.getByTestId('nav')).toHaveTextContent(/^$/);
  });
});
