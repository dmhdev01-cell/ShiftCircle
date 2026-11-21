import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { ensurePlannableQuarter, expectAccessible, signIn } from './support';

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
    request,
  }, testInfo) => {
    test.setTimeout(240000);
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();
    await ensurePlannableQuarter(request);
    await expectAccessible(page, testInfo, 'planner-landing');

    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
    await expectAccessible(page, testInfo, 'planner-scorecard');

    await page.getByRole('tab', { name: /Gaps/ }).click();
    await expect(page.getByText(/block-days are short/)).toBeVisible();
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
    await dialog.evaluate(async (element) => {
      const pending: Promise<unknown>[] = [];
      // The fade sits on an ancestor (MUI's Fade wraps the dialog Paper), so
      // walk up as well as into the subtree.
      for (let node: Element | null = element; node; node = node.parentElement) {
        for (const animation of node.getAnimations({ subtree: node === element })) {
          pending.push(animation.finished.catch(() => undefined));
        }
      }
      await Promise.all(pending);
    });
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
