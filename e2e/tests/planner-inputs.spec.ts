import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { apiAs } from './api';
import { expectAccessible, navTo, signIn } from './support';
import { shot } from './shots';

/**
 * PR-M plan inputs: the Quarter plan says what the generator works from, before
 * a draft (what Generate will use) and with one (the draft's own snapshot), and
 * the figures are the api's GET /planner/inputs. Datasets 150 and 120.
 *
 * Stack-wide: it resets the demo data and generates a draft, so it runs in the
 * `<viewport>-datasets` project. It leaves the stack on Dataset 100.
 */

interface Inputs {
  officers: { total: number; fullTime: number; partTime: number; fte: number; neededFte: number | null };
  leave: { days: number; byType: Record<string, number> };
  preferences: { officers: number };
  rules: { ruleSetVersion: number };
}

async function resetTo(request: APIRequestContext, dataset: '100' | '120' | '150'): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.get<{ state: string; error: string | null }>('/demo/reset/status');
    if (status.state === 'DONE') return;
    if (status.state === 'FAILED') throw new Error(`demo reset failed: ${status.error ?? 'no reason'}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('demo reset did not finish');
}

test.describe('plan inputs on the quarter plan', () => {
  test.setTimeout(240_000);

  test.afterAll(async ({ request }) => {
    await resetTo(request, '100');
  });

  test('@api Dataset 150: the headline and the inputs before and after Generate', async ({
    page,
    request,
  }, testInfo) => {
    await resetTo(request, '150');
    const api = await apiAs(request, 'p.planner');
    const inputs = await api.get<Inputs>('/planner/inputs');
    expect(inputs.officers).toMatchObject({ total: 150, fullTime: 120, partTime: 30, fte: 138 });
    expect(inputs.leave.days).toBeGreaterThan(0);

    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByText('No plan for this quarter yet.')).toBeVisible();
    await expect(page.getByText('Plan inputs · what Generate will use')).toBeVisible();
    const headline = page.getByTestId('plan-inputs-headline');
    await expect(headline).toHaveText(
      `Planning 150 officers in 6 units · 120 full-time, 30 part-time or casual · 138 FTE against about ${inputs.officers.neededFte} needed · 4 Jan – 11 Apr 2027`,
    );
    await expect(
      page.getByText(
        `Default seed 20261001 · 8 h officers on their own pattern · rule set v${inputs.rules.ruleSetVersion} · ${inputs.leave.days.toLocaleString('en-CA')} planned leave days`,
        { exact: false },
      ),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Show plan inputs' }).click();
    const detail = page.getByRole('region', { name: 'Plan inputs detail' });
    await expect(detail.getByRole('heading', { name: 'Officers by unit' })).toBeVisible();
    await expect(detail.getByRole('row', { name: /Unit A · Living unit/ })).toContainText('12 h day crew, 4 on, 4 off');
    await expect(detail.getByRole('row', { name: /Unit A · Living unit/ })).toContainText('part-time or casual');
    await expect(detail.getByText('· Vacation')).toBeVisible();
    await expect(detail.getByText('· 16 h shifts (not rostered)')).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'How the plan is filled' })).toBeVisible();
    await expect(detail.locator('ol > li')).toHaveCount(5);
    await expectAccessible(page, testInfo, 'planner-inputs-open');
    await shot(page, testInfo, 'planner', 'quarter-plan', 'inputs-open-150');

    // Generate: the same figures, now as the draft's own snapshot, above the scorecard.
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Plan inputs · what this draft was generated with')).toBeVisible();
    await expect(headline).toContainText('Planning 150 officers in 6 units · 120 full-time, 30 part-time or casual');
    await expect(page.getByText(/^Seed 20261001 · 8 h officers on their own pattern/)).toBeVisible();
    await expect(page.getByText('have changed since this draft was generated', { exact: false })).toHaveCount(0);
    const tablist = page.getByRole('tablist', { name: 'Quarter plan' });
    const [headBox, tabBox] = [await headline.boundingBox(), await tablist.boundingBox()];
    expect(headBox && tabBox && headBox.y < tabBox.y, 'the inputs sit above the scorecard').toBeTruthy();
    await shot(page, testInfo, 'planner', 'quarter-plan', 'inputs-draft-150');

    // GET /planner/plan carries the same snapshot on the draft.
    const plan = await api.get<{ draft: { scorecard: { inputs: Inputs } } }>('/planner/plan');
    expect(plan.draft.scorecard.inputs.officers).toEqual(inputs.officers);
  });

  test('@api Dataset 120: the headline counts the casual relief pool', async ({ page, request }) => {
    await resetTo(request, '120');
    const api = await apiAs(request, 'p.planner');
    const inputs = await api.get<Inputs>('/planner/inputs');
    expect(inputs.officers).toMatchObject({ total: 120, fullTime: 100, partTime: 20 });
    expect(inputs.leave.days).toBe(0);

    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByTestId('plan-inputs-headline')).toHaveText(
      `Planning 120 officers in 6 units · 100 full-time, 20 part-time or casual · ${inputs.officers.fte} FTE against about ${inputs.officers.neededFte} needed · 4 Jan – 11 Apr 2027`,
    );
    await page.getByRole('button', { name: 'Show plan inputs' }).click();
    const detail = page.getByRole('region', { name: 'Plan inputs detail' });
    await expect(detail.getByRole('row', { name: /Escort/ })).toContainText('12 h relief pool, no fixed rotation');
  });
});
