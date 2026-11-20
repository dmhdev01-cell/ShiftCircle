import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { navTo, signIn } from './support';

/**
 * Reports (docs/ui/README.md §5.5): coverage, hours, overtime and the
 * emergency overrides, each with a CSV export, read by a supervisor in scope
 * and by the auditor facility-wide.
 */

async function openTab(page: Page, tab: string): Promise<void> {
  const button = page.getByRole('group', { name: 'Report' }).getByRole('button', { name: tab, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function downloadCsv(page: Page, buttonName: string): Promise<string[]> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const text = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');
  return text.trim().split(/\r?\n/);
}

test.describe('reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the report numbers come from the real api');
  });

  test('a supervisor reads all four reports and exports each as CSV', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    await openTab(page, 'Coverage');
    await expect(page.getByRole('main')).toContainText(/coverage/i);
    let lines = await downloadCsv(page, 'Export CSV');
    expect(lines.length, 'coverage CSV has a header and rows').toBeGreaterThan(1);

    await openTab(page, 'Hours');
    await expect(page.getByRole('heading', { name: /Hours by officer · pay period/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Officer' })).toBeVisible();
    await expect(page.getByText(/Showing \d+ of \d+ officers/)).toBeVisible();
    lines = await downloadCsv(page, 'Export CSV');
    expect(lines.length, 'hours CSV has a header and rows').toBeGreaterThan(1);

    await openTab(page, 'Overtime');
    await expect(page.getByRole('heading', { name: 'Overtime by officer' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Overtime h' })).toBeVisible();
    lines = await downloadCsv(page, 'Export CSV');
    expect(lines.length).toBeGreaterThan(0);

    await openTab(page, 'Overrides');
    await expect(page.getByRole('heading', { name: 'Emergency overrides' })).toBeVisible();
    lines = await downloadCsv(page, 'Export CSV');
    expect(lines.length, 'the overrides CSV has at least a header').toBeGreaterThan(0);

    // Every export ends with a plain status line. (Cosmetic, for the visual
    // review: it names the report, "The export overrides is downloaded.", not
    // the file the browser saved, which ends in .csv.)
    await expect(page.getByRole('status')).toContainText(/The export \S+ is downloaded\./);
  });

  test('the auditor sees the planted lockdown override with its reason and rule', async ({ page }) => {
    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await openTab(page, 'Overrides');
    const row = page.getByRole('row').filter({ hasText: 'Lockdown, relief unavailable' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('U-05');
    await expect(row).toContainText('Unit C · Living unit');
    const lines = await downloadCsv(page, 'Export CSV');
    expect(lines.join('\n')).toContain('Lockdown, relief unavailable');
  });

  test('a report with nothing in it says so', async ({ page }) => {
    // D2 was here: with no overrides in scope the Overrides tab showed an empty
    // table and no sentence (ReportsPage.tsx).
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Reports');
    await openTab(page, 'Overrides');
    // Unit A and B have no emergency override in the demo data unless another
    // spec saved one; only check the message when the table really is empty.
    const rows = page.getByRole('row');
    await expect(rows.first()).toBeVisible();
    test.skip((await rows.count()) > 1, 'another spec saved an override in Units A or B');
    await expect(page.getByText(/no (emergency )?overrides/i)).toBeVisible({ timeout: 5_000 });
  });

  test('the report in the address opens that report', async ({ page }) => {
    // D3 was here: the route is /reports/:tab but the page always opened on
    // Coverage (ReportsPage.tsx ignored the parameter).
    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await page.evaluate(() => {
      window.history.pushState({}, '', '/reports/hours');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(
      page.getByRole('group', { name: 'Report' }).getByRole('button', { name: 'Hours', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  });
});
