import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn, signInAgain } from './support';

/**
 * The committed planner state (V6 read API): after a commit the plan's tabs
 * stay, a reload keeps them, the report shows the FTE bands, and a committed
 * 2027 board week carries D12/N12 chips rather than raw codes.
 */

interface PlanState {
  state: string;
  defaultSeed: number;
  committedDraft?: { id: string } | null;
}

test.describe('the committed quarter plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the planner needs the real api');
  });

  test('keeps its tabs after a reload, shows the FTE bands, and D12/N12 chips on the board', async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, 'p.planner');
    const plan = await api.get<PlanState>('/planner/plan');
    const draft = await api.post('/planner/drafts', { seed: plan.defaultSeed });
    const id = (draft.body as { id: string }).id;
    const preview = await api.get<{ version: number; warningCount: number }>(
      `/planner/drafts/${id}/commit-preview`,
    );
    const committed = await api.postIfMatch(`/planner/drafts/${id}/commit`, preview.version, {
      acceptedWarningCount: preview.warningCount,
    });
    expect(committed.status).toBe(200);

    // The scorecard's FTE bands (V6).
    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByRole('tab', { name: 'Scorecard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hours against target by FTE band' })).toBeVisible();
    await expect(page.getByText(/not guaranteed hours/)).toBeVisible();

    // A reload: the guard asks for a sign-in, and the committed tabs return.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await signInAgain(page, 'P. Planner');
    await expect(page.getByRole('tab', { name: 'Scorecard' })).toBeVisible();
    await expect(page.getByText('Committed').first()).toBeVisible();

    // The committed 2027 week on the board shows the 12 h crews as chips.
    await navTo(page, 'Planning board');
    for (let week = 0; week < 7; week += 1) {
      await page.getByRole('button', { name: 'Next week' }).click();
    }
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('4 – 10 Jan 2027');
    await expect(page.getByRole('button', { name: /^(D12|N12) for / }).first()).toBeVisible();
  });
});
