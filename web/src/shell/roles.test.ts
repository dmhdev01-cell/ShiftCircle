import { describe, expect, it } from 'vitest';

import type { DemoUser } from '../api/types';
import { navFor, REPORTS_ROLES, roleForUser, roles } from './roles';
import type { Role } from './roles';

function user(roles: string[]): DemoUser {
  return {
    id: 'test',
    username: 'test',
    displayName: 'Test User',
    roles,
    units: [],
    employeeId: '',
  };
}

describe('roleForUser', () => {
  it('starts a supervisor who is also an employee on the supervisor screens', () => {
    // The api does not promise an order in roles.
    expect(roleForUser(user(['EMPLOYEE', 'SUPERVISOR'])).id).toBe('SUPERVISOR');
    expect(roleForUser(user(['SUPERVISOR', 'EMPLOYEE'])).id).toBe('SUPERVISOR');
  });

  it('keeps a single-role employee as an employee', () => {
    expect(roleForUser(user(['EMPLOYEE'])).id).toBe('EMPLOYEE');
  });
});

function labels(roleId: Role, who: DemoUser | null): string[] {
  return navFor(roles.find((r) => r.id === roleId)!, who).map((item) => item.label);
}

describe('navFor', () => {
  it('mirrors the api: only supervisors and auditors read the reports', () => {
    // ReportsController: hasAnyRole('SUPERVISOR','AUDITOR').
    expect([...REPORTS_ROLES].sort()).toEqual(['AUDITOR', 'SUPERVISOR']);
  });

  it('hides Reports from the planner, whom the api answers 403', () => {
    expect(labels('PLANNER', user(['PLANNER']))).toEqual(['Quarter plan', 'Preferences', 'Units', 'Planning board']);
    // The fixtures role switch acts as the role alone, with the same answer.
    expect(labels('PLANNER', null)).not.toContain('Reports');
  });

  it('keeps Reports for supervisors and auditors', () => {
    expect(labels('SUPERVISOR', user(['SUPERVISOR', 'EMPLOYEE']))).toContain('Reports');
    expect(labels('AUDITOR', user(['AUDITOR']))).toContain('Reports');
  });

  it('hides Employee view from a user with no linked officer', () => {
    expect(labels('SUPERVISOR', user(['SUPERVISOR', 'EMPLOYEE']))).not.toContain('Employee view');
    expect(labels('SUPERVISOR', { ...user(['SUPERVISOR']), employeeId: 'emp-1' })).toContain('Employee view');
    expect(labels('SUPERVISOR', null)).toContain('Employee view');
  });

  it('every nav item behind the reports check points at a reports screen, and back', () => {
    for (const role of roles) {
      for (const item of role.nav) {
        expect(item.requires === 'reports').toBe(item.to.startsWith('/reports'));
      }
    }
  });
});
