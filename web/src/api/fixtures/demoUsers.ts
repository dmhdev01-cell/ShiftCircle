/**
 * The demo users for the mock sign-in (docs/09-access-control.md §4). They are
 * fictional, and the list is the one the api sends.
 */

import type { DemoUser } from '../types';

export const demoUsers: DemoUser[] = [
  {
    id: 'm-ellis',
    name: 'M. Ellis',
    roles: ['SUPERVISOR', 'EMPLOYEE'],
    scope: 'Units A, B',
  },
  {
    id: 'j-chen',
    name: 'J. Chen',
    roles: ['SUPERVISOR', 'EMPLOYEE'],
    scope: 'Admissions, Control, Escort & transport',
  },
  {
    id: 't-nakamura',
    name: 'T. Nakamura',
    roles: ['EMPLOYEE'],
    scope: 'No unit scope',
  },
  {
    id: 'l-fraser',
    name: 'L. Fraser',
    roles: ['RULES_ADMIN'],
    scope: 'No unit scope',
  },
  {
    id: 'p-singh',
    name: 'P. Singh',
    roles: ['RULES_APPROVER'],
    scope: 'No unit scope',
  },
  {
    id: 'a-reviewer',
    name: 'A. Reviewer',
    roles: ['AUDITOR'],
    scope: 'All units',
  },
  {
    id: 'unit-office-tv',
    name: 'Unit office TV',
    roles: ['DISPLAY'],
    scope: 'All units (counts only)',
  },
];
