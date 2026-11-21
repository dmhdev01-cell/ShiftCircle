import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { signIn } from './support';

/**
 * Observation #3: the planning board was pinned to the week of the demo day.
 * The api takes any date range, so the board walks whole weeks from it.
 *
 * The demo day is 2026-11-19, in the week of Mon 16 to Sun 22 Nov 2026.
 */
test.describe('the planning week', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the week ranges come from the real api');
  });

  test('walks a week back, a week on, and back to today', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();

    const week = page.getByRole('group', { name: 'Week' });
    await expect(week).toContainText('16 – 22 Nov 2026');
    await expect(page.getByRole('button', { name: 'Today' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(week).toContainText('9 – 15 Nov 2026');
    // The roster is the previous week's: the demo day is not in it.
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(week).toContainText('23 – 29 Nov 2026');

    await page.getByRole('button', { name: 'Today' }).click();
    await expect(week).toContainText('16 – 22 Nov 2026');
    await expect(page.getByRole('button', { name: 'Today' })).toBeDisabled();
  });
});
