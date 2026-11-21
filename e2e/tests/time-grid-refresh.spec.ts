import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Observations #9 and #10: after saving an actual the whole grid was replaced
 * by a loading line (the page jumped to the top), and the drawer still said
 * Cancel although the record was already saved.
 *
 * The spec records an actual for a shift that needs one, checks that the grid
 * is still on screen with the same scroll position, then closes with Done.
 */

interface TimeEntry {
  assignmentId: string;
  employeeName: string;
  date: string;
  needsActual: boolean;
}

async function anEntryNeedingActual(
  request: import('@playwright/test').APIRequestContext,
): Promise<TimeEntry> {
  const api = await apiAs(request, 'm.ellis');
  const periods = await api.get<{ id: string; status: string }[]>('/pay-periods');
  const open = periods.find((period) => period.status === 'OPEN')!;
  const entries = await api.get<TimeEntry[]>(`/pay-periods/${open.id}/time-entries`);
  const entry = entries.find((candidate) => candidate.needsActual);
  expect(entry, 'a shift that needs an actual').toBeTruthy();
  return entry!;
}

test.describe('recording an actual', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the time entries come from the real api');
  });

  test('keeps the grid where it was and closes with Done', async ({ page, request }) => {
    const entry = await anEntryNeedingActual(request);

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    const grid = page.getByRole('region', { name: 'Time entries, scrolls sideways' });
    await expect(grid).toBeVisible();

    // Scroll the grid down so a lost position would be visible.
    await grid.evaluate((element) => {
      element.scrollTop = 120;
    });
    const before = await grid.evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(0);

    await page.locator(`[data-assignment-id="${entry.assignmentId}"]`).first().getByRole('button').first().click();
    await page.getByRole('radio', { name: 'Worked as scheduled' }).check();
    await page.getByRole('button', { name: 'Save' }).click();

    // The drawer says Done, not Cancel, and the grid never became a loading line.
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByText('Loading the time entries…')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(grid).toBeVisible();
    expect(await grid.evaluate((element) => element.scrollTop)).toBe(before);
  });
});
