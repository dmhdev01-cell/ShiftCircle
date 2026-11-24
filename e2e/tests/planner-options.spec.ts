import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { expectAccessible, resetDemoData, signIn } from './support';

/**
 * v1.2 plan options (PR-N) on Dataset 150: the landing offers the options at
 * their defaults, the draft says what it was made with, Generate again is
 * filled in from the last draft, and "Fill up to each officer's FTE" leaves
 * less unused part-time capacity on the scorecard than the default.
 *
 * Stack-wide: it resets to 150, generates twice and resets back to 100.
 */

/** "Unused part-time capacity: 3,515 h." -> 3515 */
async function unusedHours(page: import('@playwright/test').Page): Promise<number> {
  const line = page.getByRole('note', { name: 'Unused part-time capacity' });
  await expect(line).toBeVisible();
  const text = (await line.textContent()) ?? '';
  const match = /Unused part-time capacity: ([\d,]+) h/.exec(text);
  expect(match, text).not.toBeNull();
  return Number(match![1].replace(/,/g, ''));
}

async function settled(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.getAnimations().every((animation) => animation.playState !== 'running'),
    undefined,
    { timeout: 15_000 },
  );
}

test.describe('plan options', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'the options need the real api');
  });

  test.afterAll(async ({ request }) => {
    if (process.env.E2E_MODE === 'fixtures') return;
    test.setTimeout(180_000);
    await resetDemoData(request, '100');
  });

  test('@api defaults first, then Generate again filled in, then fill part-time up to FTE', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    await resetDemoData(request, '150');
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();

    // The landing: the options at their defaults, each with its sentence.
    const landing = page.getByRole('group', { name: 'Plan options' });
    await expect(landing.getByRole('checkbox', { name: /Full-time officers/ })).toBeChecked();
    await expect(landing.getByRole('checkbox', { name: /Full-time officers/ })).toBeDisabled();
    await expect(landing.getByRole('checkbox', { name: /Part-time and casual officers/ })).toBeChecked();
    await expect(landing.getByRole('radio', { name: /Fill gaps only/ })).toBeChecked();
    await expect(landing.getByRole('checkbox', { name: /Cover gaps from other units/ })).not.toBeChecked();
    await expectAccessible(page, testInfo, 'planner-options-landing', '[role="group"][aria-label="Plan options"]');

    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('plan-options-used')).toHaveText(
      'Made with: full-time and part-time officers · part-time fills gaps only',
    );
    const before = await unusedHours(page);
    expect(before, 'Dataset 150 leaves part-time capacity unused by default').toBeGreaterThan(1000);

    // Generate again: filled in from the draft; choose the FTE fill.
    await expect(page.getByRole('button', { name: 'Generate again' })).toBeEnabled();
    await page.getByRole('button', { name: 'Generate again' }).click();
    const dialog = page.getByRole('dialog');
    const again = dialog.getByRole('group', { name: 'Plan options' });
    await expect(again.getByRole('radio', { name: /Fill gaps only/ })).toBeChecked();
    await settled(page);
    await expectAccessible(page, testInfo, 'planner-options-dialog', '[role="dialog"]');
    await again.getByRole('radio', { name: /Fill up to each officer's FTE/ }).check();
    await dialog.getByRole('button', { name: 'Replace draft' }).click();
    await expect(page.getByTestId('plan-options-used')).toHaveText(
      'Made with: full-time and part-time officers · part-time filled up to FTE',
      { timeout: 90_000 },
    );
    const after = await unusedHours(page);
    console.log(`Dataset 150 unused part-time capacity: ${before} h -> ${after} h`);
    expect(after).toBeLessThan(before);
    await expect(page.getByRole('note', { name: 'Unused part-time capacity' })).toContainText(
      'filled part-time officers up to their FTE target',
    );

    // The replace says what changed against the previous draft.
    await expect(page.getByRole('note', { name: 'Compared with the previous draft' })).toContainText(
      `unused part-time hours ${before.toLocaleString('en-CA')} h → ${after.toLocaleString('en-CA')} h`,
    );

    // The next Generate again starts from this draft's options; add cover from other units.
    await expect(page.getByRole('button', { name: 'Generate again' })).toBeEnabled();
    await page.getByRole('button', { name: 'Generate again' }).click();
    const third = page.getByRole('dialog');
    await expect(third.getByRole('radio', { name: /Fill up to each officer's FTE/ })).toBeChecked();
    await third.getByRole('checkbox', { name: /Cover gaps from other units/ }).check();
    await third.getByRole('button', { name: 'Replace draft' }).click();
    await expect(page.getByTestId('plan-options-used')).toHaveText(
      'Made with: full-time and part-time officers · part-time filled up to FTE · gaps covered from other units',
      { timeout: 90_000 },
    );
    const covered = page.getByRole('note', { name: 'Gaps covered from other units' });
    await expect(covered).toContainText(/^\d+ gaps covered from other units\./);
    const coveredCount = Number(/^(\d+)/.exec((await covered.textContent()) ?? '')![1]);
    expect(coveredCount, 'Dataset 150 has gaps another unit can cover').toBeGreaterThan(0);
    await expect(page.getByRole('note', { name: 'Compared with the previous draft' })).toContainText(
      `gaps covered from other units 0 → ${coveredCount}`,
    );

    // The roster marks an officer placed from another unit.
    const planner = await apiAs(request, 'p.planner');
    const plan = await planner.get<{ draft: { id: string } }>('/planner/plan');
    const units = await planner.get<{ id: string; code: string }[]>('/units');
    let found: { unit: string; week: string; home: string } | null = null;
    for (let week = 0; week < 14 && !found; week += 1) {
      const monday = new Date(Date.UTC(2027, 0, 4 + week * 7)).toISOString().slice(0, 10);
      const sunday = new Date(Date.UTC(2027, 0, 10 + week * 7)).toISOString().slice(0, 10);
      for (const unit of units) {
        const roster = await planner.get<{ officers: { homeUnit?: string }[] }>(
          `/planner/drafts/${plan.draft.id}/schedule?unitId=${unit.id}&from=${monday}&to=${sunday}`,
        );
        const away = roster.officers.find((officer) => officer.homeUnit);
        if (away) {
          found = { unit: unit.id, week: monday, home: away.homeUnit!.split(' · ')[0] };
          break;
        }
      }
    }
    expect(found, 'a cross-unit officer on the draft roster').not.toBeNull();
    await page.goto(`/planner?tab=roster&unit=${found!.unit}&week=${found!.week}`);
    await expect(page.getByTestId('from-unit').first()).toHaveText(`From ${found!.home}`, { timeout: 30_000 });
  });
});
