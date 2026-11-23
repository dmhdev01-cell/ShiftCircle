import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn, signInAgain } from './support';

/**
 * The committed planner state (V6 read API): after a commit the plan's tabs
 * stay, a reload keeps them, and the report shows the FTE bands.
 *
 * Self-contained: it commits whatever state the stack is in (generates when
 * there is no draft, commits an open draft, or uses the plan already committed),
 * so it runs alone or after any other spec.
 */

interface PlanState {
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  defaultSeed: number;
  draft?: { id: string } | null;
  committedDraft?: { id: string } | null;
}

test.describe('the committed quarter plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the planner needs the real api');
  });

  test('@api keeps its tabs after a reload, with the FTE bands', async ({ page, request }) => {
    test.setTimeout(180000);
    const api = await apiAs(request, 'p.planner');
    let plan = await api.get<PlanState>('/planner/plan');

    if (plan.state === 'NONE') {
      const draft = await api.post('/planner/drafts', { seed: plan.defaultSeed });
      expect([200, 201]).toContain(draft.status);
      plan = { ...plan, state: 'DRAFT', draft: { id: (draft.body as { id: string }).id } };
    }
    if (plan.state === 'DRAFT') {
      const id = plan.draft!.id;
      const preview = await api.get<{ version: number; warningCount: number }>(
        `/planner/drafts/${id}/commit-preview`,
      );
      const committed = await api.postIfMatch(`/planner/drafts/${id}/commit`, preview.version, {
        acceptedWarningCount: preview.warningCount,
      });
      expect(committed.status).toBe(200);
      plan = await api.get<PlanState>('/planner/plan');
    }
    expect(plan.state).toBe('COMMITTED');
    expect(plan.committedDraft?.id, 'the committed read API sends committedDraft').toBeTruthy();

    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');

    // The committed plan's own summary answers the read-only tabs.
    await expect(page.getByRole('tab', { name: 'Scorecard' })).toBeVisible();
    await expect(page.getByText('Committed').first()).toBeVisible();
    // The FTE bands and the api's plain note.
    await expect(
      page.getByRole('heading', { name: 'Hours against target by FTE band' }),
    ).toBeVisible();
    await expect(page.getByText(/not guaranteed hours/)).toBeVisible();

    // A reload loses the in-memory session; signing in again returns to the
    // committed plan, tabs and all. This is the honest case the review flagged.
    await page.evaluate(() => window.sessionStorage.clear()); // demo keeps the token in sessionStorage
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await signInAgain(page, 'P. Planner');
    await expect(page.getByRole('tab', { name: 'Scorecard' })).toBeVisible();
    await expect(page.getByText('Committed').first()).toBeVisible();
  });
});
