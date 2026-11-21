import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Observations #9 and #10: after saving an actual the whole grid was replaced
 * by a loading line (the page jumped to the top), and the drawer still said
 * Cancel although the record was already saved.
 *
 * The seeded demo period records every past shift, so the spec edits a worked
 * entry's times: the same save path, and it proves the grid stays put.
 */

interface TimeEntry {
  assignmentId: string;
  employeeName: string;
  date: string;
  startAt: string;
  endAt: string;
  worked: boolean;
}

async function aWorkedEntry(request: import('@playwright/test').APIRequestContext): Promise<TimeEntry> {
  const api = await apiAs(request, 'm.ellis');
  const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
  const open = periods.find(
    (period) => period.status === 'OPEN' && period.from <= '2026-11-19' && period.to >= '2026-11-19',
  )!;
  const entries = await api.get<TimeEntry[]>(`/pay-periods/${open.id}/time-entries`);
  // The last worked entry, so this spec cannot fight the absence spec for the
  // same cell when both run on one stack.
  // A day shift: the adjusted-times field writes both clocks on the entry's
  // own date, so a night shift would send an end before its start.
  const worked = entries.filter(
    (candidate) =>
      candidate.worked &&
      candidate.date <= '2026-11-18' &&
      candidate.endAt.slice(0, 10) === candidate.date,
  );
  expect(worked.length, 'a worked entry in the demo period').toBeGreaterThan(0);
  return worked[worked.length - 1];
}

test.describe('recording an actual', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the time entries come from the real api');
  });

  test('keeps the grid where it was and closes with Done', async ({ page, request }) => {
    const entry = await aWorkedEntry(request);

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    const grid = page.getByRole('region', { name: 'Time entries, scrolls sideways' });
    await expect(grid).toBeVisible();

    // Scroll the page down to the grid: replacing the grid with a short
    // loading line clamped the page back to the top (observation #9).
    await page.evaluate(() => window.scrollTo(0, 400));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    const cell = page.locator(`[data-assignment-id="${entry.assignmentId}"]`).first();
    await cell.getByRole('button').first().click();
    await page.getByRole('radio', { name: 'Adjusted times' }).check();
    await page.getByRole('button', { name: 'Save' }).click();

    // The drawer says Done, not Cancel, and no loading line replaced the grid.
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByText('Loading the time entries…')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(grid).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
});
