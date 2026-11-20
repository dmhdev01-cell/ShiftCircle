import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { expectAccessible, navTo, signIn } from './support';

/**
 * axe (WCAG 2.1 AA; serious or critical fails) on every screen each role
 * reaches, at both viewports. The flow specs also run axe on the states they
 * open (rule-check panel, override dialog, error panel, refusal); this spec
 * makes sure no screen is missed.
 */

async function goInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function ready(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

test.describe('accessibility on every screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'this sweep is of the real api screens');
  });

  test('sign-in', async ({ page }, testInfo) => {
    await ready(page, 'Sign in');
    await expectAccessible(page, testInfo, 'login');
  });

  // One test per supervisor screen, so one finding cannot hide the next screen.
  const D10 =
    'D10: at tablet width this screen has a table that scrolls sideways with no keyboard access ' +
    '(axe scrollable-region-focusable; CandidateTable.tsx:50, ReportsPage.tsx:41)';
  for (const [link, heading, name, tabletDefect] of [
    ['Planning board', 'Planning board', 'planning', false],
    ['Overtime', 'Overtime board', 'overtime', true],
    ['Rules', 'Rules', 'rules-supervisor', false],
    ['Audit log', 'Audit log', 'audit-supervisor', false],
    ['Employee view', 'My schedule', 'employee-view', false],
    ['Time & attendance', 'Time & attendance', 'time', false],
    ['About & version', 'About & version', 'about', false],
  ] as const) {
    test(`supervisor: ${name}`, async ({ page }, testInfo) => {
      test.fail(tabletDefect && testInfo.project.name === 'tablet', D10);
      await signIn(page, 'M. Ellis');
      await ready(page, 'Planning board');
      await navTo(page, link);
      await ready(page, heading);
      await expectAccessible(page, testInfo, name);
    });
  }

  for (const [tab, tabletDefect] of [
    ['Coverage', false],
    ['Hours', true],
    // The Overtime and Overrides tables use the same wrapper but pass axe at
    // 768 px in the real data (measured), so they are not marked.
    ['Overtime', false],
    ['Overrides', false],
  ] as const) {
    test(`supervisor: reports, ${tab}`, async ({ page }, testInfo) => {
      test.fail(tabletDefect && testInfo.project.name === 'tablet', D10);
      await signIn(page, 'M. Ellis');
      await ready(page, 'Planning board');
      await navTo(page, 'Reports');
      await ready(page, 'Reports');
      await page.getByRole('group', { name: 'Report' }).getByRole('button', { name: tab, exact: true }).click();
      await page.waitForLoadState('networkidle');
      await expectAccessible(page, testInfo, `reports-${tab}`);
    });
  }

  test('supervisor: a locked pay period and the wall display', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await ready(page, 'Planning board');
    await navTo(page, 'Time & attendance');
    await ready(page, 'Time & attendance');
    await page.getByLabel('Pay period').selectOption({ label: '26 Oct – 8 Nov 2026' });
    await expect(page.getByText(/Locked · /)).toBeVisible();
    await expectAccessible(page, testInfo, 'time-locked');
    await navTo(page, 'Wall display');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
    await expectAccessible(page, testInfo, 'display-supervisor');
  });

  test('not-built and not-found screens', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await ready(page, 'Planning board');
    for (const [path, heading] of [
      ['/proposals', 'Proposals inbox'],
      ['/me/hours', 'My hours'],
      ['/me/propose', 'Propose shifts'],
      ['/rules/1/review', 'Rule version review'],
      ['/no-such-page', 'Page not found'],
    ] as const) {
      await goInApp(page, path);
      await ready(page, heading);
      await expectAccessible(page, testInfo, path);
    }
  });

  test('employee screens, including the refusals', async ({ page }, testInfo) => {
    await signIn(page, 'T. Nakamura');
    await ready(page, 'My schedule');
    await expectAccessible(page, testInfo, 'my-schedule');
    await goInApp(page, '/audit');
    await ready(page, 'Not allowed');
    await expectAccessible(page, testInfo, 'audit-403');
    await goInApp(page, '/planning');
    await expect(page.getByText('This account may not do that.', { exact: false })).toBeVisible();
    await expectAccessible(page, testInfo, 'planning-403');
  });

  test('rules admin, approver and auditor screens', async ({ page }, testInfo) => {
    await signIn(page, 'L. Fraser');
    await ready(page, 'Rules');
    await expectAccessible(page, testInfo, 'rules-admin');
    const tables = page.getByRole('navigation', { name: 'Rule tables' }).or(page.getByLabel('Rule tables')).first();
    for (const table of ['Maximum hours', 'Consecutive work', '16-hour shifts', 'Days off', 'Pay classification', 'Overtime ranking', 'Shift types']) {
      await tables.getByRole('button', { name: table, exact: true }).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
      await expectAccessible(page, testInfo, `rules-${table}`);
    }

    await page.getByRole('button', { name: 'Account menu for L. Fraser' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: /P\. Singh/ }).click();
    await ready(page, 'Rules');
    await expectAccessible(page, testInfo, 'rules-approver');

    await page.getByRole('button', { name: 'Account menu for P. Singh' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: /A\. Reviewer/ }).click();
    await ready(page, 'Reports');
    await expectAccessible(page, testInfo, 'reports-auditor');
    await navTo(page, 'Planning board');
    await ready(page, 'Planning board');
    await expectAccessible(page, testInfo, 'planning-auditor');
    await navTo(page, 'Audit log');
    await ready(page, 'Audit log');
    await expectAccessible(page, testInfo, 'audit-auditor');
  });

  test('wall display account', async ({ page }, testInfo) => {
    await signIn(page, 'Unit office TV');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
    await expectAccessible(page, testInfo, 'display-tv');
  });
});
