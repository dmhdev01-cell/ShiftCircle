import type { DemoUser } from '../api/types';

/**
 * Where each role lands after signing in
 * (docs/ui/build-notes.md §2.1).
 */
export function destinationFor(user: DemoUser): string {
  if (user.roles.includes('SUPERVISOR')) return '/planning';
  if (user.roles.includes('RULES_ADMIN')) return '/rules/draft/rest-between-shifts';
  if (user.roles.includes('RULES_APPROVER')) return '/rules';
  if (user.roles.includes('AUDITOR')) return '/reports/coverage';
  if (user.roles.includes('DISPLAY')) return '/display';
  return '/me/schedule';
}
