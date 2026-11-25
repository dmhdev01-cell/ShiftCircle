import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { expectAccessible, navTo, signIn } from './support';

/**
 * Screens that are not built say so, an unknown route says so, and failures
 * are shown in plain words with the rest of the app still working: the api
 * cannot be reached, a screen's data is not the expected shape (the error
 * boundary), and a role asks for something it may not see.
 */

async function goInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('routes and error states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'these states are driven against the real api');
  });

  test('the not-built screens say what is planned, and an unknown route says it is not found', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    for (const [path, heading, planned] of [
      ['/me/hours', 'My hours', null],
      ['/rules/1/review', 'Rule version review', /before\/after diff/],
    ] as const) {
      await goInApp(page, path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByText('Not built yet')).toBeVisible();
      if (planned) await expect(page.getByText(planned)).toBeVisible();
    }
    await expectAccessible(page, testInfo, 'not-built');

    await goInApp(page, '/no-such-page');
    await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    await expect(page.getByText('That route is not part of the prototype.')).toBeVisible();
    // The navigation still works from there.
    await navTo(page, 'Planning board');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
  });

  test('when the api cannot be reached the board says so, and Try again recovers', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await page.route('**/api/v1/schedule**', (route) => route.abort());
    await navTo(page, 'Overtime');
    await navTo(page, 'Planning board');
    await expect(page.getByText('Could not load the schedule')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    await page.unroute('**/api/v1/schedule**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Could not load the schedule')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Roster, scrolls sideways' })).toBeVisible();
  });

  test('a screen whose data is broken shows the error panel and the app keeps working', async ({ page }, testInfo) => {
    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await page.route('**/api/v1/reports/coverage**', (route) => route.fulfill({ json: {} }));
    await navTo(page, 'Audit log');
    await navTo(page, 'Reports');

    const panel = page.getByRole('alert').filter({ hasText: 'This screen could not be shown' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('The rest of the app still works, and nothing was changed.');
    await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expectAccessible(page, testInfo, 'error-boundary');

    // Navigation and the footer survive; another screen opens normally.
    await navTo(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'This screen could not be shown' })).toHaveCount(0);
  });

  test('the reports screen says so when its data cannot be loaded', async ({ page }) => {
    // D4 was here: ReportsPage.tsx loaded the four reports with no error
    // handling, so a failed request left an empty screen with no message.
    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await page.route('**/api/v1/reports/**', (route) => route.abort());
    await navTo(page, 'Audit log');
    await navTo(page, 'Reports');
    await expect(page.getByText(/could not|failed|try again/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('a role that may not see a screen gets plain words, not a blank page', async ({ page }) => {
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();

    await goInApp(page, '/planning');
    await expect(page.getByText('This account may not do that. Ask a supervisor with the right scope.')).toBeVisible();

    await goInApp(page, '/audit');
    await expect(page.getByRole('heading', { name: 'Not allowed', level: 1 })).toBeVisible();
    await expect(page.getByText('Your role cannot read the audit log.')).toBeVisible();

    // Navigation still offers only the employee's screens.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['My schedule', 'About & version']);
  });
});
