import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * The demo reset on About & version (docs/07, PLANNER only, demo profile only):
 * generate and commit a plan, reset the data, and find the board for 2027 empty
 * again with the card showing DONE and the dataset checksum.
 */

interface PlanState {
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  defaultSeed: number;
  window: { from: string };
  draft?: { id: string } | null;
}

test.describe('the demo reset', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the reset needs the real api on the demo profile');
  });

  test('commits a plan, resets the data, and the 2027 board is empty again', async ({ page, request }) => {
    test.setTimeout(240_000);
    // A committed plan to erase. Self-contained: the stack may already hold a
    // committed plan (another spec committed one), and that is exactly what the
    // reset must erase; otherwise commit the open draft or generate one.
    const api = await apiAs(request, 'p.planner');
    const plan = await api.get<PlanState>('/planner/plan');
    let draftId = plan.draft?.id;
    if (plan.state !== 'COMMITTED') {
      if (!draftId) {
        const draft = await api.post('/planner/drafts', { seed: plan.defaultSeed ?? 20261001 });
        expect([200, 201]).toContain(draft.status);
        draftId = (draft.body as { id: string }).id;
      }
      const preview = await api.get<{ version: number; warningCount: number }>(
        `/planner/drafts/${draftId}/commit-preview`,
      );
      const committed = await api.postIfMatch(
        `/planner/drafts/${draftId}/commit`,
        preview.version,
        { acceptedWarningCount: preview.warningCount },
      );
      expect(committed.status).toBe(200);
    }

    await signIn(page, 'P. Planner');
    await navTo(page, 'About & version');
    await expect(page.getByRole('heading', { name: 'Reset the demo data' })).toBeVisible();
    await page.getByLabel('Type RESET to confirm').fill('RESET');
    await page.getByRole('button', { name: 'Reset demo data' }).click();

    await expect(page.getByText(/The demo data was rebuilt in/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/4156077d76d41bd5/)).toBeVisible();

    // The quarter plan is back to no draft, and the 2027 week is empty.
    await navTo(page, 'Quarter plan');
    await expect(page.getByText('No plan for this quarter yet.')).toBeVisible();
    await navTo(page, 'Planning board');
    for (let week = 0; week < 7; week += 1) {
      const next = page.getByRole('button', { name: 'Next week' });
      await next.click();
    }
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('4 – 10 Jan 2027');
    await expect(page.getByRole('button', { name: /^(A12|P12|D8) for / })).toHaveCount(0);
  });
});
