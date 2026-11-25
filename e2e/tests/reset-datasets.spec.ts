import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * The reset card's dataset selector (dev-build's p3-api-ds): the names come
 * from /version, choosing '120' generates the crews-plus-casuals dataset with
 * its own checksum, and resetting back to '100' returns the seeded one.
 *
 * The checksum of the 100 dataset is fixed (beb2e222...b7d1 since release
 * v1.3 S4 added the supervisors; 4156077d...da6b before, and still the
 * officers' own checksum); the 120 set must differ, which is how the spec
 * knows the choice took effect.
 */

const SEED_CHECKSUM = 'beb2e222b8c9100c98d329e37f5ffcf670f81d0083045d84f179f7f0681ab7d1';

test.describe('the demo reset datasets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the reset needs the real api on the demo profile');
  });

  test('@api resets to 120, then back to 100', async ({ page }) => {
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
