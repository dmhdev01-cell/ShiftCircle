import { expect } from '@playwright/test';

import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

import { apiAs } from './api';
import { expectAccessible } from './support';
import { shot } from './shots';

/**
 * Quarter plan readability (fit-gap i-6, planux A6–A8): on Dataset 120 the
 * scorecard says how much part-time capacity is unused, the Gaps tab groups
 * the short block-days into runs under a weeks x units strip, and the Roster
 * tab has a week picker with gap counts, "this week" in the unit picker, the
 * all-units table collapsed, and a ⚠ on each draft chip a rule warning names.
 *
 * Called from dataset120.spec.ts once the planner is on the Quarter plan of
 * Dataset 120 (committed): no reset of its own, so it adds no stack-wide write
 * to a parallel run.
 */

interface Band {
  band: string;
  officers: number;
  targetHours: number;
  plannedAvg: number;
}

interface Draft {
  id: string;
  scorecard: { coverage: { shortBlockDays: number }; fteBands?: { bands: Band[] } };
}

interface WarningGroup {
  ruleName: string;
  items: { unitCode: string; date: string; employeeName: string; shift: string; message: string }[];
}

function mondayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return parsed.toISOString().slice(0, 10);
}

export async function checkQuarterPlanReadability(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const plan = await api.get<{ draft: Draft | null; committedDraft?: Draft | null }>('/planner/plan');
  const draft = (plan.draft ?? plan.committedDraft)!;

  // The part-time line, from the scorecard's own FTE bands. This recomputes
  // the page's own sum, so it cross-checks the UI against the api's bands; the
  // formula itself is pinned with fixed numbers in quarterPlan.test.ts.
  const partTime = (draft.scorecard.fteBands?.bands ?? []).filter((band) => band.band !== 'FULL_TIME');
  const planned = Math.round(partTime.reduce((sum, band) => sum + band.officers * band.plannedAvg, 0));
  const target = Math.round(partTime.reduce((sum, band) => sum + band.officers * band.targetHours, 0));
  const line = page.getByRole('note', { name: 'Unused part-time capacity' });
  await expect(line).toContainText(
    `Unused part-time capacity: ${Math.max(0, target - planned).toLocaleString('en-CA')} h.`,
  );
  await expect(line).toContainText(
    `planned ${planned.toLocaleString('en-CA')} h of their ${target.toLocaleString('en-CA')} h target`,
  );
  await shot(page, testInfo, 'planner', 'quarter-plan', 'scorecard-part-time');

  // Gaps: the tab label is unchanged; the gaps come grouped, under the strip.
  const gapCount = draft.scorecard.coverage.shortBlockDays;
  await page.getByRole('tab', { name: `Gaps (${gapCount})` }).click();
  await expect(page.getByText(`${gapCount} block-days are short.`)).toBeVisible();
  const strip = page.getByRole('table', { name: 'Gaps by week and unit' });
  await expect(strip.getByRole('columnheader')).toHaveCount(15);
  const runs = page.getByRole('table', { name: 'Gaps grouped into runs' });
  await expect(runs.getByRole('button', { name: /^Show week of / }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`^${gapCount} short block-days in \\d+ runs?`))).toBeVisible();
  await expect(
    runs.getByText('No eligible officer was free without breaking a blocking rule. A supervisor fills it on the planning board.').first(),
  ).toBeVisible();
  await expectAccessible(page, testInfo, 'planner-gaps-runs', '[role="tabpanel"]');
  await shot(page, testInfo, 'planner', 'quarter-plan', 'gaps-runs-strip');

  // A strip cell opens that unit's week on the Roster tab.
  await strip.getByRole('button', { name: /gaps?\. Show week$/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Roster' })).toHaveAttribute('aria-selected', 'true');

  // Roster: the week picker, "this week" counts, the all-units table closed.
  const weeks = page.getByLabel('Go to week');
  await expect(weeks.getByRole('option')).toHaveCount(14);
  await expect(weeks.getByRole('option').first()).toHaveText(/^Week 1 · 4 – 10 Jan 2027 · (no gaps|\d+ gaps?) in all units$/);
  const unitOptions = await page.getByLabel('Unit', { exact: true }).getByRole('option').allTextContents();
  expect(unitOptions.every((text) => / · (no gaps|\d+ gaps?) this week(, \d+ in the quarter)?$/.test(text))).toBe(true);
  const allUnits = page.getByRole('region', { name: /^All units · / });
  await expect(allUnits.getByRole('table')).toHaveCount(0);
  await allUnits.getByRole('button', { name: 'Show all units' }).click();
  await expect(allUnits.getByRole('table')).toBeVisible();
  await allUnits.getByRole('button', { name: 'Hide all units' }).click();

  // A8: a warning's chip carries a ⚠ with the message as its name.
  const groups = await api.get<WarningGroup[]>(`/planner/drafts/${draft.id}/warnings`);
  const group = groups.find((entry) => entry.items.length > 0)!;
  const item = group.items[0];
  const units = await api.get<{ id: string; code: string }[]>('/planner/units');
  const unit = units.find((entry) => entry.code === item.unitCode)!;
  await page.getByLabel('Unit', { exact: true }).selectOption(unit.id);
  await weeks.selectOption(mondayOf(item.date));
  const marker = page.getByRole('img', { name: `Rule warning: ${group.ruleName}: ${item.message}` }).first();
  await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.focus();
  await expect(page.getByRole('tooltip')).toContainText(item.message);
  await expect(page.locator(`td[data-date="${item.date}"]`).getByRole('img', { name: /^Rule warning/ }).first()).toBeVisible();
  await expectAccessible(page, testInfo, 'planner-roster-quarter', '[role="tabpanel"]');
  await marker.scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'planner', 'quarter-plan', 'roster-week-picker-warning');
}
