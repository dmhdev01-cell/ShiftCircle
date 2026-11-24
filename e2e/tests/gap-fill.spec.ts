import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { shot } from './shots';
import { expectAccessible, selectUnit, signIn } from './support';

/**
 * A2 (mockup 2): fill a gap from the board. The short coverage cells and the
 * gap words open a side panel of the officers free that day in the unit,
 * ranked by pay-period hours, with hints. "Check & assign" runs the same rule
 * check as an empty cell.
 *
 * Read-only: the only check here is a Block (PC-01, Nia on Sat 21 Nov days),
 * so nothing is saved and the spec is safe in any order.
 */

async function unitB(page: Page): Promise<void> {
  await signIn(page, 'M. Ellis');
  await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
  await selectUnit(page, 'Unit B · Living unit');
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Fill gap: Sat days/ })).toBeVisible();
}

test.describe('A2 fill a gap from the board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the gaps and the PC-01 block come from the real api');
  });

  test('@api the gap word opens the ranked free officers; Nia is Blocked with the reasons', async ({ page }, testInfo) => {
    await unitB(page);

    await page.getByRole('button', { name: /^Fill gap: Sat days/ }).click();
    const panel = page.getByRole('region', { name: 'Sat 21 Nov · Days 07:00 – 15:00' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: /^D8 / })).toHaveAttribute('aria-pressed', 'true');
    // The selected cell is marked in the grid.
    await expect(page.getByRole('button', { name: /^Fill gap: Sat 21 Nov days/ })).toHaveAttribute('aria-pressed', 'true');

    const rows = panel.getByRole('list', { name: 'Free officers' }).getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    const hours = (await rows.allTextContents()).map((text) => Number(/([\d.]+) h this pay period/.exec(text)?.[1]));
    expect(hours.length).toBeGreaterThan(1);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));

    // Nia's Saturday is empty, so she is listed, with the hints the board shows.
    const nia = rows.filter({ hasText: 'Nia Thompson' });
    await expect(nia).toHaveCount(1);
    await expect(nia).toContainText(/worked until midnight Fri/);
    await expect(nia).toContainText(/in overtime/);
    await expectAccessible(page, testInfo, 'planning-gap-fill');
    await shot(page, testInfo, 'supervisor', 'planning', 'gap-fill-panel');

    // The same rule check as her empty cell (demo §2): Blocked, reasons, no assign.
    await nia.getByRole('button', { name: 'Check & assign D8: Nia Thompson, Sat 21 Nov' }).click();
    const dock = page.getByRole('region', { name: 'Rule check' });
    await expect(dock.getByText(/Blocked: [234] rules fail/)).toBeVisible();
    await expect(dock.getByRole('heading', { name: /Assign Nia Thompson/ })).toBeVisible();
    await expect(dock.getByText(/U-01 · Minimum rest/)).toBeVisible();
    await expect(dock.getByText(/U-14 · Weekly ceiling/)).toBeVisible();
    await expect(dock.getByRole('button', { name: /^Assign shift$/ })).toHaveCount(0);
    await expect(dock.getByRole('button', { name: 'Emergency override…' })).toHaveCount(0);
    await expect(panel).toBeHidden();
    await expectAccessible(page, testInfo, 'planning-gap-fill-blocked');

    // Closing the verdict brings the panel back; the cell is still empty.
    await dock.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Off - assign a shift to Nia Thompson on 2026-11-21' }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('@api a short coverage cell opens the panel on a phone, without a sideways page scroll', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unitB(page);

    await page.getByRole('button', { name: /^Fill gap: Sat 21 Nov evenings/ }).click();
    const panel = page.getByRole('region', { name: 'Sat 21 Nov · Evenings 15:00 – 23:00' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: /^E8 / })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('link', { name: /Overtime board/ })).toHaveAttribute(
      'href',
      /\/overtime\?unit=.+&startAt=2026-11-21T15%3A00%3A00-06%3A00/,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expectAccessible(page, testInfo, 'planning-gap-fill-phone');
    await shot(page, testInfo, 'supervisor', 'planning', 'gap-fill-phone');

    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();
  });
});
