import { checkCommit } from './scripts/commit-guard.cjs';

/**
 * Refuse to run the real-api e2e suite against the wrong build or against the
 * person's trial stack (operator request, after a run mutated their data). The
 * rules live in scripts/commit-guard.cjs, which has its own node:test.
 */
export default async function globalSetup(): Promise<void> {
  await checkCommit();
}
