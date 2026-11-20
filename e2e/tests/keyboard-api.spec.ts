import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { tabTo } from './support';

/**
 * Keyboard-only runs against the real api (keyboard.spec.ts covers the
 * fixtures web). Every action is a key press; locators only check where the
 * focus is.
 */

test.describe('keyboard only, real api', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'these runs use the real api');
  });

  test('@api E1: sign in, reach PC-01, read the Block and close it, focus returns', async ({ page, request }) => {
    // E4 locks the 9 - 22 Nov pay period; in a locked period the preview says
    // "Unlock it ..." instead of the rule verdict, so open it first (set-up,
    // not part of the keyboard run), as move-cancel does.
    const api = await apiAs(request, 'm.ellis');
    const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
    const period = periods.find((entry) => entry.from <= '2026-11-21' && entry.to >= '2026-11-21');
    if (period?.status === 'LOCKED') {
      const unlocked = await api.post(`/pay-periods/${period.id}/unlock`, { reason: 'Keyboard E1 spec: rule check in the demo week' });
      expect(unlocked.status).toBe(200);
    }

    await tabTo(page, page.getByRole('button', { name: /M\. Ellis/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();

    // The unit selector, by keyboard: Unit B is the second unit in scope.
    const unit = page.getByLabel('Unit').first();
    await tabTo(page, unit, 60);
    await page.keyboard.press('ArrowDown');
    await expect(unit).toHaveValue(/.+/);
    await expect(unit.locator('option:checked')).toHaveText('Unit B · Living unit');

    const cell = page.getByRole('button', { name: 'Off - assign a shift to Nia Thompson on 2026-11-21' });
    const presses = await tabTo(page, cell, 400);
    test.info().annotations.push({ type: 'tabs from the unit selector to Nia Thompson, Sat 21', description: String(presses) });
    await page.keyboard.press('Enter');

    const day = page.getByRole('button', { name: /^D8 · / });
    await tabTo(page, day, 20);
    await page.keyboard.press('Enter');

    await expect(page.getByText(/Blocked: \d+ rules fail/)).toBeVisible();
    // Focus moves to the verdict, so a keyboard user is not left behind.
    await expect(page.getByRole('heading', { name: /Assign Nia Thompson/ })).toBeFocused();
    // No save and no override past this Block, so the next stops are the
    // eligible-officer link and Close.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Find eligible officer' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Rule check' })).toBeHidden();
    // Closing returns focus to the cell that opened it.
    await expect(cell).toBeFocused();
  });

  test('@api the auditor filters the audit log by keyboard, in reading order', async ({ page }) => {
    await tabTo(page, page.getByRole('button', { name: /A\. Reviewer/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    await tabTo(page, page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }), 30);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();

    const actor = page.getByLabel('Actor');
    await tabTo(page, actor, 40);
    // The filter fields come in reading order, one Tab each.
    for (const next of [
      page.getByLabel('Action'),
      page.getByLabel('Entity'),
      page.getByLabel('From'),
    ]) {
      await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
    }
    // A date-time field is several stops in Chromium (day, month, year, hour,
    // minute, AM/PM), so From and To take up to six Tabs each before Apply.
    await tabTo(page, page.getByLabel('To', { exact: true }), 10);
    await tabTo(page, page.getByRole('button', { name: 'Apply', exact: true }), 10);

    // Type a filter and apply it with Enter from the field.
    await tabTo(page, actor, 20);
    await page.keyboard.type('nobody.at.all');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No audit events match these filters.')).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: 'Clear' }), 20);
    await page.keyboard.press('Enter');
    await expect(actor).toHaveValue('');
    await expect(page.getByRole('table', { name: 'Audit events' }).getByRole('row').nth(1)).toBeVisible();
  });
});
