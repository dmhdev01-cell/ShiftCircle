import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { usingFixtures } from '../api/client';
import { demoUsers } from '../api/fixtures/demoUsers';
import { getSession, setActingUser, subscribeSession } from '../api/session';
import type { DemoUser } from '../api/types';
import { aboutNavItem, DEMO_USER_FOR_ROLE, roleForUser, roles } from './roles';
import type { NavItem, Role, RoleDescriptor } from './roles';

interface RoleContextValue {
  role: RoleDescriptor;
  /** The signed-in person, or the demo user the role switch chose. */
  userName: string;
  setRole: (role: Role) => void;
  nav: NavItem[];
}

const RoleContext = createContext<RoleContextValue | null>(null);

function demoUserFor(roleId: Role): DemoUser | null {
  const name = DEMO_USER_FOR_ROLE[roleId];
  return demoUsers.find((user) => user.name === name) ?? null;
}

/**
 * Holds the signed-in role.
 *
 * A mock sign-in puts a real token and user in the session store, and the role
 * follows that user. The fixtures demo also offers a role switch, which has no
 * token: it only changes who the demo pretends to be, and it disappears as
 * soon as somebody signs in. In api mode there is no switch at all
 * (docs/ui/build-notes.md §2.1).
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [chosenRoleId, setChosenRoleId] = useState<Role>('SUPERVISOR');

  const value = useMemo<RoleContextValue>(() => {
    const role = session.user ? roleForUser(session.user) : (roles.find((r) => r.id === chosenRoleId) ?? roles[0]);
    return {
      role,
      userName: session.user?.name ?? role.user,
      setRole: (next: Role) => {
        setChosenRoleId(next);
        if (usingFixtures) setActingUser(demoUserFor(next));
      },
      nav: [...role.nav, aboutNavItem],
    };
  }, [chosenRoleId, session.user]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const value = useContext(RoleContext);
  if (!value) {
    throw new Error('useRole must be used inside a RoleProvider');
  }
  return value;
}
