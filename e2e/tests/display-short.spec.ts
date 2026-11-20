import { expect, test } from '@playwright/test';

import { isFixtures, shortStaffed } from './api';
import { expectAccessible, signIn } from './support';

/**
 * The wall display when a unit is short (E5): the shortfall is said in words
 * and marked with an icon, not by colour alone, and it still names nobody.
 * The demo dataset is covered today, so the api's own payload is served with
 * one unit two officers short.
 */

test.describe('wall display: short-staffed', () => {
  test('@api a short unit is shown in words and with an icon', async ({ page }, testInfo) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the payload is the real api, reshaped');
    await page.route('**/api/v1/display/today', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: shortStaffed(await response.json()) });
    });
    await page.clock.install({ time: new Date('2026-11-19T20:32:00Z') });
    await signIn(page, 'Unit office TV');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();

    const unitA = page.getByRole('region', { name: 'Unit A · Living unit' });
    await expect(unitA).toBeVisible();
    // Words: "short" appears in the card, and the covered pill does not.
    await expect(unitA.getByText(/short/i).first()).toBeVisible();
    await expect(unitA.getByText('Covered', { exact: true })).toHaveCount(0);
    // An icon goes with the words (colour is never the only signal).
    await expect(unitA.locator('svg').first()).toBeVisible();
    // The facility panel counts the short unit.
    await expect(page.getByRole('region', { name: 'Facility today' })).toContainText(/Units short right now\s*1/);
    // The other units are still covered.
    await expect(page.getByRole('region', { name: 'Unit B · Living unit' }).getByText('Covered', { exact: true })).toBeVisible();
    await expectAccessible(page, testInfo, 'wall-display-short');
  });
});
