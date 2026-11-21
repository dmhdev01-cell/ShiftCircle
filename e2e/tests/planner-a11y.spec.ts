import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { expectAccessible, signIn } from './support';

/**
 * The planner screens in the axe sweep, and the commit dialog by keyboard
 * (acceptance-table gap 12): generate, the scorecard and gaps pass axe, the
 * dialog is reachable and closable with keys, and Space ticks the acceptance
 * checkbox that enables the yellow Commit plan button.
 */

test.describe('the planner, accessible and by keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the planner needs the real api');
  });

  test('the landing, scorecard and gaps pass axe; the commit dialog works by keyboard', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();
    await expectAccessible(page, testInfo, 'planner-landing');

    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
    await expectAccessible(page, testInfo, 'planner-scorecard');

    await page.getByRole('tab', { name: /Gaps/ }).click();
    await expect(page.getByText(/block-days are short/)).toBeVisible();
    await expectAccessible(page, testInfo, 'planner-gaps');

    // The dialog by keyboard: open it, axe it, tick with Space, close with Esc.
    await page.getByRole('button', { name: 'Commit plan…' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectAccessible(page, testInfo, 'planner-commit-dialog');

    const commit = dialog.getByRole('button', { name: 'Commit plan' });
    await expect(commit).toBeDisabled();
    await dialog.getByRole('checkbox').focus();
    await page.keyboard.press('Space');
    await expect(commit).toBeEnabled();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // The draft is untouched: the scorecard is still there.
    await expect(page.getByText('Coverage gaps')).toBeVisible();
  });
});
