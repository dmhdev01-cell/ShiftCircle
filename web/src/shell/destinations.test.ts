import { describe, expect, it } from 'vitest';

import type { DemoUser } from '../api/types';
import { destinationFor, landingFor } from './destinations';

// The eight demo users as the api sends them: Ellis, Chen and Nakamura have
// officer records (release v1.3 S4), the others none.
const USERS: DemoUser[] = [
  { id: 'm-ellis', username: 'm.ellis', displayName: 'M. Ellis', roles: ['SUPERVISOR', 'EMPLOYEE'], units: ['A', 'B'], employeeId: 'e-ellis' },
  { id: 'j-chen', username: 'j.chen', displayName: 'J. Chen', roles: ['SUPERVISOR', 'EMPLOYEE'], units: ['ADM'], employeeId: 'e-chen' },
  { id: 't-nakamura', username: 't.nakamura', displayName: 'T. Nakamura', roles: ['EMPLOYEE'], units: [], employeeId: 'e-tara' },
  { id: 'l-fraser', username: 'l.fraser', displayName: 'L. Fraser', roles: ['RULES_ADMIN'], units: [], employeeId: '' },
  { id: 'p-singh', username: 'p.singh', displayName: 'P. Singh', roles: ['RULES_APPROVER'], units: [], employeeId: '' },
  { id: 'a-reviewer', username: 'a.reviewer', displayName: 'A. Reviewer', roles: ['AUDITOR'], units: ['A'], employeeId: '' },
  { id: 'p-planner', username: 'p.planner', displayName: 'P. Planner', roles: ['PLANNER'], units: ['A'], employeeId: '' },
  { id: 'unit-office-tv', username: 'tv.display', displayName: 'Unit office TV', roles: ['DISPLAY'], units: ['A'], employeeId: '' },
];

const user = (name: string) => USERS.find((entry) => entry.displayName === name)!;

describe('where a sign-in lands', () => {
  // [user, home, where a remembered /planning?week=… leads]
  const CASES: [string, string, string][] = [
    ['M. Ellis', '/planning', '/planning?week=2026-11-16'],
    ['J. Chen', '/planning', '/planning?week=2026-11-16'],
    ['T. Nakamura', '/me/schedule', '/me/schedule'],
    ['L. Fraser', '/rules/draft/rest-between-shifts', '/rules/draft/rest-between-shifts'],
    ['P. Singh', '/rules', '/rules'],
    ['A. Reviewer', '/reports/coverage', '/planning?week=2026-11-16'],
    ['P. Planner', '/planner', '/planning?week=2026-11-16'],
    ['Unit office TV', '/display', '/display'],
  ];

  it.each(CASES)('%s: home %s; a remembered Planning board leads to %s', (name, home, fromPlanning) => {
    expect(destinationFor(user(name))).toBe(home);
    expect(landingFor(user(name), null)).toBe(home);
    expect(landingFor(user(name), '/planning?week=2026-11-16')).toBe(fromPlanning);
    // Their own landing, remembered, is always kept.
    expect(landingFor(user(name), home)).toBe(home);
    // About & version is in every menu.
    expect(landingFor(user(name), '/about')).toBe('/about');
  });

  it('keeps a deeper route inside a menu section and drops one outside it', () => {
    expect(landingFor(user('M. Ellis'), '/rules/7/rest-between-shifts')).toBe('/rules/7/rest-between-shifts');
    expect(landingFor(user('M. Ellis'), '/me/schedule')).toBe('/me/schedule');
    expect(landingFor(user('P. Singh'), '/rules/8/review')).toBe('/rules/8/review');
    expect(landingFor(user('T. Nakamura'), '/reports/hours')).toBe('/me/schedule');
    expect(landingFor(user('P. Planner'), '/audit')).toBe('/planner');
    // A supervisor without an officer record has no My schedule.
    expect(landingFor({ ...user('M. Ellis'), employeeId: '' }, '/me/schedule')).toBe('/planning');
  });
});
