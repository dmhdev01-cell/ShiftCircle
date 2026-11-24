import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn, signInAgain } from './support';

/**
 * The preference multi-select on the officer's own card (P3 contract
 * timesOfDay): any mix of Days / Evenings / Nights, No preference as the empty
 * set, and the set survives a reload because it is what the api stored.
 */

interface MyPreferences {
  shiftLength: number | null;
  timesOfDay: string[];
  daysOff: string[];
}

async function preferences(request: APIRequestContext): Promise<MyPreferences> {
  const api = await apiAs(request, 't.nakamura');
  return api.get<MyPreferences>('/me/preferences');
}

test.describe('the officer preference card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the card saves through the real api');
  });

  test('@api saves a mix of day parts and keeps it across a reload', async ({ page, request }) => {
    test.setTimeout(180_000);
    const before = await preferences(request);
    const api = await apiAs(request, 't.nakamura');

    await signIn(page, 'T. Nakamura');
    await navTo(page, 'My schedule');
    await expect(page.getByRole('heading', { name: 'My preferences' })).toBeVisible();

    // Start from the empty set, then ask for two parts at once.
    await page.getByRole('checkbox', { name: 'No preference' }).click();
    await page.getByRole('checkbox', { name: 'Days' }).click();
    await page.getByRole('checkbox', { name: 'Evenings' }).click();
    await expect(page.getByRole('checkbox', { name: 'No preference' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Saved. The next plan will use these.')).toBeVisible();

    // The api holds the set (order is not part of it).
    await expect
      .poll(async () => (await preferences(request)).timesOfDay.slice().sort())
      .toEqual(['DAY', 'EVENING']);

    // With no saved session (the memory-only case; the demo keeps it in
    // sessionStorage), a reload asks for sign-in and the api's saved set shows.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await signInAgain(page, 'T. Nakamura');
    await navTo(page, 'My schedule');
    await expect(page.getByRole('checkbox', { name: 'Days' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Evenings' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'No preference' })).not.toBeChecked();

    // Leave the officer's own wishes as they were for the rest of the run.
    await api.put('/me/preferences', {
      shiftLength: before.shiftLength,
      timesOfDay: before.timesOfDay,
      daysOff: before.daysOff,
    });
  });
});
