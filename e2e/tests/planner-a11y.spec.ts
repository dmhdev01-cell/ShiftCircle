import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { ensurePlannableQuarter, expectAccessible, signIn } from './support';

/**
 * The planner screens in the axe sweep, and the commit dialog by keyboard
 * (acceptance-table gap 12): generate, the scorecard and gaps pass axe, the
 * dialog is reachable and closable with keys, and Space ticks the acceptance
 * checkbox that enables the yellow Commit plan button.
 */

/**
 * Wait until the page under test has stopped moving: MUI fades and slides new
 * cards and buttons in, and axe reads the blended colors of a mid-transition
 * screen as contrast failures (dev-qa's tablet run saw three header buttons at
 * 3.1-3.5:1 that pass as soon as the screen is still).
 */
async function settle(locator: import('@playwright/test').Locator): Promise<void> {
  await locator.evaluate(async (element) => {
    const pending: Promise<unknown>[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      for (const animation of node.getAnimations({ subtree: node === element })) {
        pending.push(animation.finished.catch(() => undefined));
      }
    }
    await Promise.all(pending);
  });
}

test.describe('the planner, accessible and by keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the planner needs the real api');
  });

  test('@api the landing, scorecard and gaps pass axe; the commit dialog works by keyboard', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240000);
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();
    await ensurePlannableQuarter(request);
    await expectAccessible(page, testInfo, 'planner-landing');

    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
    await settle(page.getByRole('main'));
    // The header buttons are disabled while the generator finishes; a scan of
    // that moment measures their disabled colors, not the screen a person sees.
    await expect(page.getByRole('button', { name: 'Commit plan…' })).toBeEnabled();
    await expectAccessible(page, testInfo, 'planner-scorecard');

    await page.getByRole('tab', { name: /Gaps/ }).click();
    await expect(page.getByText(/block-days are short/)).toBeVisible();
    await settle(page.getByRole('main'));
    await expectAccessible(page, testInfo, 'planner-gaps');

    // The dialog by keyboard: open it, axe it, tick with Space, close with Esc.
    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await page.getByRole('button', { name: 'Commit plan…' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // MUI fades the dialog in; axe reads the blended colors mid-fade as 34
    // contrast failures (#d1d1d1 on #e5e5e5, 1.21:1). Let the dialog settle,
    // then measure it.
    await settle(dialog);
    await expectAccessible(page, testInfo, 'planner-commit-dialog', '[role="dialog"]');

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
