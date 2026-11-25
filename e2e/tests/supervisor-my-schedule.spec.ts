import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiAs } from './api';
import { expectAccessible, navTo, signIn } from './support';
import { shot } from './shots';

/**
 * Release v1.3 S7: the supervisors' own schedule, the wall display's posts
 * strip, and the reports read by position. Read-only against the real api, so
 * it runs in the parallel `desktop`/`tablet` projects and holds on a reused
 * stack: every figure it checks is read from the api first, on whichever
 * dataset the stack is on.
 */

interface MySchedule {
  employee: { name: string; position: string; post: string | null };
}

interface ReportRow {
  name: string;
  position: string;
}

async function openReportTab(page: Page, tab: string): Promise<void> {
  const button = page.getByRole('group', { name: 'Report' }).getByRole('button', { name: tab, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

test.describe('supervisors in release v1.3 S7', () => {
  test('@api J. Chen opens My schedule: their own supervisor schedule, by position and post', async ({
    page,
    request,
  }, testInfo) => {
    const api = await apiAs(request, 'j.chen');
    const mine = await api.get<MySchedule>('/me/schedule');
    expect(mine.employee).toMatchObject({
      name: 'Jamie Chen',
      position: 'Correctional supervisor',
      post: 'Supervision · Operations (ADM, CTL, ESC)',
    });

    await signIn(page, 'J. Chen');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'My schedule' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Employee view' })).toHaveCount(0);

    await navTo(page, 'My schedule');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    await expect(
      page.getByText(/^Jamie Chen · Correctional supervisor · Supervision · Operations \(ADM, CTL, ESC\)/),
    ).toBeVisible();
    await expect(page.getByText('No employee record', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
    await expectAccessible(page, testInfo, 'supervisor-my-schedule');
    await shot(page, testInfo, 'supervisor', 'my-schedule', 'j-chen');
  });

  test('@api the wall display shows the supervisor posts as counts only', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'tv.display');
    const today = await api.get<{ posts: { area: string }[] }>('/display/today');
    expect(today.posts.map((post) => post.area)).toEqual(['Living units', 'Operations']);

    await signIn(page, 'Unit office TV');
    const strip = page.getByRole('region', { name: 'Supervisor on duty' });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('listitem', { name: /^Supervisor on duty · Living units \d+ of 1 · / })).toBeVisible();
    await expect(strip.getByRole('listitem', { name: /^Supervisor on duty · Operations \d+ of 1 · / })).toBeVisible();
    // The posts are a strip, not unit tiles, and no supervisor is named anywhere on the page.
    await expect(page.getByRole('region', { name: 'Supervision · Operations' })).toHaveCount(0);
    const html = await page.content();
    for (const name of ['Jamie Chen', 'Morgan Ellis']) {
      expect(html, name).not.toContain(name);
    }
    await expectAccessible(page, testInfo, 'wall-display-posts');
    await shot(page, testInfo, 'display', 'wall-display', 'supervisor-posts');
  });

  test('@api the overtime and hours reports read one rank at a time', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'a.reviewer');
    const overtime = await api.get<{ rows: ReportRow[] }>('/reports/overtime?position=CS');
    expect(overtime.rows.every((row) => row.position === 'CS')).toBe(true);
    const hours = await api.get<{ rows: ReportRow[] }>('/reports/hours?position=CS');
    expect(hours.rows.every((row) => row.position === 'CS')).toBe(true);

    await signIn(page, 'A. Reviewer');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await openReportTab(page, 'Overtime');
    await page.getByLabel('Position').selectOption({ label: 'Supervisors' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/Supervisors only in hours and overtime/)).toBeVisible();
    const overtimeTable = page.getByRole('region', { name: 'Overtime by person' }).getByRole('table');
    await expect(overtimeTable.locator('tbody tr')).toHaveCount(overtime.rows.length);
    for (const cell of await overtimeTable.locator('tbody tr td:nth-child(2)').allTextContents()) {
      expect(cell).toBe('Supervisor');
    }

    await openReportTab(page, 'Hours');
    const hoursTable = page.getByRole('region', { name: 'Hours by person' }).getByRole('table');
    await expect(hoursTable.locator('tbody tr')).toHaveCount(hours.rows.length);
    await expect(page.getByText(`Showing ${hours.rows.length} of ${hours.rows.length} supervisors`, { exact: false })).toBeVisible();
    for (const cell of await hoursTable.locator('tbody tr td:nth-child(2)').allTextContents()) {
      expect(cell).toBe('Supervisor');
    }
    await expectAccessible(page, testInfo, 'reports-hours-supervisors');
    await shot(page, testInfo, 'auditor', 'reports', 'hours-supervisors');

    // Everyone again: both ranks, each row named by position.
    await page.getByLabel('Position').selectOption({ label: 'Everyone' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/Supervisors only/)).toHaveCount(0);
    await expect(page.getByText(/^Showing \d+ of \d+ people/)).toBeVisible();
  });
});
