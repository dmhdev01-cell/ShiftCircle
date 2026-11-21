import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Observation #11: a shift marked Sick or Vac could not be reopened - the cell
 * was a plain span - so a mistake could never be corrected. The drawer now
 * opens on the recorded absence and the supervisor can change it.
 *
 * Data: an entry in the open period on or before the demo day. The spec sets
 * it to Sick, changes it to worked, and back to Sick, checking the api after
 * each step (the screen's own wording is asserted too).
 */

interface TimeEntry {
  assignmentId: string;
  employeeName: string;
  date: string;
  worked: boolean;
}

async function aWorkedEntry(request: import('@playwright/test').APIRequestContext): Promise<TimeEntry> {
  const api = await apiAs(request, 'm.ellis');
  // The demo day's period (9 - 22 Nov), not the newest open one in the list.
  const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
  const open = periods.find(
    (period) => period.status === 'OPEN' && period.from <= '2026-11-19' && period.to >= '2026-11-19',
  )!;
  const entries = await api.get<TimeEntry[]>(`/pay-periods/${open.id}/time-entries`);
  const entry = entries.find((candidate) => candidate.date <= '2026-11-19' && candidate.worked);
  expect(entry, 'a worked entry in the open period').toBeTruthy();
  return entry!;
}

async function entryAbsence(
  request: import('@playwright/test').APIRequestContext,
  assignmentId: string,
): Promise<{ absence?: string; worked: boolean }> {
  const api = await apiAs(request, 'm.ellis');
  // The demo day's period (9 - 22 Nov), not the newest open one in the list.
  const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
  const open = periods.find(
    (period) => period.status === 'OPEN' && period.from <= '2026-11-19' && period.to >= '2026-11-19',
  )!;
  const entries = await api.get<TimeEntry[]>(`/pay-periods/${open.id}/time-entries`);
  const entry = entries.find((candidate) => candidate.assignmentId === assignmentId);
  expect(entry, 'the entry is still in the period').toBeTruthy();
  return entry!;
}

test.describe('a sickness record can be corrected', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the absence records come from the real api');
  });

  test('sick to worked and back to sick', async ({ page, request }) => {
    const entry = await aWorkedEntry(request);

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    await expect(page.getByRole('heading', { name: 'Time & attendance', level: 1 })).toBeVisible();

    const cell = page.locator(`[data-assignment-id="${entry.assignmentId}"]`).first();

    // Worked -> sick.
    await cell.getByRole('button').first().click();
    await page.getByRole('radio', { name: 'Absent' }).check();
    await page.getByLabel('Absence type').selectOption('SICK');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await entryAbsence(request, entry.assignmentId)).absence).toBe('SICK');
    // The drawer stays open with the result; Done closes it (observation #10).
    await page.getByRole('button', { name: 'Done' }).click();
    const sick = cell.getByRole('button', { name: /Sick .* change/ });
    await expect(sick).toBeVisible();

    // Sick -> worked: the absence cell opens on the recorded choice.
    await sick.click();
    await expect(page.getByLabel('Absence type')).toHaveValue('SICK');
    await page.getByRole('radio', { name: 'Worked as scheduled' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await entryAbsence(request, entry.assignmentId)).absence).toBeFalsy();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(sick).toHaveCount(0);

    // Worked -> sick again.
    await cell.getByRole('button').first().click();
    await page.getByRole('radio', { name: 'Absent' }).check();
    await page.getByLabel('Absence type').selectOption('SICK');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await entryAbsence(request, entry.assignmentId)).absence).toBe('SICK');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(cell.getByRole('button', { name: /Sick .* change/ })).toBeVisible();
  });
});
