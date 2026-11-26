import type { DemoUser } from '../api/types';
import { aboutNavItem, navFor, roleForUser } from './roles';

/**
 * Where each role lands after signing in
 * (docs/ui/build-notes.md §2.1).
 */
export function destinationFor(user: DemoUser): string {
  if (user.roles.includes('PLANNER')) return '/planner';
  if (user.roles.includes('SUPERVISOR')) return '/planning';
  if (user.roles.includes('RULES_ADMIN')) return '/rules/draft/rest-between-shifts';
  if (user.roles.includes('RULES_APPROVER')) return '/rules';
  if (user.roles.includes('AUDITOR')) return '/reports/coverage';
  if (user.roles.includes('DISPLAY')) return '/display';
  return '/me/schedule';
}

/** The first path segment: "/rules/7/rest-between-shifts?x" -> "rules". */
function section(path: string): string {
  return path.replace(/[?#].*$/, '').split('/')[1] ?? '';
}

/**
 * Where a sign-in sends this user: back to the route that asked for the
 * sign-in when that route is in their own menu, else their role's landing.
 * A remembered route from someone else's session (the bare address once
 * remembered "/planning" for everyone) would show an officer, a rules user
 * or the wall display "This account may not do that" (install verification,
 * 26 Nov 2026).
 */
export function landingFor(user: DemoUser, from: string | null): string {
  const home = destinationFor(user);
  if (!from) return home;
  const allowed = new Set(
    [...navFor(roleForUser(user), user), aboutNavItem].map((item) => section(item.to)).concat(section(home)),
  );
  return allowed.has(section(from)) ? from : home;
}
