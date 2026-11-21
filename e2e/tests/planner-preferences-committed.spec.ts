import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Candidate 3 (F10): preference scoring reads the shift's length and time of day
 * from the template row. After a commit on dataset 120, an N12 crew officer who
 * asked for 12 h nights is Met on the Officer preferences screen - the case
 * dev-design's walk could not see while every row read "No draft".
 *
 * Self-contained: resets to 120, commits the plan, finds a night-crew officer
 * whose recorded preference is 12 h NIGHT, confirms the committed plan really
 * gives them N12 shifts, and reads the screen as the planner.
 */

interface PlanState {
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  defaultSeed: number;
  draft?: { id: string } | null;
  committedDraft?: { id: string } | null;
}

interface PreferenceRow {
  employeeId: string;
  name: string;
  unitName: string;
  shiftLength: number | null;
  timesOfDay: string[];
  inDraft: string;
  unmet: string[];
}

interface Unit {
  id: string;
  name: string;
}

interface Schedule {
  officers: {
    employeeId: string;
    cells: { date: string; items: { shiftTemplate: string }[] }[];
  }[];
}

async function resetTo120(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset: '120' });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.get<{ state: string; dataset?: string; error: string | null }>(
      '/demo/reset/status',
    );
    if (status.state === 'DONE') {
      expect(status.dataset ?? '120').toBe('120');
      return;
    }
    if (status.state === 'FAILED') throw new Error(`reset to 120 failed: ${status.error ?? 'no reason'}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('reset to 120 did not finish');
}

async function commitPlan(request: APIRequestContext): Promise<string> {
  const api = await apiAs(request, 'p.planner');
  const plan = await api.get<PlanState>('/planner/plan');
  if (plan.state === 'COMMITTED' && plan.committedDraft) return plan.committedDraft.id;
  const draft = await api.post('/planner/drafts', { seed: plan.defaultSeed });
  expect([200, 201]).toContain(draft.status);
  const id = (draft.body as { id: string }).id;
  const preview = await api.get<{ version: number; warningCount: number }>(
    `/planner/drafts/${id}/commit-preview`,
  );
  const committed = await api.postIfMatch(`/planner/drafts/${id}/commit`, preview.version, {
    acceptedWarningCount: preview.warningCount,
  });
  expect(committed.status).toBe(200);
  return id;
}

test.describe('preferences after a commit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the preferences need the real api');
  });

  test('@api an N12 officer who asked for 12 h nights shows Met', async ({ page, request }) => {
    test.setTimeout(300_000);
    await resetTo120(request);
    const draftId = await commitPlan(request);

    const api = await apiAs(request, 'p.planner');
    const prefs = await api.get<PreferenceRow[]>('/planner/preferences');
    const nightCrew = prefs.filter(
      (row) => row.shiftLength === 12 && row.timesOfDay.includes('NIGHT') && row.inDraft === 'MET',
    );
    expect(nightCrew.length, 'N12 crew officers who asked for 12 h nights').toBeGreaterThan(0);
    const officer = nightCrew[0];

    // Their committed plan really is N12: the status is not a coincidence.
    const units = await api.get<Unit[]>('/units');
    const unit = units.find((entry) => entry.name === officer.unitName);
    expect(unit, `the unit ${officer.unitName} is on the reference list`).toBeTruthy();
    const schedule = await api.get<Schedule>(
      `/planner/drafts/${draftId}/schedule?unitId=${unit!.id}&from=2027-01-04&to=2027-01-10`,
    );
    const roster = schedule.officers.find((row) => row.employeeId === officer.employeeId);
    expect(
      roster?.cells.some((cell) => cell.items.some((item) => item.shiftTemplate === 'N12')),
      `${officer.name} works N12 in the committed week`,
    ).toBe(true);

    await signIn(page, 'P. Planner');
    await navTo(page, 'Preferences');
    await expect(page.getByRole('heading', { name: 'Officer preferences', level: 1 })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: officer.name });
    await expect(row).toBeVisible();
    await expect(row.getByText('Met', { exact: true })).toBeVisible();
  });
});
