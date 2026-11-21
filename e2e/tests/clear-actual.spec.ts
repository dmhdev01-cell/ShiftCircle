import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Clear a record back to "needs actual" (the DELETE endpoint): record a
 * worked-as-scheduled actual, clear it, and the shift is flagged again.
 */

interface TimeEntry {
  assignmentId: string;
  employeeName: string;
  date: string;
  worked: boolean;
  needsActual: boolean;
}

async function aWorkedEntry(request: APIRequestContext): Promise<TimeEntry> {
  const api = await apiAs(request, 'm.ellis');
  const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
  const open = periods.find(
    (period) => period.status === 'OPEN' && period.from <= '2026-11-19' && period.to >= '2026-11-19',
  )!;
  const entries = await api.get<TimeEntry[]>(`/pay-periods/${open.id}/time-entries`);
  const entry = entries.find((candidate) => candidate.worked && candidate.date <= '2026-11-18');
  expect(entry, 'a worked entry in the demo period').toBeTruthy();
  return entry!;
}

test.describe('clearing a record', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the time entries come from the real api');
  });

  test('@api back to needs actual from the drawer', async ({ page, request }) => {
    test.setTimeout(90000);
    const entry = await aWorkedEntry(request);

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    const cell = page.locator(`[data-assignment-id="${entry.assignmentId}"]`).first();
    await cell.getByRole('button').first().click();

    await expect(page.getByRole('button', { name: 'Clear (back to needs actual)' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear (back to needs actual)' }).click();

    // The drawer closes and the drawer's message says what happened.
    await expect(page.getByText(/The record is cleared/)).toBeVisible();
    // The cell is flagged again.
    await expect(cell.getByRole('button', { name: /needs actual/ })).toBeVisible({ timeout: 10_000 });
  });
});
