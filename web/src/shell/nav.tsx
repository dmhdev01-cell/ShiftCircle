import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { aboutNavItem, roles } from './roles';
import type { NavItem, Role, RoleDescriptor } from './roles';

interface RoleContextValue {
  role: RoleDescriptor;
  setRole: (role: Role) => void;
  nav: NavItem[];
}

const RoleContext = createContext<RoleContextValue | null>(null);

/** Holds the mocked signed-in role. The real sign-in screen is not designed yet. */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [roleId, setRoleId] = useState<Role>('SUPERVISOR');

  const value = useMemo<RoleContextValue>(() => {
    const role = roles.find((r) => r.id === roleId) ?? roles[0];
    return { role, setRole: setRoleId, nav: [...role.nav, aboutNavItem] };
  }, [roleId]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const value = useContext(RoleContext);
  if (!value) {
    throw new Error('useRole must be used inside a RoleProvider');
  }
  return value;
}
