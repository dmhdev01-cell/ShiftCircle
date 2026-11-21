import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { navTo, signIn, signOut } from './support';

/**
 * The quarter planner (docs/ui/planner.md): the planner generates a draft for
 * the whole quarter, reads the scorecard and gaps, commits it with the warning
 * list accepted, and a supervisor then opens the committed week on the board.
 *
 * The window is Mon 4 Jan - Sun 11 Apr 2027 (7 pay periods).
 */

test.describe('the quarter plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the planner needs the real api');
  });

  test('generate a draft, read it, commit it, and find it on the board', async ({ page }, testInfo) => {
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();
    // The window and the planner's own nav.
    await expect(page.getByText(/4 Jan – 11 Apr 2027/)).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
    await expect(nav).toHaveText(['Quarter plan', 'Preferences', 'Planning board', 'Reports', 'About & version']);

    await page.getByRole('button', { name: 'Generate draft' }).click();
    // The scorecard appears: the six tiles and the two panels.
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
    for (const tile of ['Rule warnings', 'Preferences met', 'Night fairness', 'Overtime built in', 'Generated in']) {
      await expect(page.getByText(tile, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Night shifts by seniority' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preferences by kind' })).toBeVisible();
    await expect(page.getByText(/Held|Not held/).first()).toBeVisible();

    // The gaps tab names the short block-days.
    await page.getByRole('tab', { name: /Gaps/ }).click();
    await expect(page.getByText(/block-days are short/)).toBeVisible();

    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await page.getByRole('button', { name: 'Commit plan…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/shifts/).first()).toBeVisible();
    const commit = dialog.getByRole('button', { name: 'Commit plan' });
    await expect(commit).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(commit).toBeEnabled();
    await commit.click();

    await expect(page.getByRole('heading', { name: 'Plan committed' })).toBeVisible({ timeout: 120_000 });

    // A supervisor sees the committed plan on the board's first week
    // (Mon 4 Jan 2027): walk there from the demo week with the week buttons.
    await signOut(page, 'P. Planner');
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');
    for (let week = 0; week < 7; week += 1) {
      await page.getByRole('button', { name: 'Next week' }).click();
    }
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('4 – 10 Jan 2027');
    await expect(page.getByRole('button', { name: /A12|P12|D8/ }).first()).toBeVisible();
    void testInfo;
  });
});
