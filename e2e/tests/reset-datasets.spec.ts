import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * The reset card's dataset selector (dev-build's p3-api-ds): the names come
 * from /version, choosing '120' generates the crews-plus-casuals dataset with
 * its own checksum, and resetting back to '100' returns the seeded one.
 *
 * The checksum of the 100 dataset is fixed (3390148255...6539); the 120 set
 * must differ, which is how the spec knows the choice took effect.
 */

const SEED_CHECKSUM = '3390148255db715844c4df90f553ae342530417621539b23499f638c5b126539';

test.describe('the demo reset datasets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the reset needs the real api on the demo profile');
  });

  test('resets to 120, then back to 100', async ({ page }) => {
    test.setTimeout(420000);
    await signIn(page, 'P. Planner');
    await navTo(page, 'About & version');
    await expect(page.getByRole('heading', { name: 'Reset the demo data' })).toBeVisible();

    // The selector exists and names at least the two datasets.
    const dataset = page.getByLabel('Dataset');
    await expect(dataset).toBeVisible();
    await dataset.selectOption('120');
    await page.getByLabel('Type RESET to confirm').fill('RESET');
    await page.getByRole('button', { name: 'Reset demo data' }).click();

    await expect(page.getByText(/The demo data was rebuilt in/)).toBeVisible({ timeout: 180_000 });
    const done120 = await page.getByText(/Dataset checksum/).textContent();
    expect(done120 ?? '').not.toContain(SEED_CHECKSUM);

    // Back to the seeded 100 dataset and its known checksum.
    await dataset.selectOption('100');
    await page.getByLabel('Type RESET to confirm').fill('RESET');
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await expect(page.getByText(/The demo data was rebuilt in/)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(SEED_CHECKSUM)).toBeVisible({ timeout: 30_000 });
  });
});
