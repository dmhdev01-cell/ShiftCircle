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
  officers: { total: number; fullTime: number; partTime: number; fte: number; neededFte: number | null; units?: number };
  leave: { days: number; byType: Record<string, number> };
  preferences: { officers: number };
  rules: { ruleSetVersion: number };
}

interface StaffingTotals {
  allocated: number;
  filled: number;
  needed: number;
  shortfall: number;
}

interface Staffing {
  periods: { from: string; units: { unitName: string; shortfall: number }[]; totals: StaffingTotals }[];
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
    // Release v1.3 (S4): the 150 officers plus 12 supervisors (11 full-time, one 0.6 FTE) on
    // 6 units and 2 supervisor posts. Since S7 the headline words the split; the full-time,
    // part-time and FTE figures count both ranks.
    expect(inputs.officers).toMatchObject({ total: 162, fullTime: 131, partTime: 31, fte: 149.6, units: 8 });
    expect(inputs.leave.days).toBeGreaterThan(0);

    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByText('No plan for this quarter yet.')).toBeVisible();
    await expect(page.getByText('Plan inputs · what Generate will use')).toBeVisible();
    const headline = page.getByTestId('plan-inputs-headline');
    await expect(headline).toHaveText(
      `Planning 150 officers + 12 supervisors in 6 units + 2 supervisor posts · 131 full-time, 31 part-time or casual · 149.6 FTE against about ${inputs.officers.neededFte} needed · 4 Jan – 11 Apr 2027`,
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
    // Release v1.3 S7: the posts have their own table; the part-time supervisor is on SUP-O.
    await expect(detail.getByRole('heading', { name: 'Supervisors by post' })).toBeVisible();
    await expect(detail.getByRole('row', { name: /Supervision · Operations/ })).toContainText('part-time or casual');
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
    await expect(headline).toContainText(
      'Planning 150 officers + 12 supervisors in 6 units + 2 supervisor posts · 131 full-time, 31 part-time or casual',
    );
    await expect(page.getByText(/^Seed 20261001 · 8 h officers on their own pattern/)).toBeVisible();
    await expect(page.getByText('have changed since this draft was generated', { exact: false })).toHaveCount(0);
    const tablist = page.getByRole('tablist', { name: 'Quarter plan' });
    const [headBox, tabBox] = [await headline.boundingBox(), await tablist.boundingBox()];
    expect(headBox && tabBox && headBox.y < tabBox.y, 'the inputs sit above the scorecard').toBeTruthy();
    await shot(page, testInfo, 'planner', 'quarter-plan', 'inputs-draft-150');

    // Release v1.3 S7: the scorecard's supervisor card, and the commit dialog's rank split.
    const card = page.getByRole('region', { name: 'Supervisor posts' });
    await expect(card).toContainText('Supervisor posts covered 495 of 588 block-days; 93 short.');
    await expect(card).toContainText('The cards above count the officers and the officer units only.');
    await card.scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'planner', 'quarter-plan', 'supervisor-card-150');
    const draftId = (await api.get<{ draft: { id: string } }>('/planner/plan')).draft.id;
    const preview = await api.get<{
      shiftsToWrite: number;
      officers: number;
      supervisors: number;
      officerShifts: number;
      supervisorShifts: number;
    }>(`/planner/drafts/${draftId}/commit-preview`);
    expect(preview.supervisors).toBe(12);
    const n = (value: number) => value.toLocaleString('en-CA');
    await page.getByRole('button', { name: 'Commit plan…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      `This writes ${n(preview.shiftsToWrite)} shifts (${n(preview.officerShifts)} officer + ${n(preview.supervisorShifts)} supervisor) for ${n(preview.officers)} officers and 12 supervisors,`,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // GET /planner/plan carries the same snapshot on the draft.
    const plan = await api.get<{ draft: { scorecard: { inputs: Inputs } } }>('/planner/plan');
    expect(plan.draft.scorecard.inputs.officers).toEqual(inputs.officers);
  });

  test('@api Dataset 120: the headline counts the casual relief pool', async ({ page, request }) => {
    await resetTo(request, '120');
    const api = await apiAs(request, 'p.planner');
    const inputs = await api.get<Inputs>('/planner/inputs');
    // Release v1.3 (S4): the 120 officers plus 10 full-time supervisors on the 2 posts; S7 words
    // the split in the headline.
    expect(inputs.officers).toMatchObject({ total: 130, fullTime: 110, partTime: 20, units: 8 });
    expect(inputs.leave.days).toBe(0);

    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    await expect(page.getByTestId('plan-inputs-headline')).toHaveText(
      `Planning 120 officers + 10 supervisors in 6 units + 2 supervisor posts · 110 full-time, 20 part-time or casual · ${inputs.officers.fte} FTE against about ${inputs.officers.neededFte} needed · 4 Jan – 11 Apr 2027`,
    );
    await page.getByRole('button', { name: 'Show plan inputs' }).click();
    const detail = page.getByRole('region', { name: 'Plan inputs detail' });
    await expect(detail.getByRole('row', { name: /Escort/ })).toContainText('12 h relief pool, no fixed rotation');
  });

  // v1.2 walk D1: the api names the figure "shortfall"; the screen read
  // "short" and said "Short 0 · every unit meets the floor" under a headline
  // of "112 FTE against about 127 needed". The headline, the Staffing by unit
  // panel and the "Needed (at least)" tile now say the same thing.
  for (const dataset of ['120', '150', '100'] as const) {
    test(`@api Dataset ${dataset}: the headline, the staffing panel and the tile agree`, async ({
      page,
      request,
    }) => {
      await resetTo(request, dataset);
      const api = await apiAs(request, 'p.planner');
      const inputs = await api.get<Inputs>('/planner/inputs');
      const staffing = await api.get<Staffing>('/planner/staffing');
      const worst = staffing.periods.reduce(
        (best, period) => (period.totals.shortfall > best.totals.shortfall ? period : best),
        staffing.periods[0],
      );
      expect(inputs.officers.neededFte, 'the headline needs what the floor needs').toBe(worst.totals.needed);
      if (dataset === '120') {
        // Release v1.3 (S4): the two supervisor posts need 5 each and have 5 each, so the
        // shortfall stays 7 (the officers' units).
        expect(staffing.periods[0].totals).toMatchObject({ needed: 137, filled: 130, shortfall: 7 });
      }

      await signIn(page, 'P. Planner');
      await navTo(page, 'Quarter plan');
      await expect(page.getByTestId('plan-inputs-headline')).toContainText(
        `${inputs.officers.fte} FTE against about ${inputs.officers.neededFte} needed`,
      );

      const panel = page.getByTestId('staffing-panel');
      const totalRow = panel.getByRole('row', { name: /^All units/ });
      const cells = staffing.periods.map((period) => String(period.totals.needed)).concat(
        staffing.periods.map((period) => String(period.totals.shortfall)),
      );
      await expect(totalRow.locator('td')).toHaveText([
        'All units',
        String(staffing.periods[0].totals.allocated),
        String(staffing.periods[0].totals.filled),
        ...cells,
      ]);
      const first = staffing.periods[0];
      if (first.totals.shortfall > 0) {
        await expect(panel.getByText(`Do we need more staff? Yes, at least ${first.totals.shortfall} more:`, { exact: false })).toBeVisible();
        for (const unit of first.units.filter((row) => row.shortfall > 0)) {
          await expect(panel.getByRole('row', { name: unit.unitName })).toContainText(`${unit.shortfall}Short`);
        }
      } else {
        await expect(panel.getByText('every unit meets the floor', { exact: false }).first()).toBeVisible();
      }

      await page.getByRole('button', { name: 'Generate draft' }).click();
      await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 120_000 });
      const tile = page.getByTestId('staffing-tile');
      await expect(tile).toContainText(`Needed (at least)${worst.totals.needed}`);
      if (worst.totals.shortfall > 0) {
        await expect(tile).toContainText(`Short${worst.totals.filled} on staff · short ${worst.totals.shortfall}`);
      } else {
        await expect(tile).toContainText(`Meets the floor${worst.totals.filled} on staff`);
      }
    });
  }
});
