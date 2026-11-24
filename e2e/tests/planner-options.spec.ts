import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { expectAccessible, resetDemoData, signIn } from './support';

/**
 * v1.2 plan options (PR-N) on Dataset 150: the landing offers the options at
 * their defaults, the draft says what it was made with, Generate again is
 * filled in from the last draft, and "Fill up to each officer's FTE" leaves
 * less unused part-time capacity on the scorecard than the default.
 *
 * Stack-wide: it resets to 150, generates twice and resets back to 100.
 */

/** "Unused part-time capacity: 3,515 h." -> 3515 */
async function unusedHours(page: import('@playwright/test').Page): Promise<number> {
  const line = page.getByRole('note', { name: 'Unused part-time capacity' });
  await expect(line).toBeVisible();
  const text = (await line.textContent()) ?? '';
  const match = /Unused part-time capacity: ([\d,]+) h/.exec(text);
  expect(match, text).not.toBeNull();
  return Number(match![1].replace(/,/g, ''));
}

async function settled(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.getAnimations().every((animation) => animation.playState !== 'running'),
    undefined,
    { timeout: 15_000 },
  );
}

test.describe('plan options', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the options need the real api');
  });

  test.afterAll(async ({ request }) => {
    if (process.env.E2E_MODE === 'fixtures') return;
    test.setTimeout(180_000);
    await resetDemoData(request, '100');
  });

  test('@api defaults first, then Generate again filled in, then fill part-time up to FTE', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    await resetDemoData(request, '150');
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();

    // The landing: the options at their defaults, each with its sentence.
    const landing = page.getByRole('group', { name: 'Plan options' });
    await expect(landing.getByRole('checkbox', { name: /Full-time officers/ })).toBeChecked();
    await expect(landing.getByRole('checkbox', { name: /Full-time officers/ })).toBeDisabled();
    await expect(landing.getByRole('checkbox', { name: /Part-time and casual officers/ })).toBeChecked();
    await expect(landing.getByRole('radio', { name: /Fill gaps only/ })).toBeChecked();
    await expect(landing.getByRole('radio', { name: /Honour time-of-day wishes/ })).toBeChecked();
    await expectAccessible(page, testInfo, 'planner-options-landing', '[role="group"][aria-label="Plan options"]');

    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('plan-options-used')).toHaveText(
      'Made with: full-time and part-time officers · part-time fills gaps only · time-of-day wishes honoured',
    );
    const before = await unusedHours(page);
    expect(before, 'Dataset 150 leaves part-time capacity unused by default').toBeGreaterThan(1000);

    // Generate again: filled in from the draft; choose the FTE fill.
    await expect(page.getByRole('button', { name: 'Generate again' })).toBeEnabled();
    await page.getByRole('button', { name: 'Generate again' }).click();
    const dialog = page.getByRole('dialog');
    const again = dialog.getByRole('group', { name: 'Plan options' });
    await expect(again.getByRole('radio', { name: /Fill gaps only/ })).toBeChecked();
    await settled(page);
    await expectAccessible(page, testInfo, 'planner-options-dialog', '[role="dialog"]');
    await again.getByRole('radio', { name: /Fill up to each officer's FTE/ }).check();
    await dialog.getByRole('button', { name: 'Replace draft' }).click();
    await expect(page.getByTestId('plan-options-used')).toHaveText(
      'Made with: full-time and part-time officers · part-time filled up to FTE · time-of-day wishes honoured',
      { timeout: 90_000 },
    );
    const after = await unusedHours(page);
    console.log(`Dataset 150 unused part-time capacity: ${before} h -> ${after} h`);
    expect(after).toBeLessThan(before);
    await expect(page.getByRole('note', { name: 'Unused part-time capacity' })).toContainText(
      'filled part-time officers up to their FTE target',
    );

    // The next Generate again starts from this draft's options.
    await expect(page.getByRole('button', { name: 'Generate again' })).toBeEnabled();
    await page.getByRole('button', { name: 'Generate again' }).click();
    await expect(
      page.getByRole('dialog').getByRole('radio', { name: /Fill up to each officer's FTE/ }),
    ).toBeChecked();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
