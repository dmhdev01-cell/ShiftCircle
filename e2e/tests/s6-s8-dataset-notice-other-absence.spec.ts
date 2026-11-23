import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * S6: on Dataset 100 the Quarter plan warns that the dataset is under-staffed
 * for nights and links to About & version (the reset card). The default stays
 * 100. Other specs reset the data in parallel, so the spec reads the live
 * dataset from /version and checks the notice matches it, without resetting.
 *
 * S8: the record-actual drawer offers Other (FR-51), the api stores OTHER and
 * the time grid shows it. The entry is put back to worked afterwards.
 */

interface TimeEntry {
  assignmentId: string;
  date: string;
  worked: boolean;
  absence?: string;
}

const NOTICE =
  'Dataset 100 is under-staffed for nights; reset to Dataset 120 for the planner demo.';

async function demoPeriodEntries(request: APIRequestContext): Promise<TimeEntry[]> {
  const api = await apiAs(request, 'm.ellis');
  const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
  const open = periods.find(
    (period) => period.status === 'OPEN' && period.from <= '2026-11-19' && period.to >= '2026-11-19',
  )!;
  return api.get<TimeEntry[]>(`/pay-periods/${open.id}/time-entries`);
}

test.describe('S6 and S8', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'needs the real api');
  });

  test('the Quarter plan names Dataset 100 and links to About & version', async ({ page, request }) => {
    const version = await (await request.get('/api/v1/version')).json();
    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();

    const note = page.getByRole('note', { name: 'Dataset notice' });
    if (version.activeDataset !== '100') {
      await expect(note).toHaveCount(0);
      return;
    }
    await expect(note).toHaveText(`${NOTICE} About & version`);
    await note.getByRole('link', { name: 'About & version' }).click();
    await expect(page.getByRole('heading', { name: 'About & version', level: 1 })).toBeVisible();
  });

  test('a supervisor records the Other absence code', async ({ page, request }) => {
    // The last worked entry, so the sick-correction spec (the first one) is not shared.
    const entry = (await demoPeriodEntries(request))
      .filter((candidate) => candidate.date <= '2026-11-19' && candidate.worked)
      .at(-1);
    expect(entry, 'a worked entry in the open period').toBeTruthy();
    const absenceOf = async () =>
      (await demoPeriodEntries(request)).find((row) => row.assignmentId === entry!.assignmentId)?.absence;

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    await expect(page.getByRole('heading', { name: 'Time & attendance', level: 1 })).toBeVisible();
    const cell = page.locator(`[data-assignment-id="${entry!.assignmentId}"]`).first();

    await cell.getByRole('button').first().click();
    await page.getByRole('radio', { name: 'Absent' }).check();
    await page.getByLabel('Absence type').selectOption('OTHER');
    await expect(page.getByText('Will record: absent (other), no hours.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(absenceOf).toBe('OTHER');
    await page.getByRole('button', { name: 'Done' }).click();

    const other = cell.getByRole('button', { name: /^Other .* change$/ });
    await expect(other).toBeVisible();
    await other.click();
    await expect(page.getByLabel('Absence type')).toHaveValue('OTHER');

    // Put it back as worked.
    await page.getByRole('radio', { name: 'Worked as scheduled' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(absenceOf).toBeFalsy();
  });
});
