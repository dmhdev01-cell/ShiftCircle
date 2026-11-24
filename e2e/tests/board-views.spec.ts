import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { shot } from './shots';
import { expectAccessible, signIn } from './support';

/**
 * A1 / A4 / A5: the planning board as a scheduling grid. Week stays the
 * default (demo §2 is unchanged); Pay period and Month are one click away,
 * with a compact density, a chip strip for the figures, totals per officer
 * and per day, coverage heat cells and qualification badges.
 *
 * Read-only: nothing here changes data, so it is safe in any order.
 */

async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

/** The page itself never scrolls sideways; only the roster region may. */
async function expectNoPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('the planning board views', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the ranges and figures come from the real api');
  });

  test('keeps the week by default, then shows the pay period and the month', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await settled(page);

    // The default is the demo week, comfortable, with the five tiles.
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('16 – 22 Nov 2026');
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('list', { name: 'Board figures' })).toHaveCount(0);
    const roster = page.getByRole('region', { name: 'Roster, scrolls sideways' });
    await expect(roster.getByRole('rowheader', { name: 'On duty · hours' })).toBeVisible();
    await expect(roster.getByRole('columnheader', { name: /Shifts · h/ })).toBeVisible();
    await shot(page, testInfo, 'supervisor', 'planning', 'week-comfortable');

    await page.getByRole('button', { name: 'Pay period', exact: true }).click();
    await settled(page);
    await expect(page).toHaveURL(/view=period/);
    await expect(page.getByRole('group', { name: 'Pay period' })).toContainText('9 – 22 Nov 2026');
    await expect(page.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
    // The 2026 demo publishes week by week: two weeks are never called "Not published".
    await expect(page.getByTestId('publish-scope')).toContainText('Spans two roster weeks');
    await expect(page.getByText('Not published', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish period' })).toHaveCount(0);
    const strip = page.getByRole('list', { name: 'Board figures' });
    await expect(strip.getByRole('listitem')).toHaveCount(5);
    // 14 day columns after Officer, Shifts · h and Pay period.
    await expect(roster.getByRole('columnheader')).toHaveCount(17);
    await expect(roster.getByLabel(/^\d+ on duty, /)).toHaveCount(14);
    await expectNoPageScroll(page);
    await expectAccessible(page, testInfo, 'planning-pay-period-compact');
    await shot(page, testInfo, 'supervisor', 'planning', 'pay-period-compact');

    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByRole('group', { name: 'Pay period' })).toContainText('23 Nov – 6 Dec 2026');
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByRole('group', { name: 'Pay period' })).toContainText('9 – 22 Nov 2026');

    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await settled(page);
    await expect(page.getByRole('group', { name: 'Month' })).toContainText('1 – 30 Nov 2026');
    await expect(page.getByTestId('publish-scope')).toContainText('Spans several roster periods');
    await expect(roster.getByLabel(/^\d+ on duty, /)).toHaveCount(30);
    await expectNoPageScroll(page);
    await expectAccessible(page, testInfo, 'planning-month-compact');
    await shot(page, testInfo, 'supervisor', 'planning', 'month-compact');

    await page.getByRole('button', { name: 'Comfortable' }).click();
    await expect(page).toHaveURL(/density=comfortable/);
    await expect(strip).toHaveCount(0);
    await expectAccessible(page, testInfo, 'planning-month-comfortable');

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('16 – 22 Nov 2026');
    await expect(page).not.toHaveURL(/view=|density=/);
    // Back on a week, the state and the action return.
    await expect(page.getByText('Not published', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish period' })).toBeVisible();
  });

  test('shows qualification badges and keeps the demo week figures', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await settled(page);
    const roster = page.getByRole('region', { name: 'Roster, scrolls sideways' });
    await expect(roster.getByRole('img', { name: /^Qualified: / }).first()).toBeVisible();
    // Demo §2 reads these off the tiles; the week view keeps them as tiles.
    await expect(page.getByText('Coverage gaps', { exact: true })).toBeVisible();
    await expect(page.getByText('In overtime', { exact: true }).first()).toBeVisible();
  });

  test('falls back to the demo week for a malformed ?week=', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await settled(page);
    await page.goto('/planning?week=not-a-date');
    await settled(page);
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('16 – 22 Nov 2026');
  });

  test('fits a phone: the page never scrolls sideways', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'M. Ellis');
    await settled(page);
    await expectNoPageScroll(page);
    await shot(page, testInfo, 'supervisor', 'planning', 'week-390');

    await page.getByRole('button', { name: 'Pay period', exact: true }).click();
    await settled(page);
    await expect(page.getByRole('group', { name: 'Pay period' })).toContainText('9 – 22 Nov 2026');
    await expectNoPageScroll(page);
    await shot(page, testInfo, 'supervisor', 'planning', 'pay-period-390');
  });
});
