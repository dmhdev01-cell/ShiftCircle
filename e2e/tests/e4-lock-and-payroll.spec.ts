import { expect, test } from '@playwright/test';

import { expectAccessible, navTo, signIn } from './support';

/**
 * E4 (docs/10-testing.md section 5): the supervisor records actuals, locks the
 * period and exports payroll. ADR-017: a period with ended shifts that have no
 * actual cannot be locked.
 */

test.describe('E4 time and attendance, lock, payroll export', () => {
  test('@fixtures the open period refuses to lock while actuals are missing', async ({ page }, testInfo) => {
    // Fixture-only: relies on the fixture's open period having missing actuals.
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    await expect(page.getByRole('heading', { name: 'Time & attendance', level: 1 })).toBeVisible();
    await expectAccessible(page, testInfo, 'time-and-attendance');

    const lock = page.getByRole('button', { name: 'Lock pay period' });
    await expect(lock).toBeDisabled();
    await expect(page.getByText(/Record \d+ missing actuals? first/)).toBeVisible();
    await expect(page.getByText(/with no actual recorded/).first()).toBeVisible();
  });

  test('the open period can be locked at the demo clock', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    await expect(page.getByRole('heading', { name: 'Time & attendance', level: 1 })).toBeVisible();
    // The fixtures open period deliberately has missing actuals; this test is about the real
    // api's frozen demo day, where shifts after 19 Nov noon have not ended.
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'fixtures mode has a different open period',
    );
    await page.getByLabel('Pay period').selectOption({ label: '9 – 22 Nov 2026' });
    const lock = page.getByRole('button', { name: 'Lock pay period' });
    await expect(lock).toBeEnabled();
    await lock.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Lock pay period' }).click();
    await expect(page.getByText(/The pay period is locked/)).toBeVisible();
    await expect(page.getByText(/Locked · /)).toBeVisible();
  });

  test('a locked period is read-only and exports the payroll CSV', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    await page.getByLabel('Pay period').selectOption({ label: '26 Oct – 8 Nov 2026' });

    await expect(page.getByText(/Locked · /)).toBeVisible();
    await expect(page.getByText(/the actuals are read-only/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock pay period' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'time-locked-period');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Payroll export (CSV)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const content = await (await file.createReadStream()).toArray();
    const text = Buffer.concat(content).toString('utf8');
    // docs/07 section 4.5: column order, one line per officer, day and pay code,
    // hours to 2 decimals.
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'employee_no,pay_period_start,pay_period_end,work_date,pay_code,hours,unit_code,cost_centre',
    );
    const rows = lines.slice(1).map((line) => line.split(','));
    expect(rows.length, 'the locked period exports data rows').toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, `row ${row.join(',')}`).toHaveLength(8);
      expect(row[5], `hours in ${row.join(',')}`).toMatch(/^\d+\.\d{2}$/);
      // Every row belongs to the period that was exported.
      expect(row[1]).toBe('2026-10-26');
      expect(row[2]).toBe('2026-11-08');
    }
  });

  test('unlocking a period asks for a reason of at least 10 characters', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Time & attendance');
    await page.getByLabel('Pay period').selectOption({ label: '26 Oct – 8 Nov 2026' });
    await page.getByRole('button', { name: 'Unlock…' }).click();
    const dialog = page.getByRole('dialog');
    const unlock = dialog.getByRole('button', { name: 'Unlock' });
    await expect(unlock).toBeDisabled();
    await dialog.getByRole('textbox').fill('too short');
    await expect(unlock).toBeDisabled();
    await dialog.getByRole('textbox').fill('Correction for a late sick call');
    await expect(unlock).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText(/Locked · /)).toBeVisible();
  });
});
