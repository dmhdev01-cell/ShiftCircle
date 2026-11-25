import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiAs, findCase, isFixtures, openDemoWeekPeriod, shortStaffed } from './api';
import type { Unit } from './api';
import { shot } from './shots';
import { navTo, selectUnit, signIn } from './support';

/**
 * Full-page screenshots of every screen, per role, viewport and state, for
 * the visual review (UI test plan, phase D). Each test signs in on its own and
 * waits for content, never for a fixed time. Files and index.json go to
 * SHOTS_DIR (see shots.ts), outside the repository.
 *
 * These tests assert only that the screen is there; the functional specs
 * assert behaviour. A capture that cannot be made fails its test.
 */

/** Move inside the running app: a reload would need a saved session. */
async function goInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/**
 * A report tab has its content: the chart and its data table, or the tab's
 * table with at least one data row. The reports load once on mount with no
 * loading state (D4), so the capture waits for content, never for time.
 * Overrides may legitimately be empty (D2): its table header is enough.
 */
async function reportLoaded(page: Page, tab: 'Coverage' | 'Hours' | 'Overtime' | 'Overrides'): Promise<void> {
  const main = page.getByRole('main');
  if (tab === 'Coverage') {
    await expect(main.getByText('Coverage: share of required staff-hours')).toBeVisible();
    await expect(main.getByRole('row').nth(1)).toBeVisible();
    await expect(main.getByText('Extra shifts (overtime)').first()).toBeVisible();
  } else if (tab === 'Hours') {
    await expect(main.getByRole('heading', { name: /Hours by officer · pay period \d/ })).toBeVisible();
    await expect(main.getByRole('row').nth(1)).toBeVisible();
  } else if (tab === 'Overtime') {
    await expect(main.getByRole('heading', { name: 'Overtime by officer' })).toBeVisible();
    await expect(main.getByRole('row').nth(1)).toBeVisible();
  } else {
    await expect(main.getByRole('heading', { name: 'Emergency overrides' })).toBeVisible();
    await expect(main.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
  }
}

/** The screen has its heading and nothing is still loading. */
async function settled(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

test.describe('screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the captures are of the real api');
  });

  test('sign-in screen', async ({ page }, testInfo) => {
    await settled(page, 'Sign in');
    await expect(page.getByRole('button', { name: /M\. Ellis/ })).toBeVisible();
    await shot(page, testInfo, 'anonymous', 'login', 'normal');
  });

  test('supervisor screens', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await settled(page, 'Planning board');
    await shot(page, testInfo, 'supervisor', 'planning', 'normal');

    await navTo(page, 'Overtime');
    await settled(page, 'Overtime board');
    await shot(page, testInfo, 'supervisor', 'overtime', 'normal');

    await navTo(page, 'Reports');
    await settled(page, 'Reports');
    for (const tab of ['Coverage', 'Hours', 'Overtime', 'Overrides'] as const) {
      await page.getByRole('group', { name: 'Report' }).getByRole('button', { name: tab, exact: true }).click();
      await reportLoaded(page, tab);
      await shot(page, testInfo, 'supervisor', 'reports', tab);
    }

    await navTo(page, 'Rules');
    await settled(page, 'Rules');
    await shot(page, testInfo, 'supervisor', 'rules', 'read-only');

    await navTo(page, 'Audit log');
    await settled(page, 'Audit log');
    await shot(page, testInfo, 'supervisor', 'audit', 'normal');

    await navTo(page, 'Time & attendance');
    await settled(page, 'Time & attendance');
    await shot(page, testInfo, 'supervisor', 'time', 'open-period');
    await page.getByLabel('Pay period').selectOption({ label: '26 Oct – 8 Nov 2026' });
    await expect(page.getByText(/Locked · /)).toBeVisible();
    // The time entries of a whole period take a moment; capture the grid, not
    // the "Loading the time entries…" line.
    await expect(page.getByText('Loading the time entries…')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Time entries, scrolls sideways' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'supervisor', 'time', 'locked-period');

    await page.getByRole('link', { name: 'About & version' }).click();
    await settled(page, 'About & version');
    await shot(page, testInfo, 'supervisor', 'about', 'normal');

    await navTo(page, 'Wall display');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'supervisor', 'display', 'own-units');
  });

  test('second supervisor (other units)', async ({ page }, testInfo) => {
    await signIn(page, 'J. Chen');
    await settled(page, 'Planning board');
    await shot(page, testInfo, 'supervisor-chen', 'planning', 'normal');
  });

  test('not built yet and not found routes', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await settled(page, 'Planning board');
    for (const [path, heading, name] of [
      ['/me/hours', 'My hours', 'my-hours'],
      ['/rules/1/review', 'Rule version review', 'rule-review'],
      ['/no-such-page', 'Page not found', 'not-found'],
    ] as const) {
      await goInApp(page, path);
      await settled(page, heading);
      await shot(page, testInfo, 'supervisor', name, path === '/no-such-page' ? '404' : 'not-built');
    }
  });

  test('employee screens', async ({ page }, testInfo) => {
    await signIn(page, 'T. Nakamura');
    await settled(page, 'My schedule');
    await shot(page, testInfo, 'employee', 'my-schedule', 'normal');

    await goInApp(page, '/audit');
    await settled(page, 'Not allowed');
    await shot(page, testInfo, 'employee', 'audit', '403');

    await goInApp(page, '/planning');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'employee', 'planning', 'wrong-role');
  });

  test('rules admin and approver', async ({ page }, testInfo) => {
    await signIn(page, 'L. Fraser');
    await settled(page, 'Rules');
    await shot(page, testInfo, 'rules-admin', 'rules', 'landing');

    await page.getByRole('button', { name: 'Account menu for L. Fraser' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: /P\. Singh/ }).click();
    await settled(page, 'Rules');
    await shot(page, testInfo, 'rules-approver', 'rules', 'landing');
  });

  test('auditor screens', async ({ page }, testInfo) => {
    await signIn(page, 'A. Reviewer');
    await settled(page, 'Reports');
    await reportLoaded(page, 'Coverage');
    await shot(page, testInfo, 'auditor', 'reports', 'landing');
    await page.getByRole('group', { name: 'Report' }).getByRole('button', { name: 'Overrides', exact: true }).click();
    await reportLoaded(page, 'Overrides');
    // The auditor sees the planted PC-03 override, so wait for its row.
    await expect(page.getByRole('row').filter({ hasText: 'Lockdown, relief unavailable' })).toBeVisible();
    await shot(page, testInfo, 'auditor', 'reports', 'Overrides');

    await navTo(page, 'Planning board');
    await settled(page, 'Planning board');
    await shot(page, testInfo, 'auditor', 'planning', 'read-only');

    await navTo(page, 'Audit log');
    await settled(page, 'Audit log');
    await shot(page, testInfo, 'auditor', 'audit', 'normal');

    // The 'Actor' text filter is the 'Done by' picker now; a future From date
    // gives the empty-state screenshot.
    await page.getByLabel('From').fill('2027-01-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No audit events match these filters.')).toBeVisible();
    await shot(page, testInfo, 'auditor', 'audit', 'empty');
  });

  test('wall display: normal, short-staffed and not live', async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date('2026-11-19T20:32:00Z') });
    await signIn(page, 'Unit office TV');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'display', 'display', 'normal');

    // Short-staffed: the real dataset is covered today, so the same payload is
    // served with one unit two officers short in every block.
    await page.route('**/api/v1/display/today', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: shortStaffed(body) });
    });
    await page.clock.runFor(61_000);
    // Wait for the short unit's own card (the facility panel always says
    // "Units short right now", so a page-wide match proves nothing).
    const unitA = page.getByRole('region', { name: 'Unit A · Living unit' });
    await expect(unitA.getByText('Covered', { exact: true })).toHaveCount(0);
    await expect(unitA.getByText(/short/i).first()).toBeVisible();
    await shot(page, testInfo, 'display', 'display', 'short');

    await page.unroute('**/api/v1/display/today');
    await page.route('**/api/v1/display/today', (route) => route.abort());
    await page.clock.runFor(61_000);
    await expect(page.getByRole('alert')).toContainText('Not live');
    await shot(page, testInfo, 'display', 'display', 'stale');
  });

  test('error states: api unreachable and a screen that fails', async ({ page }, testInfo) => {
    await signIn(page, 'A. Reviewer');
    await settled(page, 'Reports');

    // A screen whose data is not the expected shape: the error boundary.
    await page.route('**/api/v1/reports/coverage**', (route) => route.fulfill({ json: {} }));
    await navTo(page, 'Planning board');
    await settled(page, 'Planning board');
    await navTo(page, 'Reports');
    await expect(page.getByRole('alert').or(page.getByRole('heading', { name: 'Reports' })).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'auditor', 'reports', 'error-boundary');
    await page.unroute('**/api/v1/reports/coverage**');

    // The api cannot be reached at all.
    await page.route('**/api/v1/schedule**', (route) => route.abort());
    await navTo(page, 'Planning board');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'auditor', 'planning', 'api-unreachable');
  });

  test('planning: the blocked panel (PC-01)', async ({ page, request }, testInfo) => {
    await openDemoWeekPeriod(await apiAs(request, 'm.ellis'), 'Screenshot spec: rule check in the demo week');
    await signIn(page, 'M. Ellis');
    await settled(page, 'Planning board');
    await selectUnit(page, 'Unit B · Living unit');
    await page.getByRole('button', { name: 'Off - assign a shift to Nia Thompson on 2026-11-21' }).click();
    await page.getByRole('button', { name: /D8 · Day 8 h/ }).click();
    await expect(page.getByText(/Blocked: \d+ rules? fail/)).toBeVisible();
    await shot(page, testInfo, 'supervisor', 'planning', 'blocked-panel');
  });

  test('planning: the override dialog and a warning to acknowledge (nothing saved)', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'm.ellis');
    await openDemoWeekPeriod(api, 'Screenshot spec: rule check in the demo week');
    const units = await api.get<Unit[]>('/units');
    const dates = ['2026-11-20', '2026-11-21', '2026-11-22'];
    let unitA: Unit | undefined;
    let block: Awaited<ReturnType<typeof findCase>> = null;
    let warning: Awaited<ReturnType<typeof findCase>> = null;
    for (const code of ['A', 'B']) {
      unitA = units.find((unit) => unit.code === code)!;
      block = await findCase(api, unitA, dates, ['D8', 'E8', 'N8'], (results) => {
        const blocks = results.filter((result) => result.outcome === 'BLOCK');
        return blocks.length > 0 && blocks.every((result) => result.overridePolicy === 'EMERGENCY');
      }, ['Nia Thompson']);
      warning = await findCase(api, unitA, dates, ['D8', 'E8', 'N8'], (results) =>
        results.length > 0 && results.every((result) => result.outcome === 'WARN'), ['Nia Thompson']);
      if (block && warning) break;
    }
    expect(block, 'an emergency-only Block in Unit A or B').toBeTruthy();
    expect(warning, 'a warning-only change in the same unit').toBeTruthy();

    await signIn(page, 'M. Ellis');
    await settled(page, 'Planning board');
    await selectUnit(page, unitA!.name);
    const panel = page.getByRole('region', { name: 'Rule check' });

    await page.getByRole('button', { name: `Off - assign a shift to ${block!.officer.name} on ${block!.date}` }).click();
    await page.getByRole('button', { name: new RegExp(`^${block!.template} · `) }).click();
    await panel.getByRole('button', { name: 'Emergency override…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Emergency override' });
    await dialog.getByLabel('Why is this override needed?').fill('too short');
    await shot(page, testInfo, 'supervisor', 'planning', 'override-dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await panel.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: `Off - assign a shift to ${warning!.officer.name} on ${warning!.date}` }).click();
    await page.getByRole('button', { name: new RegExp(`^${warning!.template} · `) }).click();
    await expect(panel.getByRole('button', { name: 'Acknowledge and assign' })).toBeVisible();
    await shot(page, testInfo, 'supervisor', 'planning', 'warning-acknowledgement');
    await panel.getByRole('button', { name: 'Close' }).click();
  });

  test('a published roster week', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'm.ellis');
    const units = await api.get<{ id: string; code: string; name: string }[]>('/units');
    const unitB = units.find((unit) => unit.code === 'B')!;
    const schedule = await api.get<{ period: { id: string } | null }>(
      `/schedule?unitId=${unitB.id}&from=2026-11-16&to=2026-11-22`,
    );
    expect(schedule.period).toBeTruthy();
    const published = await api.post(`/schedule-periods/${schedule.period!.id}/publish`);
    expect([200, 409]).toContain(published.status);

    await signIn(page, 'M. Ellis');
    await settled(page, 'Planning board');
    await selectUnit(page, unitB.name);
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'supervisor', 'planning', 'published-period');
  });
});
