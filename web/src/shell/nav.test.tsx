import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { demoUsers } from '../api/fixtures/demoUsers';
import { resetSession, setSession } from '../api/session';
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

function signedInAs(displayName: string, employeeId = '') {
  const user = demoUsers.find((u) => u.displayName === displayName)!;
  setSession('token', { ...user, employeeId });
}

afterEach(() => resetSession());

describe('the role navigation', () => {
  it('is empty for a signed-out visitor in the api build', () => {
    // D8: with no session the role fell back to SUPERVISOR, so the sign-in
    // screen offered the supervisor's links to someone who cannot use them.
    render(
      <RoleProvider>
        <NavProbe />
      </RoleProvider>,
    );

    expect(screen.getByTestId('nav')).toHaveTextContent(/^$/);
  });

  it('offers the planner no Reports link, since the api answers 403', () => {
    signedInAs('P. Planner');
    render(
      <RoleProvider>
        <NavProbe />
      </RoleProvider>,
    );

    expect(screen.getByTestId('nav')).toHaveTextContent(
      /^Quarter plan \| Proposals \| Preferences \| Units \| Planning board \| About & version$/,
    );
  });

  it('offers a supervisor with no linked officer no Employee view', () => {
    signedInAs('M. Ellis');
    render(
      <RoleProvider>
        <NavProbe />
      </RoleProvider>,
    );

    expect(screen.getByTestId('nav')).toHaveTextContent('Reports');
    expect(screen.getByTestId('nav')).not.toHaveTextContent('Employee view');
  });

  it('offers Employee view to a supervisor with a linked officer', () => {
    signedInAs('M. Ellis', 'emp-1');
    render(
      <RoleProvider>
        <NavProbe />
      </RoleProvider>,
    );

    expect(screen.getByTestId('nav')).toHaveTextContent('Employee view');
  });
});
