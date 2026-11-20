import { expect, test } from '@playwright/test';

import { signIn, signInAgain, signOut } from './support';

/**
 * The audit log against the real api (HANDOFF step 12 Should item).
 *
 * A supervisor makes an overridden assignment, which writes both an
 * `assign_shift` and an `override_rule` audit event; the auditor finds the
 * rule-override row with its actor and rule codes. An employee has no nav
 * entry and gets the not-allowed page.
 */

const REASON = 'Audit spec: relief unavailable for the Friday day shift';

test.describe('audit log', () => {
  test('@api an override is visible to the auditor, and an employee is refused', async ({ page }) => {
    await page.goto('/login');
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'the audit spec needs the real api',
    );

    // The supervisor (J. Chen, who scopes Control) makes the change through
    // the real api: Uma Olsen's P12 ends at midnight and the proposed Fri 27
    // Nov day shift starts at 07:00, so U-01 and U-05 block and the emergency
    // override is allowed once the warnings are acknowledged, as the screen
    // does. Using an officer outside the E1/E2/E4 flows keeps them clean.
    const login = await page.request.post('/api/v1/auth/mock-login', {
      data: { userId: 'j.chen' },
    });
    expect(login.status()).toBe(200);
    const supervisorToken = (await login.json()).token as string;
    const headers = { Authorization: `Bearer ${supervisorToken}` };

    const employees = await (await page.request.get('/api/v1/employees', { headers })).json();
    const uma = employees.find(
      (employee: { first_name: string; last_name: string }) =>
        employee.first_name === 'Uma' && employee.last_name === 'Olsen',
    );
    expect(uma).toBeTruthy();

    const change = {
      type: 'ASSIGN',
      employeeId: uma.id,
      unitId: uma.home_unit_id,
      shiftTemplate: 'D8',
      startAt: '2026-11-27T07:00:00-06:00',
    };
    let assigned = await page.request.post('/api/v1/assignments', {
      headers,
      data: { change, override: { reason: REASON } },
    });
    if (assigned.status() === 422) {
      const problem = await assigned.json();
      const warnings = (problem.ruleResults ?? [])
        .filter((result: { outcome: string }) => result.outcome === 'WARN')
        .map((result: { ruleCode: string }) => result.ruleCode);
      assigned = await page.request.post('/api/v1/assignments', {
        headers,
        data: { change, acknowledgeWarnings: warnings, override: { reason: REASON } },
      });
    }
    expect(assigned.status()).toBe(201);

    // The auditor finds the rule-override row, with the actor and the rules.
    await signIn(page, 'A. Reviewer');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();

    await page.getByLabel('Actor').fill('j.chen');
    await page.getByLabel('Action').fill('override_rule');
    await page.getByRole('button', { name: 'Apply' }).click();

    const row = page.getByRole('row').filter({ hasText: 'Rule override' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('J. Chen');
    await expect(row).toContainText('j.chen');
    await expect(row).toContainText(REASON);
    await expect(row).toContainText('U-01, U-05');
    // Read-only: no edit or delete action on the row.
    await expect(row.getByRole('button')).toHaveCount(0);

    // The employee has no nav entry and the API refuses the audit trail.
    await signOut(page, 'A. Reviewer');
    await signInAgain(page, 'T. Nakamura');
    const employeeLogin = await page.request.post('/api/v1/auth/mock-login', {
      data: { userId: 't.nakamura' },
    });
    const employeeToken = (await employeeLogin.json()).token as string;
    const refused = await page.request.get('/api/v1/audit-events', {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    expect(refused.status()).toBe(403);

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);

    // Move within the running app (a reload would drop the in-memory token).
    await page.evaluate(() => {
      window.history.pushState({}, '', '/audit');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'Not allowed', level: 1 })).toBeVisible();
    await expect(page.getByText('Your role cannot read the audit log.')).toBeVisible();
  });
});
