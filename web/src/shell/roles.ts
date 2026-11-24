/**
 * Roles and navigation for the scaffold.
 *
 * Roles and nav items follow docs/ui/README.md §4 (role-specific side nav) and
 * the routes listed in §5 and §6. Sign-in is mocked on purpose: §6 leaves the
 * sign-in picker undesigned and the prototype deliberately has no runtime AI.
 */

import type { DemoUser } from '../api/types';

export type Role =
  | 'SUPERVISOR'
  | 'EMPLOYEE'
  | 'RULES_ADMIN'
  | 'RULES_APPROVER'
  | 'AUDITOR'
  | 'DISPLAY'
  | 'PLANNER';

export interface NavItem {
  label: string;
  to: string;
  /** The screen has no design yet (docs/ui/README.md §6) - shown muted. */
  muted?: boolean;
  /**
   * The item is shown only when the signed-in user can use the screen:
   * 'reports' needs one of REPORTS_ROLES, 'employeeRecord' a linked officer.
   */
  requires?: 'reports' | 'employeeRecord';
}

/**
 * The roles the api lets read the reports: ReportsController's coverage,
 * overtime and overrides endpoints are hasAnyRole('SUPERVISOR','AUDITOR')
 * (docs/09-access-control.md §2). Keep the two in step.
 */
export const REPORTS_ROLES: readonly string[] = ['SUPERVISOR', 'AUDITOR'];

export interface RoleDescriptor {
  id: Role;
  label: string;
  /** Synthetic demo user shown in the top bar when nobody has signed in. */
  user: string;
  nav: NavItem[];
}

/** The role names in plain words (docs/09-access-control.md §1). */
export const ROLE_WORDS: Record<string, string> = {
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Employee',
  RULES_ADMIN: 'Rules admin',
  RULES_APPROVER: 'Rules approver',
  AUDITOR: 'Auditor',
  DISPLAY: 'Display',
  PLANNER: 'Planner',
};

/** The demo user the fixtures role switch acts as, by role. */
export const DEMO_USER_FOR_ROLE: Record<Role, string> = {
  SUPERVISOR: 'M. Ellis',
  EMPLOYEE: 'T. Nakamura',
  RULES_ADMIN: 'L. Fraser',
  RULES_APPROVER: 'P. Singh',
  AUDITOR: 'A. Reviewer',
  DISPLAY: 'Unit office TV',
  PLANNER: 'P. Planner',
};

export const roles: RoleDescriptor[] = [
  {
    id: 'SUPERVISOR',
    label: 'Supervisor',
    user: 'M. Ellis',
    nav: [
      { label: 'Planning board', to: '/planning' },
      { label: 'Overtime', to: '/overtime' },
      { label: 'Reports', to: '/reports/coverage', requires: 'reports' },
      { label: 'Rules', to: '/rules/7/rest-between-shifts' },
      { label: 'Audit log', to: '/audit' },
      { label: 'Wall display', to: '/display' },
      { label: 'Employee view', to: '/me/schedule', requires: 'employeeRecord' },
      { label: 'Time & attendance', to: '/time' },
    ],
  },
  {
    id: 'EMPLOYEE',
    label: 'Employee',
    user: 'N. Thompson',
    nav: [
      { label: 'My schedule', to: '/me/schedule' },
    ],
  },
  {
    id: 'RULES_ADMIN',
    label: 'Rules admin',
    user: 'L. Fraser',
    nav: [
      { label: 'Rules', to: '/rules' },
    ],
  },
  {
    id: 'RULES_APPROVER',
    label: 'Rules approver',
    user: 'P. Singh',
    nav: [
      { label: 'Rules', to: '/rules' },
    ],
  },
  {
    id: 'AUDITOR',
    label: 'Auditor',
    user: 'A. Reviewer',
    nav: [
      { label: 'Planning board', to: '/planning' },
      { label: 'Reports', to: '/reports/coverage', requires: 'reports' },
      { label: 'Rules', to: '/rules' },
      { label: 'Audit log', to: '/audit' },
      { label: 'Wall display', to: '/display' },
    ],
  },
  {
    id: 'DISPLAY',
    label: 'Display',
    user: 'Unit office TV',
    nav: [{ label: 'Wall display', to: '/display' }],
  },
  {
    // The facility planner plans the whole quarter for every unit; the board
    // is read-only for them (docs/ui/planner.md §1, §11 Q1).
    id: 'PLANNER',
    label: 'Planner',
    user: 'P. Planner',
    nav: [
      { label: 'Quarter plan', to: '/planner' },
      { label: 'Preferences', to: '/planner/preferences' },
      { label: 'Units', to: '/planner/units' },
      { label: 'Planning board', to: '/planning' },
      { label: 'Reports', to: '/reports/coverage', requires: 'reports' },
    ],
  },
];

/**
 * The role's nav items this user can use. The planner holds no reports role,
 * so the api answers 403 and the Reports item only led to an error; an account
 * with no linked officer gets 404 from My schedule, so Employee view led to
 * "No employee record for this user". `user` is null in the fixtures demo,
 * which acts as the role alone and keeps the employee view.
 */
export function navFor(role: RoleDescriptor, user: DemoUser | null): NavItem[] {
  const heldRoles = user ? user.roles : [role.id];
  return role.nav.filter((item) => {
    if (item.requires === 'reports') return heldRoles.some((id) => REPORTS_ROLES.includes(id));
    if (item.requires === 'employeeRecord') return user === null || Boolean(user.employeeId);
    return true;
  });
}

/** Reachable from every role; hosts the build/version display. */
export const aboutNavItem: NavItem = { label: 'About & version', to: '/about' };

/**
 * The role a signed-in user acts as. The api does not promise an order in
 * `roles`, so choose by what the role can do, not by array position:
 * a supervisor who is also an employee starts on the supervisor screens.
 */
const ROLE_PRECEDENCE: Role[] = [
  'PLANNER',
  'SUPERVISOR',
  'RULES_ADMIN',
  'RULES_APPROVER',
  'AUDITOR',
  'EMPLOYEE',
  'DISPLAY',
];

export function roleForUser(user: DemoUser): RoleDescriptor {
  for (const id of ROLE_PRECEDENCE) {
    if (user.roles.includes(id)) {
      return roles.find((entry) => entry.id === id)!;
    }
  }
  return roles.find((descriptor) => descriptor.id === 'SUPERVISOR')!;
}
