import { expect, test } from '@playwright/test';

import { expectAccessible, signIn, signInAgain, signOut } from './support';

/**
 * E3 (docs/10-testing.md section 5): the rules admin changes U-03 from 12 to
 * 14 h, builds and submits; the author cannot approve; a second person
 * approves and publishes. No code change.
 */

test.describe('E3 rule change with maker/checker', () => {
  test('@fixtures admin edits, builds and submits; approver approves and publishes', async ({ page }, testInfo) => {
    // Fixture-only: it publishes a new live rule version (v8 in the fixtures).
    await signIn(page, 'L. Fraser');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rest between shifts' })).toBeVisible();
    await expectAccessible(page, testInfo, 'rules-admin');

    const u03 = page.getByLabel('Minimum hours off for U-03');
    // A person clicks into the field, which selects the row.
    await u03.click();
    await u03.fill('14');
    await expect(page.getByText('1 change in draft')).toBeVisible();
    // The plain-language sentence for the selected row follows the value.
    await expect(page.getByText(/16 h shift, an officer needs at least 14 hours off/)).toBeVisible();
    // Build saves the unsaved edit first (R3).
    await expect(page.getByText('You have unsaved edits. Build and Submit save them first.')).toBeVisible();

    await page.getByRole('button', { name: 'Build and check' }).click();
    await expect(page.getByText(/test scenarios passed/)).toBeVisible();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText(/is submitted for approval/)).toBeVisible();

    // Safeguard: the author cannot approve their own version.
    await expect(page.getByText('You created this version. Another approver must review it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    await signOut(page, 'L. Fraser');

    await signInAgain(page, 'P. Singh');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    // The approver cannot edit or build the draft (docs/09 section 2).
    await expect(page.getByLabel('Minimum hours off for U-01')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Build and check' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'rules-approver');

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('The version is approved. It can be published.')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText(/Version \d+ is live from/)).toBeVisible();
  });

  test('@fixtures a supervisor can read the rules but not build, submit, approve or publish', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('heading', { name: 'Rest between shifts' })).toBeVisible();
    for (const action of ['Build and check', 'Submit for approval', 'Approve', 'Publish']) {
      await expect(page.getByRole('button', { name: action })).toHaveCount(0);
    }
    await expect(page.getByLabel('Minimum hours off for U-01')).toBeDisabled();
  });
});
