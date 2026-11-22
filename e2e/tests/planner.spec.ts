import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { ensurePlannableQuarter, navTo, selectUnit, signIn, signOut } from './support';

/**
 * An empty cell in Unit A or B on the plan's first week that a shift can be
 * saved into (the rules may warn, but must not block). The supervisor edit is
 * the same live rule-check path the planning-override spec walks.
 */
async function aSavableSlot(
  request: APIRequestContext,
): Promise<{ unit: string; unitName: string; officer: string; date: string }> {
  const api = await apiAs(request, 'm.ellis');
  const units = await api.get<{ id: string; code: string; name: string }[]>('/units');
  for (const code of ['B', 'A']) {
    const unit = units.find((entry) => entry.code === code)!;
    const schedule = await api.get<{
      officers: { employeeId: string; name: string; cells: { date: string; items: { type: string }[] }[] }[];
    }>(`/schedule?unitId=${unit.id}&from=2027-01-04&to=2027-01-10`);
    for (const officer of schedule.officers) {
      for (const cell of officer.cells) {
        if (cell.items.length > 0) continue;
        const preview = await api.post('/rule-checks', {
          change: {
            type: 'ASSIGN',
            employeeId: officer.employeeId,
            unitId: unit.id,
            shiftTemplate: 'D8',
            startAt: `${cell.date}T07:00:00-06:00`,
          },
        });
        const results = (preview.body as { ruleResults?: { outcome: string }[] }).ruleResults ?? [];
        if (preview.status === 200 && !results.some((result) => result.outcome === 'BLOCK')) {
          return { unit: unit.id, unitName: unit.name, officer: officer.name, date: cell.date };
        }
      }
    }
  }
  throw new Error('no savable empty cell in Unit A or B for the plan week');
}

/**
 * The quarter planner (docs/ui/planner.md): the planner generates a draft for
 * the whole quarter, reads the scorecard and gaps, commits it with the warning
 * list accepted, and a supervisor then opens the committed week on the board.
 *
 * The window is Mon 4 Jan - Sun 11 Apr 2027 (7 pay periods).
 */

test.describe('the quarter plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the planner needs the real api');
  });

  test('generate, read, commit, then a supervisor changes one shift', async ({ page, request }) => {
    test.setTimeout(180_000);
    // The demo's own way back from a committed quarter is a reset; this spec
    // must generate, so it starts from the seeded uncommitted one.
    await ensurePlannableQuarter(request);
    await signIn(page, 'P. Planner');
    await expect(page.getByRole('heading', { name: 'Quarter plan', level: 1 })).toBeVisible();
    // The window and the planner's own nav.
    await expect(page.getByText(/4 Jan – 11 Apr 2027/)).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
    await expect(nav).toHaveText([
      'Quarter plan',
      'Preferences',
      'Units',
      'Planning board',
      'Reports',
      'About & version',
    ]);

    await page.getByRole('button', { name: 'Generate draft' }).click();
    // The scorecard appears: the six tiles and the two panels.
    await expect(page.getByText('Coverage gaps')).toBeVisible({ timeout: 60_000 });
    for (const tile of ['Rule warnings', 'Preferences met', 'Night fairness', 'Overtime built in', 'Generated in']) {
      await expect(page.getByText(tile, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Night shifts by seniority' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preferences by kind' })).toBeVisible();
    await expect(page.getByText(/Held|Not held/).first()).toBeVisible();

    // The gaps tab names the short block-days.
    await page.getByRole('tab', { name: /Gaps/ }).click();
    await expect(page.getByText(/block-days are short/)).toBeVisible();

    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await page.getByRole('button', { name: 'Commit plan…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/shifts/).first()).toBeVisible();
    const commit = dialog.getByRole('button', { name: 'Commit plan' });
    await expect(commit).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(commit).toBeEnabled();
    await commit.click();

    await expect(page.getByRole('heading', { name: 'Plan committed' })).toBeVisible({ timeout: 120_000 });

    // A supervisor sees the committed plan on the board's first week
    // (Mon 4 Jan 2027): walk there from the demo week with the week buttons.
    await signOut(page, 'P. Planner');
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');

    // Observation 29: the help legend reads the published rule tables.
    await page.getByRole('button', { name: 'Rules help' }).click();
    const help = page.getByRole('dialog', { name: 'Rules help' });
    await expect(help).toBeVisible();
    await expect(help.getByText(/U-14 · /)).toBeVisible();
    await expect(help.getByText(/Warns above 48 h in 7 days; blocks above 60 h\./)).toBeVisible();
    await expect(help.getByText('No override: choose someone else').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    for (let week = 0; week < 7; week += 1) {
      await page.getByRole('button', { name: 'Next week' }).click();
    }
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('4 – 10 Jan 2027');
    await expect(page.getByRole('button', { name: /A12|P12|D8/ }).first()).toBeVisible();

    // The supervisor changes one shift with the usual live rule check.
    const slot = await aSavableSlot(request);
    await selectUnit(page, slot.unitName);
    const cell = page.getByRole('button', {
      name: `Off - assign a shift to ${slot.officer} on ${slot.date}`,
    });
    await cell.click();
    await page.getByRole('button', { name: 'D8 · Day 8 h' }).click();
    const panel = page.getByRole('region', { name: 'Rule check' });
    const save = panel.getByRole('button', { name: /^(Assign shift|Acknowledge and assign)$/ });
    await expect(save).toBeVisible({ timeout: 15_000 });
    await save.click();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(cell).toHaveCount(0, { timeout: 10_000 });
  });
});
