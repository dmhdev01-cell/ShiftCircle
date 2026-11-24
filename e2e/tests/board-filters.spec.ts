import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { shot } from './shots';
import { expectAccessible, selectUnit, signIn } from './support';

/**
 * A3: find, filter, sort and export on the planning board (mockup 3). The
 * defaults leave the board as it was (demo §2); every filter works on the rows
 * already loaded, and the export is built in the browser.
 *
 * Read-only: nothing here changes data, so it is safe in any order.
 */

async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

/** The "Showing n of m officers · …" line, once it names the filters given. */
async function shownCount(page: Page, words: RegExp): Promise<number> {
  const line = page.getByRole('status').filter({ hasText: /^Showing / });
  await expect(line).toHaveText(words);
  return Number(/^Showing (?:all )?(\d+)/.exec(await line.innerText())?.[1]);
}

function officerRows(page: Page) {
  return page
    .getByRole('region', { name: 'Roster, scrolls sideways' })
    .getByRole('row')
    .filter({ hasText: /In overtime|Approaching|Under/ });
}

test.describe('the planning board filters and export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the figures come from the real api');
    await signIn(page, 'M. Ellis');
    await settled(page);
    await selectUnit(page, 'Unit B · Living unit');
    await settled(page);
  });

  test('keeps demo §2 by default, then finds, filters and sorts', async ({ page }, testInfo) => {
    const total = await shownCount(page, /^Showing all \d+ officers$/);
    expect(total).toBeGreaterThan(10);
    await expect(officerRows(page)).toHaveCount(total);
    await expect(page).not.toHaveURL(/[?&](q|ot|rot|works|qual|sort)=/);
    // Demo §2's officer is on the board, with the empty Sat 21 cell to pick.
    await expect(officerRows(page).filter({ hasText: 'Nia Thompson' })).toHaveCount(1);

    await page.getByRole('searchbox', { name: 'Find officer' }).fill('nia th');
    await expect(officerRows(page)).toHaveCount(1);
    await expect(officerRows(page).first()).toContainText('Nia Thompson');
    await expect(page).toHaveURL(/q=nia(\+|%20)th/);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(officerRows(page)).toHaveCount(total);

    // The In overtime filter shows the officers the tile counts.
    const tile = await page
      .getByText('In overtime', { exact: true })
      .first()
      .locator('xpath=..')
      .innerText();
    const inOvertime = Number(/\d+/.exec(tile)?.[0]);
    await page.getByRole('combobox', { name: 'Overtime' }).selectOption({ label: 'In overtime' });
    await expect(officerRows(page)).toHaveCount(inOvertime);
    await expect(page.getByText(`Showing ${inOvertime} of ${total} officers · in overtime`)).toBeVisible();

    await page.getByRole('combobox', { name: 'Overtime' }).selectOption({ label: 'All' });
    await page.getByRole('combobox', { name: 'Works' }).selectOption({ label: 'Nights' });
    const nights = await shownCount(page, /officers · works nights$/);
    await expect(officerRows(page)).toHaveCount(nights);
    expect(nights).toBeGreaterThan(0);
    expect(nights).toBeLessThan(total);
    await page.getByRole('combobox', { name: 'Sort' }).selectOption({ label: 'Pay-period hours, lowest first' });
    await expect(page).toHaveURL(/works=N/);
    await expect(page).toHaveURL(/sort=hours-asc/);
    await expect(officerRows(page)).toHaveCount(nights);
    const hours = (await officerRows(page).allInnerTexts()).map((text) =>
      Number(/(\d+(?:\.\d+)?) h\s*(?:In overtime|Approaching|Under)/.exec(text)?.[1]),
    );
    expect(hours.every(Number.isFinite)).toBe(true);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));

    // Rotation: the live /schedule sends no rotation text, so Casual is not offered.
    const rotation = page.getByRole('combobox', { name: 'Rotation' });
    await expect(rotation.getByRole('option')).toHaveText(['All', '8 h', '12 h']);
    await rotation.selectOption({ label: '12 h' });
    const twelve = await shownCount(page, /officers · 12 h rotation, works nights$/);
    await expect(officerRows(page)).toHaveCount(twelve);
    await rotation.selectOption({ label: 'All' });
    // Qualification, with the footer saying it sums the officers shown.
    await page.getByRole('combobox', { name: 'Qualification' }).selectOption({ label: 'Escort' });
    const escorts = await shownCount(page, /officers · works nights, Escort$/);
    await expect(officerRows(page)).toHaveCount(escorts);
    await expect(officerRows(page).filter({ hasNotText: 'Escort' })).toHaveCount(0);
    const roster = page.getByRole('region', { name: 'Roster, scrolls sideways' });
    await expect(roster.getByRole('rowheader', { name: /officers shown/ })).toBeVisible();
    await expect(roster.getByText(/needs \d+ · whole unit/)).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Qualification' }).selectOption({ label: 'All' });
    await expect(officerRows(page)).toHaveCount(nights);

    await expectAccessible(page, testInfo, 'planning-filtered');
    await page.getByRole('button', { name: /^Export/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectAccessible(page, testInfo, 'planning-export-menu');
    await shot(page, testInfo, 'supervisor', 'planning', 'filtered-export-menu');
    await page.keyboard.press('Escape');

    // A reload keeps the filters (they live in the address).
    await page.reload();
    await settled(page);
    await expect(officerRows(page)).toHaveCount(nights);
  });

  test('saves a CSV for Excel, copies the view and prints landscape', async ({ page }, testInfo) => {
    await page.getByRole('combobox', { name: 'Overtime' }).selectOption({ label: 'In overtime' });
    const shown = await shownCount(page, /officers · in overtime$/);
    await expect(officerRows(page)).toHaveCount(shown);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', { name: /^Export/ })
        .click()
        .then(() => page.getByRole('menuitem', { name: /CSV for Excel · this view/ }).click()),
    ]);
    expect(download.suggestedFilename()).toBe('roster-unit-b-living-unit-2026-11-16-to-2026-11-22-filtered.csv');
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n').filter(Boolean);
    expect(lines[0]).toMatch(/^Officer,Rotation,Qualifications,Shifts in view,Hours in view,Pay-period hours,Overtime status,Mon 16 Nov,/);
    // Header, 3 coverage rows, the officers shown, 2 total rows.
    expect(lines).toHaveLength(1 + 3 + shown + 2);
    expect(lines.slice(1, 4).join()).not.toMatch(/\d\/\d/);
    // No cell may start a formula.
    for (const line of lines) {
      for (const cell of line.split(',')) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+\-@]/);
    }
    await expect(page.getByText(/CSV saved: \d+ officers?, 7 days/)).toBeVisible();

    await page.getByRole('button', { name: /^Export/ }).click();
    await page.getByRole('menuitem', { name: /Copy this view/ }).click();
    await expect(page.getByText(/Copied \d+ officers? × 7 days/)).toBeVisible();

    // Print: the roster only, without the shell, figures or controls.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('banner')).toBeHidden();
    await expect(page.getByRole('navigation').first()).toBeHidden();
    await expect(page.getByRole('search')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Rules help' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Roster, scrolls sideways' })).toBeVisible();
    await expect(
      page.getByText(
        /^Printed: \d+ of \d+ officers \(in overtime\)$/,
      ),
    ).toBeVisible();
    // The footer, with the full disclaimer, prints too (HANDOFF §5.8).
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(
      page.getByText('Not an official Government of Saskatchewan service · fictional, synthetic data only'),
    ).toBeVisible();
    await shot(page, testInfo, 'supervisor', 'planning', 'print-media');
    const pdf = await page.pdf({ preferCSSPageSize: true });
    // The first page's media box is wider than it is tall (landscape).
    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
    expect(box).not.toBeNull();
    expect(Number(box![1])).toBeGreaterThan(Number(box![2]));
    await page.emulateMedia({ media: 'screen' });
  });

  test('prints a pay period on one landscape width; a month is not offered', async ({ page }) => {
    await page.getByRole('button', { name: 'Pay period', exact: true }).click();
    await settled(page);
    await expect(page.getByRole('group', { name: 'Pay period' })).toContainText('9 – 22 Nov 2026');
    // A landscape Letter page less the 8 mm margins is about 1,000 CSS px wide.
    await page.setViewportSize({ width: 1000, height: 760 });
    await page.emulateMedia({ media: 'print' });
    const fit = await page.evaluate(() => {
      const table = document.querySelector('#roster table') as HTMLElement;
      return { table: table.scrollWidth, page: document.documentElement.clientWidth };
    });
    expect(fit.table).toBeLessThanOrEqual(fit.page);
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await settled(page);
    await page.getByRole('button', { name: /^Export/ }).click();
    await expect(page.getByRole('menuitem', { name: /a month is too wide for one page/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('menuitem', { name: /Print or save as PDF/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('fits a phone: the filter bar wraps and the page never scrolls sideways', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await settled(page);
    await expect(page.getByRole('searchbox', { name: 'Find officer' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, testInfo, 'supervisor', 'planning', 'filters-390');
  });
});
