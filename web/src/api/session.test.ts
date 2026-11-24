import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enableSessionPersistence,
  getToken,
  resetSession,
  sessionExpired,
  setSession,
  signOut,
} from './session';
import type { DemoUser } from './types';

const KEY = 'sc.demoSession';
const user = { id: 'u1', displayName: 'M. Ellis', username: 'm.ellis', roles: ['SUPERVISOR'], units: [], employeeId: null } as unknown as DemoUser;

describe('session persistence (ADR-025 amendment)', () => {
  beforeEach(() => resetSession());
  afterEach(() => vi.unstubAllEnvs());

  it('the build-time kill switch keeps it memory-only even on the demo', () => {
    vi.stubEnv('VITE_PERSIST_DEMO_SESSION', 'false');
    enableSessionPersistence();
    setSession('t1', user);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('stays memory-only unless the demo profile enabled persistence', () => {
    setSession('t1', user);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the token in sessionStorage when enabled, and restores it after a reload', () => {
    enableSessionPersistence();
    setSession('t1', user);
    expect(window.sessionStorage.getItem(KEY)).toContain('t1');
    // A reload: the module state is gone, the storage is not.
    const saved = window.sessionStorage.getItem(KEY)!;
    resetSession();
    window.sessionStorage.setItem(KEY, saved);
    enableSessionPersistence();
    expect(getToken()).toBe('t1');
  });

  it('does not restore a saved token when persistence is not enabled (prod-like)', () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ token: 't1', user }));
    expect(getToken()).toBeNull();
  });

  it('clears the saved token on sign-out and on 401', () => {
    enableSessionPersistence();
    setSession('t1', user);
    signOut();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    setSession('t2', user);
    sessionExpired();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('ignores a corrupt saved value', () => {
    window.sessionStorage.setItem(KEY, '{not json');
    enableSessionPersistence();
    expect(getToken()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});
