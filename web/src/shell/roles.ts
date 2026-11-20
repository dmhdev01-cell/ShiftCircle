/**
 * Roles and navigation for the scaffold.
 *
 * Roles and nav items follow docs/ui/README.md §4 (role-specific side nav) and
 * the routes listed in §5 and §6. Sign-in is mocked on purpose: §6 leaves the
 * sign-in picker undesigned and the prototype deliberately has no runtime AI.
 */

export type Role = 'SUPERVISOR' | 'EMPLOYEE' | 'RULES_ADMIN' | 'RULES_APPROVER';

export interface NavItem {
  label: string;
  to: string;
  /** The screen has no design yet (docs/ui/README.md §6) - shown muted. */
  muted?: boolean;
}

export interface RoleDescriptor {
  id: Role;
  label: string;
  /** Synthetic demo user shown in the top bar role chip. */
  user: string;
  nav: NavItem[];
}

export const roles: RoleDescriptor[] = [
  {
    id: 'SUPERVISOR',
    label: 'Supervisor',
    user: 'M. Ellis',
    nav: [
      { label: 'Planning board', to: '/planning' },
      { label: 'Overtime', to: '/overtime' },
      { label: 'Reports', to: '/reports/coverage' },
      { label: 'Rules', to: '/rules/7/rest-between-shifts' },
      { label: 'Wall display', to: '/display' },
      { label: 'Employee view', to: '/me/schedule' },
      { label: 'Time & attendance', to: '/time', muted: true },
      { label: 'Proposals inbox', to: '/proposals', muted: true },
    ],
  },
  {
    id: 'EMPLOYEE',
    label: 'Employee',
    user: 'N. Thompson',
    nav: [
      { label: 'My schedule', to: '/me/schedule' },
      { label: 'Propose shifts', to: '/me/propose', muted: true },
      { label: 'My hours', to: '/me/hours', muted: true },
      { label: 'Supervisor view', to: '/planning' },
    ],
  },
  {
    id: 'RULES_ADMIN',
    label: 'Rules admin',
    user: 'L. Fraser',
    nav: [
      { label: 'Rules', to: '/rules/7/rest-between-shifts' },
      { label: 'Shift types', to: '/rules/7/shift-types', muted: true },
      { label: 'Rule version review', to: '/rules/7/review', muted: true },
    ],
  },
  {
    id: 'RULES_APPROVER',
    label: 'Rules approver',
    user: 'P. Singh',
    nav: [
      { label: 'Rules', to: '/rules/7/rest-between-shifts' },
      { label: 'Rule version review', to: '/rules/7/review', muted: true },
    ],
  },
];

/** Reachable from every role; hosts the build/version display. */
export const aboutNavItem: NavItem = { label: 'About & version', to: '/about' };
