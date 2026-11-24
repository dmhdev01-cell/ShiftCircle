import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { expectAccessible, navTo, signIn } from './support';

/**
 * PR-D (fit-gap B1-lite + A9): planned leave on the draft roster and the
 * planner's leave-entry dialog, proved on Dataset 150 (20% seeded leave, part-
 * time officers as the fill pool).
 *
 * 1. Dataset 150's seeded leave reads Vac/Sick on the draft roster, not Off,
 *    and the scorecard says relief officers covered leave days.
 * 2. The planner enters three days of Sick leave in the dialog (axe on the
 *    dialog), the result names the audit log, the roster shows the chips, and
 *    the auditor reads three "record_absence" events.
 *
 * Self-contained: resets to 150 and back to 100 afterwards (the rest of the
 * suite and the demo assume the seeded 100 baseline). Listed in DATASET_SPECS
 * (playwright.config.ts), so it runs in the one-worker `<viewport>-datasets`
 * project, never beside another spec.
 */

const LEAVE_WEEK = '2027-01-04';
const ENTRY_WEEK = '2027-02-08';

interface PlanState {
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  defaultSeed: number;
  draft?: { id: string } | null;
}

interface Unit {
  id: string;
  code: string;
  name: string;
}

type Item = { type: 'SHIFT'; shiftTemplate: string } | { type: 'ABSENCE'; absenceType: string };

interface Officer {
  employeeId: string;
  name: string;
  rotation: string;
  cells: { date: string; items: Item[] }[];
}

interface Draft {
  id: string;
  scorecard?: { absences?: { officers: number; days: number; coveredByRelief: number; line: string } };
}

async function resetTo(request: APIRequestContext, dataset: '100' | '150'): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.get<{ state: string; dataset?: string; error: string | null }>('/demo/reset/status');
    if (status.state === 'DONE') {
      expect(status.dataset ?? dataset).toBe(dataset);
      return;
    }
    if (status.state === 'FAILED') throw new Error(`reset to ${dataset} failed: ${status.error ?? 'no reason'}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`reset to ${dataset} did not finish`);
}

test.describe('planned leave on the draft roster (Dataset 150)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'planned leave needs the real api');
  });

  test.afterAll(async ({ request }) => {
    if (process.env.E2E_MODE === 'fixtures') return;
    test.setTimeout(180_000);
    await resetTo(request, '100');
  });

  test('@api seeded leave reads Vac/Sick, and the planner enters leave that the roster and audit show', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(360_000);
    await resetTo(request, '150');
    const planner = await apiAs(request, 'p.planner');
    const plan = await planner.get<PlanState>('/planner/plan');
    const generated = await planner.post('/planner/drafts', { seed: plan.defaultSeed });
    expect(generated.status, JSON.stringify(generated.body)).toBe(201);
    const draft = generated.body as Draft;

    // Casuals covering: the scorecard counts leave days filled by part-time / relief officers.
    const absences = draft.scorecard?.absences;
    expect(absences, 'the 150 scorecard carries the absences line').toBeTruthy();
    expect(absences!.days).toBeGreaterThan(100);
    expect(absences!.coveredByRelief, absences!.line).toBeGreaterThan(0);

    const units = await planner.get<Unit[]>('/units');
    const unitB = units.find((unit) => unit.code === 'B') ?? units[1];
    const leaveWeek = await planner.get<{ officers: Officer[] }>(
      `/planner/drafts/${draft.id}/schedule?unitId=${unitB.id}&from=${LEAVE_WEEK}&to=2027-01-10`,
    );
    const leaveItems = leaveWeek.officers.flatMap((officer) =>
      officer.cells.flatMap((cell) => cell.items.filter((item) => item.type === 'ABSENCE')),
    );
    // The fit-gap measured 18 Unit B absence rows in this week on 150 (0 shown before PR-D).
    expect(leaveItems.length, 'seeded leave on Unit B, 4-10 Jan').toBeGreaterThanOrEqual(10);

    await signIn(page, 'P. Planner');
    await page.goto(`/planner?tab=roster&unit=${unitB.id}&week=${LEAVE_WEEK}`);
    await expect(page.getByTitle('Vac').first()).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, testInfo, 'planner-roster-150-leave');

    // An officer of Unit B rostered in the entry week with no leave in it.
    const entryWeek = await planner.get<{ officers: Officer[] }>(
      `/planner/drafts/${draft.id}/schedule?unitId=${unitB.id}&from=${ENTRY_WEEK}&to=2027-02-14`,
    );
    const target = entryWeek.officers.find(
      (officer) =>
        officer.rotation !== 'On leave' &&
        officer.cells.every((cell) => cell.items.every((item) => item.type === 'SHIFT')) &&
        officer.cells.filter((cell) => cell.items.length > 0).length >= 3,
    );
    expect(target, 'a rostered Unit B officer without leave in the entry week').toBeTruthy();

    await navTo(page, 'Preferences');
    await expect(page.getByRole('heading', { name: 'Officer preferences', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Add planned leave' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add planned leave' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Plan quarter: 4 Jan 2027 – 11 Apr 2027/)).toBeVisible();

    // Validation first: nothing chosen yet.
    await dialog.getByRole('button', { name: 'Save leave' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choose an officer.');

    const officerSelect = dialog.getByLabel('Officer');
    const optionLabel = await officerSelect
      .locator('option')
      .filter({ hasText: target!.name })
      .first()
      .textContent();
    await officerSelect.selectOption({ label: optionLabel!.trim() });
    await dialog.getByLabel('First day').fill('2027-02-09');
    await dialog.getByLabel('Last day').fill('2027-02-11');
    await dialog.getByRole('radio', { name: 'Sick' }).check();
    await expect(dialog.getByText(`Sick for ${target!.name}: Tue 9 Feb 2027 – Thu 11 Feb 2027 (3 days)`)).toBeVisible();
    await expectAccessible(page, testInfo, 'planned-leave-dialog', '[role="dialog"]');
    await dialog.getByRole('button', { name: 'Save leave' }).click();

    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const status = page.getByRole('status').filter({ hasText: 'Sick recorded for' });
    await expect(status).toContainText(target!.name);
    await expect(status).toContainText('audit log');
    await expectAccessible(page, testInfo, 'planner-preferences-leave-saved');

    // The draft roster shows the new leave as Sick chips on those days.
    const after = await planner.get<{ officers: Officer[] }>(
      `/planner/drafts/${draft.id}/schedule?unitId=${unitB.id}&from=${ENTRY_WEEK}&to=2027-02-14`,
    );
    const row = after.officers.find((officer) => officer.employeeId === target!.employeeId)!;
    for (const date of ['2027-02-09', '2027-02-10', '2027-02-11']) {
      const cell = row.cells.find((entry) => entry.date === date)!;
      expect(cell.items, date).toContainEqual({ type: 'ABSENCE', absenceType: 'SICK' });
    }
    await page.goto(`/planner?tab=roster&unit=${unitB.id}&week=${ENTRY_WEEK}`);
    const officerRow = page.getByRole('row').filter({ hasText: target!.name });
    await expect(officerRow.getByTitle('Sick')).toHaveCount(3, { timeout: 20_000 });

    // Audit-visible: the auditor reads one record_absence event per day.
    const auditor = await apiAs(request, 'a.reviewer');
    const events = await auditor.get<{ items: { action: string; after: { employeeId?: string; date?: string; type?: string } }[] }>(
      '/audit-events?action=record_absence&limit=50',
    );
    const mine = events.items.filter((event) => event.after?.employeeId === target!.employeeId);
    expect(mine.map((event) => event.after.date).sort()).toEqual(['2027-02-09', '2027-02-10', '2027-02-11']);
    expect(mine.every((event) => event.after.type === 'SICK')).toBe(true);
  });
});
