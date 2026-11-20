import { expect, test } from '@playwright/test';

import { tabTo } from './support';

/**
 * Keyboard-only runs of E1 and E3 (docs/10-testing.md section 2). Every action
 * is a key press; locators are used only to check where the focus is.
 */

test.describe('keyboard only', () => {
  test('@fixtures E1: reach the PC-01 block, open the override, and back out', async ({ page }) => {
    await page.goto('/login');
    await tabTo(page, page.getByRole('button', { name: /M\. Ellis/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();

    const chip = page.getByRole('button', { name: /! D proposed for Nia Thompson/ });
    const presses = await tabTo(page, chip, 150);
    test.info().annotations.push({ type: 'tabs to the PC-01 chip', description: String(presses) });
    await page.keyboard.press('Enter');
    await expect(page.getByText('Blocked: 2 rules fail')).toBeVisible();
    // Focus moves to the result, so a keyboard user is not left behind.
    await expect(page.getByRole('heading', { name: /Assign Nia Thompson/ })).toBeFocused();

    await tabTo(page, page.getByRole('button', { name: 'Emergency override…' }), 10);
    await page.keyboard.press('Enter');
    const override = page.getByRole('dialog', { name: 'Emergency override' });
    const reason = override.getByLabel('Why is this override needed?');
    await expect(reason).toBeFocused();
    await page.keyboard.type('Short');
    await expect(override.getByRole('button', { name: 'Emergency override' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(override).toBeHidden();
    await expect(page.getByRole('button', { name: 'Emergency override…' })).toBeFocused();
  });

  test('@fixtures E1: the skip link goes straight to the roster', async ({ page }) => {
    await page.goto('/login');
    await tabTo(page, page.getByRole('button', { name: /M\. Ellis/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await tabTo(page, page.getByRole('link', { name: 'Skip to roster' }), 30);
    await page.keyboard.press('Enter');
    const presses = await tabTo(page, page.getByRole('button', { name: /! D proposed for Nia Thompson/ }), 150);
    test.info().annotations.push({ type: 'tabs from the skip link to the PC-01 chip', description: String(presses) });
  });

  test('@fixtures E3: edit, build, submit, sign out, approve, publish', async ({ page }) => {
    await page.goto('/login');
    await tabTo(page, page.getByRole('button', { name: /L\. Fraser/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Rest between shifts' })).toBeVisible();

    await tabTo(page, page.getByLabel('Minimum hours off for U-03'), 80);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('14');
    await tabTo(page, page.getByRole('button', { name: 'Build and check' }), 40);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/test scenarios passed/)).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Submit for approval' }), 40);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/is submitted for approval/)).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: 'Account menu for L. Fraser' }), 120);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: /P\. Singh/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Rest between shifts' })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Approve' }), 120);
    await page.keyboard.press('Enter');
    await expect(page.getByText('The version is approved. It can be published.')).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Publish' }), 40);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Version \d+ is live from/)).toBeVisible();
  });
});
