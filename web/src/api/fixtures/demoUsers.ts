/**
 * The demo users for the mock sign-in (docs/09-access-control.md §4). They are
 * fictional, and the list is the shape the api sends: units are codes, and an
 * account without an officer has an empty employeeId.
 */

import type { DemoUser } from '../types';

export const demoUsers: DemoUser[] = [
  {
    id: 'm-ellis',
    username: 'm.ellis',
    displayName: 'M. Ellis',
    roles: ['SUPERVISOR', 'EMPLOYEE'],
    units: ['A', 'B'],
    employeeId: '',
  },
  {
    id: 'j-chen',
    username: 'j.chen',
    displayName: 'J. Chen',
    roles: ['SUPERVISOR', 'EMPLOYEE'],
    units: ['ADM', 'CTL', 'ESC'],
    employeeId: '',
  },
  {
    id: 't-nakamura',
    username: 't.nakamura',
    displayName: 'T. Nakamura',
    roles: ['EMPLOYEE'],
    units: [],
    employeeId: '',
  },
  {
    id: 'l-fraser',
    username: 'l.fraser',
    displayName: 'L. Fraser',
    roles: ['RULES_ADMIN'],
    units: [],
    employeeId: '',
  },
  {
    id: 'p-singh',
    username: 'p.singh',
    displayName: 'P. Singh',
    roles: ['RULES_APPROVER'],
    units: [],
    employeeId: '',
  },
  {
    id: 'a-reviewer',
    username: 'a.reviewer',
    displayName: 'A. Reviewer',
    roles: ['AUDITOR'],
    units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC'],
    employeeId: '',
  },
  {
    id: 'p-planner',
    username: 'p.planner',
    displayName: 'P. Planner',
    roles: ['PLANNER'],
    units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC'],
    employeeId: '',
  },
  {
    id: 'unit-office-tv',
    username: 'tv.display',
    displayName: 'Unit office TV',
    roles: ['DISPLAY'],
    units: ['A', 'B', 'C', 'ADM', 'CTL', 'ESC'],
    employeeId: '',
  },
];
