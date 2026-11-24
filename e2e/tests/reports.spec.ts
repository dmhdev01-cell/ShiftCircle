import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiAs, isFixtures } from './api';
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

  test('a supervisor picks a range and a unit in scope, and the reports and CSV follow', async ({
    page,
    request,
  }) => {
    // S1 (FR-60/61/62 "any range"): the screen had no range or unit picker.
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Reports');
    await openTab(page, 'Hours');

    // The inputs open on the report's own default: the last locked pay period.
    // Which period that is depends on the specs that lock and unlock periods in
    // parallel (E4, screenshots), so check it is a pay period, not a fixed date.
    const from = page.getByLabel('From', { exact: true });
    const to = page.getByLabel('To', { exact: true });
    await expect(from).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(to).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    const defaultFrom = await from.inputValue();
    const defaultTo = await to.inputValue();
    const periods = await (await apiAs(request, 'm.ellis')).get<{ from: string; to: string }[]>(
      '/pay-periods',
    );
    expect(
      periods.some((period) => period.from === defaultFrom && period.to === defaultTo),
      `the default ${defaultFrom}–${defaultTo} is a pay period`,
    ).toBe(true);

    // Only the units in M. Ellis's scope (A and B) are offered.
    const unit = page.getByLabel('Unit', { exact: true });
    await expect(unit.locator('option')).toHaveCount(3);
    const labels = await unit.locator('option').allTextContents();
    expect(labels[0]).toBe('All my units');
    expect(labels.slice(1).every((label) => /^Unit [AB]\b/.test(label))).toBe(true);

    // A reversed range is refused with a clear message, and nothing is asked.
    await from.fill('2026-11-14');
    await to.fill('2026-11-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert')).toHaveText('The To date must be on or after the From date.');

    // A good range and Unit B: every report asks for it, and the CSV too.
    await from.fill('2026-11-01');
    await to.fill('2026-11-14');
    const unitB = labels.find((label) => label.startsWith('Unit B'))!;
    await unit.selectOption({ label: unitB });
    const asked = page.waitForRequest(
      (request) =>
        request.url().includes('/api/v1/reports/hours?') &&
        request.url().includes('from=2026-11-01') &&
        request.url().includes('to=2026-11-14') &&
        request.url().includes('unitId='),
    );
    await page.getByRole('button', { name: 'Apply' }).click();
    await asked;
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Hours by officer · 1 Nov 2026 – 14 Nov 2026' }),
    ).toBeVisible();
    await expect(page.getByText(`Every report covers 1 Nov 2026 – 14 Nov 2026 · ${unitB}`)).toBeVisible();

    const exported = page.waitForRequest(
      (request) =>
        request.url().includes('/api/v1/reports/hours?') &&
        request.url().includes('from=2026-11-01') &&
        request.headers()['accept']?.includes('text/csv') === true,
    );
    const lines = await downloadCsv(page, 'Export CSV');
    await exported;
    expect(lines.length, 'the ranged hours CSV has a header and rows').toBeGreaterThan(1);

    // Reset goes back to each report's default.
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByRole('heading', { name: /Hours by officer · pay period/ })).toBeVisible();
    await expect(from).toHaveValue(defaultFrom);
    await expect(to).toHaveValue(defaultTo);
  });

  test('the auditor narrows the overrides to a unit and a range', async ({ page }) => {
    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await openTab(page, 'Overrides');
    const lockdown = page.getByRole('row').filter({ hasText: 'Lockdown, relief unavailable' });
    await expect(lockdown).toHaveCount(1);

    const unit = page.getByLabel('Unit', { exact: true });
    const labels = await unit.locator('option').allTextContents();
    const unitA = labels.find((label) => label.startsWith('Unit A'))!;
    const unitC = labels.find((label) => label.startsWith('Unit C'))!;

    // The planted lockdown override is on Unit C: picking Unit A leaves it out.
    await unit.selectOption({ label: unitA });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(`Each report covers its own default range · ${unitA}`)).toBeVisible();
    await expect(lockdown).toHaveCount(0);

    // Unit C over 1–19 Nov has it; a range before it does not.
    await unit.selectOption({ label: unitC });
    await page.getByLabel('From', { exact: true }).fill('2026-11-01');
    await page.getByLabel('To', { exact: true }).fill('2026-11-19');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(lockdown).toHaveCount(1);
    await page.getByLabel('From', { exact: true }).fill('2026-10-01');
    await page.getByLabel('To', { exact: true }).fill('2026-10-15');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Every report covers 1 Oct 2026 – 15 Oct 2026', { exact: false })).toBeVisible();
    await expect(lockdown).toHaveCount(0);

    // A range longer than the api allows is refused before asking.
    await page.getByLabel('From', { exact: true }).fill('2025-01-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The To date can be at most 366 days after the From date. Choose a shorter range.',
    );
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
