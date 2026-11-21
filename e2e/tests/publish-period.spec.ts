import { expect, test } from '@playwright/test';

import { navTo, selectUnit, signIn, signOut } from './support';

/**
 * Publishing a roster week against the real api (docs/07 §4.2): a supervisor
 * publishes their unit's week once, the board says it is published, the action
 * is no longer offered, and the audit log records the publication.
 *
 * The demo dataset seeds a period for every week of every unit, so the board
 * always has a draft week to publish.
 */

test.describe('publish the roster period', () => {
  test('@api publishes the week and writes the audit row', async ({ page }) => {
    await page.goto('/login');
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'publishing needs the real api',
    );

    const login = await page.request.post('/api/v1/auth/mock-login', {
      data: { userId: 'm.ellis' },
    });
    const token = (await login.json()).token as string;
    const headers = { Authorization: `Bearer ${token}` };
    const units = await (await page.request.get('/api/v1/units', { headers })).json();
    const unit = units.find((entry: { code: string }) => entry.code === 'A');
    expect(unit, 'unit A').toBeTruthy();

    const schedule = await (
      await page.request.get(
        `/api/v1/schedule?unitId=${unit.id}&from=2026-11-16&to=2026-11-22`,
        { headers },
      )
    ).json();
    const period = schedule.period;
    expect(period, 'the api seeds a roster week for the board').toBeTruthy();

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');
    await selectUnit(page, unit.name);

    const publish = page.getByRole('button', { name: 'Publish period' });
    if (await publish.isEnabled()) {
      await publish.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(period.label);
      await expect(dialog).toContainText('the roster is final');
      await dialog.getByRole('button', { name: 'Publish period' }).click();

      await expect(page.getByText('Published', { exact: true })).toBeVisible();
    }

    // The action is not offered again: publishing is one-way.
    await expect(page.getByRole('button', { name: 'Publish period' })).toBeDisabled();

    // The publication is on record. A supervisor's scope does not include the
    // roster week, so an auditor reads the log.
    await signOut(page, 'M. Ellis');
    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('banner')).toContainText('Auditor');
    await navTo(page, 'Audit log');
    await expect(
      page.getByText('Published. The officers see this roster as final.').first(),
    ).toBeVisible();
  });
});
