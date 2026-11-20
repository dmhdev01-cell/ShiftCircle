import { describe, expect, it } from 'vitest';

import type { DemoUser } from '../api/types';
import { roleForUser } from './roles';

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
