import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { resetDemoData, signIn } from './support';

/**
 * Release 7: the planner edits a 120 draft in the browser. The Warn move and
 * the removal are pinned recipes from dev-build's API tests, so the same rows
 * are exercised end to end; the commit then re-checks the edited draft.
 */

async function tileValue(page: import('@playwright/test').Page, label: string): Promise<string> {
  const tile = page.getByText(label, { exact: true }).locator('xpath=..');
  return (await tile.locator('.num').first().textContent())?.trim() ?? '';
}

test.describe('draft hand edits', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'draft edits need the real api');
  });

  test('refuses a block, keeps a warning, removes a shift, then commits', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    await resetDemoData(request, '120');
    await signIn(page, 'P. Planner');
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
    const warningsBefore = await tileValue(page, 'Rule warnings');

    // Block: Wade Xu's D12 on Mon 4 Jan becomes an N8 the same day; the rules
    // refuse it and nothing is saved (dev-build's pinned UI-shaped move).
    const planner = await apiAs(request, 'p.planner');
    const units = await planner.get<{ id: string; code: string }[]>('/planner/units');
    const unitEsc = units.find((unit) => unit.code === 'ESC')!;
    await page.getByRole('tab', { name: 'Roster' }).click();
    await page.getByLabel('Unit', { exact: true }).selectOption(unitEsc.id);
    await page.getByRole('button', { name: /for Wade Xu on 2027-01-04/ }).click();
    await page.getByRole('button', { name: 'Change time or unit…' }).click();
    await page.getByLabel('Shift', { exact: true }).selectOption('N8');
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(
      page.getByText(
        "This change breaks a Block rule, so it can't go in the draft. Choose another officer or time, or leave the gap.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/hand edit/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Close' }).click();

    // Warn: Unit B's Bram Beaulieu, E8 on Wed 6 Jan 2027, moved to Tue 5 Jan.
    // The first save is refused as a Warn; keeping it saves with the
    // acknowledgement (dev-build's pinned recipe).
    const unitB = units.find((unit) => unit.code === 'B')!;
    await page.getByLabel('Unit', { exact: true }).selectOption(unitB.id);
    await page
      .getByRole('button', { name: /for Bram Beaulieu on 2027-01-06/ })
      .click();
    await page.getByRole('button', { name: 'Change time or unit…' }).click();
    await page.getByLabel('Date', { exact: true }).fill('2027-01-05');
    await page.getByRole('button', { name: 'Check and save' }).click();

    await expect(page.getByText(/U-\d+ · /).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Keep the change with these warnings' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Keep the change with these warnings' }).click();

    await expect(page.getByText(/Draft changed: Bram Beaulieu/)).toBeVisible();
    await expect(page.getByText('1 hand edit so far.')).toBeVisible();
    await expect(page.getByText(/· edited/).first()).toBeVisible();

    // The api's recomputed scorecard replaced the old figures.
    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await expect
      .poll(async () => tileValue(page, 'Rule warnings'))
      .not.toBe(warningsBefore);

    // Remove the moved shift: no reason is asked for.
    await page.getByRole('tab', { name: 'Roster' }).click();
    await page
      .getByRole('button', { name: /for Bram Beaulieu on 2027-01-05/ })
      .click();
    await page.getByRole('button', { name: 'Remove from draft…' }).click();
    await expect(page.getByText(/The block may become a gap/)).toBeVisible();
    await page.getByRole('button', { name: 'Remove shift' }).click();
    await expect(page.getByText(/Removed from the draft: Bram Beaulieu/)).toBeVisible();
    await expect(page.getByText('2 hand edits so far.')).toBeVisible();

    // Commit re-checks every shift, hand edits included.
    await page.getByRole('button', { name: 'Commit plan…' }).click();
    const commit = page.getByRole('dialog');
    await expect(
      commit.getByText(
        'Commit checks every shift again, hand edits included. Shifts you kept with warnings go to the planning board with those warnings.',
      ),
    ).toBeVisible();
    const warnings = await commit.getByRole('checkbox').count();
    if (warnings > 0) await commit.getByRole('checkbox').check();
    await commit.getByRole('button', { name: 'Commit plan' }).click();
    await expect(page.getByRole('heading', { name: 'Plan committed' })).toBeVisible({
      timeout: 120_000,
    });
  });
});
