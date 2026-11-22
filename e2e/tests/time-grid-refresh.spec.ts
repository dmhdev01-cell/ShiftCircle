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
    // loading line clamped the page back to the top (observation #9). The
    // target is the grid's own position, not a fixed pixel count (the seed's
    // row count moves it).
    const target = await grid.evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY - 240,
    );
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), target);

    // Clicking a cell may scroll it into view; measure where the page is with
    // the drawer open, because the save is what must not move it.
    const cell = page.locator(`[data-assignment-id="${entry.assignmentId}"]`).first();
    await cell.getByRole('button').first().click();
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);
    await page.getByRole('radio', { name: 'Adjusted times' }).check();
    await page.getByRole('button', { name: 'Save' }).click();

    // The drawer says Done, not Cancel, and no loading line replaced the grid.
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByText('Loading the time entries…')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(grid).toBeVisible();
    const after = await page.evaluate(() => window.scrollY);
    // The defect was the page jumping back to the top. A small reflow from the
    // saved row/status is fine (tablet measured 59 px); the grid stays on
    // screen where it was.
    expect(after, 'the page did not jump to the top').toBeGreaterThan(0);
    expect(Math.abs(after - before), 'the save does not move the page far').toBeLessThan(120);
  });
});

test.describe('the record-actual drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the time entries come from the real api');
  });

  test('closes with its X and with Escape, and says Done after a save', async ({ page, request }) => {
    const entry = await aWorkedEntry(request);
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    const cell = page.locator(`[data-assignment-id="${entry.assignmentId}"]`).first();

    // X closes without recording.
    await cell.getByRole('button').first().click();
    await expect(page.getByRole('button', { name: 'Close the record actual panel' })).toBeVisible();
    await page.getByRole('button', { name: 'Close the record actual panel' }).click();
    await expect(page.getByRole('button', { name: 'Close the record actual panel' })).toHaveCount(0);

    // Escape closes it too.
    await cell.getByRole('button').first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Close the record actual panel' })).toHaveCount(0);

    // After a save the secondary button says Done, not Cancel.
    await cell.getByRole('button').first().click();
    await page.getByRole('radio', { name: 'Worked as scheduled' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
  });
});
