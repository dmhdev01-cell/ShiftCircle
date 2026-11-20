import { describe, expect, it } from 'vitest';

import { safeReturnPath } from './returnPath';

/**
 * review-r2 NOTE 1: the sign-in screen navigated to the route the guard put in
 * router state without checking it. Only an in-app absolute path may be used;
 * anything that could leave the app falls back to the role landing page.
 */
describe('the sign-in return path', () => {
  it.each(['/reports/coverage', '/planning?x=1', '/', '/overtime?unit=unit-b&shift=os-sat-days'])(
    'accepts %s',
    (path) => {
      expect(safeReturnPath(path)).toBe(path);
    },
  );

  it.each([
    ['//evil.example', 'protocol-relative host'],
    ['https://evil.example', 'absolute url'],
    ['/\\evil', 'backslash after the slash'],
    ['/reports\\coverage', 'backslash inside the path'],
    ['', 'empty'],
    ['login', 'relative path'],
    ['javascript:alert(1)', 'scheme'],
  ])('rejects %s (%s)', (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it('rejects anything that is not a string', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
    expect(safeReturnPath({ from: '/planning' })).toBeNull();
  });
});
