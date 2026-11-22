import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Release 3 (observation 34): close Unit C from a date through the real api,
 * then see the planner plan without it - the roster's picker and note, the
 * Closed cells, the split staffing periods - and remove the closure again.
 *
 * Self-contained: resets to 120, adds its own closure, and resets back to the
 * seeded 100 at the end so later specs see the baseline.
 */

interface PlannerUnit {
  id: string;
  name: string;
  closures: { id: string }[];
}

async function resetDemo(request: APIRequestContext, dataset: '100' | '120'): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.get<{ state: string; dataset?: string; error: string | null }>(
      '/demo/reset/status',
    );
    if (status.state === 'DONE') {
      expect(status.dataset ?? dataset).toBe(dataset);
      return;
    }
    if (status.state === 'FAILED') throw new Error(`reset to ${dataset} failed: ${status.error ?? ''}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`reset to ${dataset} did not finish`);
}

test.describe('units closed from a date', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the units need the real api');
  });

  test.afterAll(async ({ request }) => {
    if (process.env.E2E_MODE === 'fixtures') return;
    test.setTimeout(180_000);
    await resetDemo(request, '100');
  });

  test('@api closes Unit C, plans without it, and reopens it', async ({ page, request }) => {
    test.setTimeout(300_000);
    await resetDemo(request, '120');
    const api = await apiAs(request, 'p.planner');
    const units = await api.get<PlannerUnit[]>('/planner/units');
    const unitC = units.find((unit) => unit.name.startsWith('Unit C'))!;
    expect(unitC, 'Unit C is on the units list').toBeTruthy();

    const added = await api.post(`/planner/units/${unitC.id}/closures`, {
      closedFrom: '2027-02-15',
      reopensOn: null,
      reason: 'Renovation (e2e)',
    });
    expect([200, 201]).toContain(added.status);

    try {
      // The Units screen reads the closure back in words.
      await signIn(page, 'P. Planner');
      await navTo(page, 'Units');
      const row = page.getByRole('row', { name: /Unit C · Living unit/ });
      await expect(row).toBeVisible();
      await expect(row.getByText('Closed from 15 Feb 2027 · no reopening date set')).toBeVisible();
      await expect(row.getByText(/"Renovation \(e2e\)"/)).toBeVisible();

      // A new draft plans without the unit from that date.
      await navTo(page, 'Quarter plan');
      await page.getByRole('button', { name: 'Generate draft' }).click();
      await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
      // The staffing periods split at the closure: the later period is there.
      await expect(page.getByText(/15 Feb 2027 – 11 Apr 2027/).first()).toBeVisible();
      // The 7th tile is next to the six from before.
      await expect(page.getByText('Staffing', { exact: true })).toBeVisible();

      await page.getByRole('tab', { name: 'Roster' }).click();
      await page.getByLabel('Unit', { exact: true }).selectOption(unitC.id);
      // The roster opens on the plan's first week (4 Jan); the closure's week
      // is six weeks later. Six clicks, then read the range once.
      for (let week = 0; week < 6; week += 1) {
        await page.getByRole('button', { name: 'Next week' }).click();
      }
      await expect(page.getByRole('group', { name: 'Week' })).toContainText('15 – 21 Feb 2027');
      await expect(page.getByText(/Unit C is closed from Mon 15 Feb 2027 \("Renovation \(e2e\)"\)/)).toBeVisible();
      await expect(page.getByTitle(/is closed on this day/).first()).toBeVisible();

      // Reopen through the Units screen: remove the closure.
      await navTo(page, 'Units');
      await page.getByRole('button', { name: 'Remove…' }).click();
      const confirm = page.getByRole('dialog', { name: 'Remove this closure?' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Remove closure' }).click();
      await expect(page.getByText(/Unit C is open again/)).toBeVisible();
    } finally {
      // Whatever happened, leave the stack without the closure.
      const current = await api.get<PlannerUnit[]>('/planner/units');
      const closed = current.find((unit) => unit.id === unitC.id);
      for (const closure of closed?.closures ?? []) {
        await api.delete(`/planner/units/${unitC.id}/closures/${closure.id}`);
      }
    }
  });
});
