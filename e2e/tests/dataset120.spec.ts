import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, selectUnit, signIn } from './support';

/**
 * Dataset 120 (100 full-time crews + ~20 casuals): the planner's scorecard
 * reports gaps in a loose bound, a supervisor fills one on the board, and an
 * illegal fifth consecutive 12 h shift is refused by the rules.
 *
 * Resets the stack to dataset 120 itself (beforeEach, through the api), so it
 * runs alone or in any order.
 */

/**
 * A reset to dataset 120 through the api, so this spec stands alone: Playwright
 * gives no ordering across files and a verifier may run it by itself.
 */
async function resetTo120(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset: '120' });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await api.get<{ state: string; dataset: string; error: string | null }>(
      '/demo/reset/status',
    );
    if (status.state === 'DONE') {
      expect(status.dataset).toBe('120');
      return;
    }
    if (status.state === 'FAILED') {
      throw new Error(`reset to 120 failed: ${status.error ?? 'no reason'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('reset to 120 did not finish');
}

interface PlanState {
  state: string;
  defaultSeed: number;
  committedDraft?: { id: string } | null;
}

async function committedPlan(request: APIRequestContext): Promise<string> {
  const api = await apiAs(request, 'p.planner');
  const plan = await api.get<PlanState>('/planner/plan');
  if (plan.state === 'COMMITTED' && plan.committedDraft) return plan.committedDraft.id;
  const draft = await api.post('/planner/drafts', { seed: plan.defaultSeed });
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

test.describe('dataset 120', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the crews and casuals need the real api');
    await resetTo120(request);
  });

  test('the scorecard shows gaps, a supervisor fills one, and a fifth 12 h day is refused', async ({
    page,
    request,
  }) => {
    // A committed 2027 plan on this dataset.
    const draftId = await committedPlan(request);
    const api = await apiAs(request, 'p.planner');
    const gaps = await api.get<{ unitId: string; unitName: string; date: string }[]>(
      `/planner/drafts/${draftId}/gaps`,
    );
    // Loose bound: the 120 dataset leaves gaps for overtime, not a clean roster.
    expect(gaps.length, 'gaps on dataset 120').toBeGreaterThan(20);

    // The planner sees them counted.
    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByRole('tab', { name: /Gaps/ })).toBeVisible();

    // A supervisor fills one gap on the committed board (demo step 7).
    const gap = gaps[0];
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');
    await selectUnit(page, gap.unitName);
    for (let week = 0; week < 8; week += 1) {
      const next = page.getByRole('button', { name: 'Next week' });
      if (await next.isEnabled()) await next.click();
    }
    const cell = page.getByRole('button', { name: new RegExp(`Off - assign a shift to .* on ${gap.date}`) });
    if (await cell.count()) {
      await cell.first().click();
      await page.getByRole('button', { name: /D8 · Day 8 h|D12 · Day 12 h/ }).first().click();
      const panel = page.getByRole('region', { name: 'Rule check' });
      const save = panel.getByRole('button', { name: /^(Assign shift|Acknowledge and assign)$/ });
      await expect(save).toBeVisible({ timeout: 15_000 });
      await save.click();
      await panel.getByRole('button', { name: 'Done' }).click();
      await expect(cell.first()).toHaveCount(0, { timeout: 10_000 });
    }

    // An illegal fifth consecutive 12 h shift is refused: five D12 days in a
    // row for one officer, previewed through the api (the board's own check).
    const units = await api.get<{ id: string }[]>('/units');
    const employees = await api.get<{ id: string; first_name: string; last_name: string }[]>('/employees');
    const officer = employees[0];
    let blocked = false;
    for (let start = 1; start <= 4 && !blocked; start += 1) {
      const days = [0, 1, 2, 3, 4].map((offset) => `2027-02-${String(start + offset).padStart(2, '0')}`);
      const previews = await Promise.all(
        days.map((date) =>
          api.post('/rule-checks', {
            change: {
              type: 'ASSIGN',
              employeeId: officer.id,
              unitId: units[0].id,
              shiftTemplate: 'D12',
              startAt: `${date}T07:00:00-06:00`,
            },
          }),
        ),
      );
      blocked = previews.some((response) =>
        ((response.body as { ruleResults?: { outcome: string; ruleCode: string }[] }).ruleResults ?? []).some(
          (result) => result.outcome === 'BLOCK',
        ),
      );
    }
    expect(blocked, 'a fifth consecutive 12 h day is blocked by the rules').toBe(true);
  });
});
