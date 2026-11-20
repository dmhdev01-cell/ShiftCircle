import { expect, test } from '@playwright/test';

import { expectAccessible, expectDisclaimer, signIn } from './support';

/**
 * E1 (docs/10-testing.md section 5): the supervisor tries to assign Nia
 * Thompson to Saturday days (planted case PC-01) and the rules block it; the
 * override needs a written reason; "Find eligible officer" leads to offers.
 */

const PC01_CHIP = /! D proposed for Nia Thompson/;

test.describe('E1 blocked assignment (PC-01)', () => {
  test('a Block shows its reasons and offers no way to save', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await expectDisclaimer(page);
    await expectAccessible(page, testInfo, 'planning-board');

    await page.getByRole('button', { name: PC01_CHIP }).click();

    await expect(page.getByRole('heading', { name: /Assign Nia Thompson/ })).toBeVisible();
    await expect(page.getByText('Blocked: 2 rules fail')).toBeVisible();
    // The reasons name the rules and say why, in plain words.
    await expect(page.getByText(/U-01 · Minimum rest/)).toBeVisible();
    await expect(page.getByText(/U-05/).first()).toBeVisible();
    await expect(page.getByText(/7 hours' rest/)).toBeVisible();
    // Safeguard: nothing to save and nothing to acknowledge past a Block.
    await expect(page.getByRole('button', { name: /^Assign shift$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Acknowledge/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Emergency override…' })).toBeVisible();
    await expectAccessible(page, testInfo, 'planning-rule-check');
  });

  test('the emergency override needs a reason of at least 10 characters', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await page.getByRole('button', { name: PC01_CHIP }).click();
    await page.getByRole('button', { name: 'Emergency override…' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The dialog names the broken rules and the warning it acknowledges.
    await expect(dialog.getByText(/This overrides U-01, U-05/)).toBeVisible();
    await expect(dialog.getByText(/warnings are acknowledged with the override: U-14/)).toBeVisible();
    await expectAccessible(page, testInfo, 'override-dialog');

    const reason = dialog.getByLabel('Why is this override needed?');
    const confirm = dialog.getByRole('button', { name: 'Emergency override' });
    await expect(confirm).toBeDisabled();
    await reason.fill('Lockdown');          // 8 characters
    await expect(confirm).toBeDisabled();
    await reason.fill('          ');        // only spaces do not count
    await expect(confirm).toBeDisabled();
    await reason.fill('Lockdown!!');        // exactly 10
    await expect(confirm).toBeEnabled();

    // Cancel saves nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Blocked: 2 rules fail')).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
  });

  test('@fixtures with a reason the override saves', async ({ page }) => {
    // Fixture-only: against the real api this writes an override and an audit
    // row, so it belongs in a disposable environment.
    await signIn(page, 'M. Ellis');
    await page.getByRole('button', { name: PC01_CHIP }).click();
    await page.getByRole('button', { name: 'Emergency override…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Why is this override needed?').fill('Lockdown, relief unavailable');
    await dialog.getByRole('button', { name: 'Emergency override' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  });

  test('Find eligible officer leads to the ranked list and offers to two officers', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await page.getByRole('button', { name: PC01_CHIP }).click();
    await page.getByRole('link', { name: 'Find eligible officer' }).click();

    await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Sat 21 Nov · Days 07:00 – 15:00/, level: 2 })).toBeVisible();
    // Skipped officers keep their place and cannot be selected.
    await expect(page.getByText(/skipped without losing their place/)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Select Aiden Bergeron/ })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'overtime-board');

    await page.getByRole('checkbox', { name: 'Select Sam Abara for this shift' }).check();
    await page.getByRole('checkbox', { name: 'Select Marc Desjardins for this shift' }).check();
    await page.getByRole('button', { name: 'Offer to selected (2)' }).click();
    await expect(page.getByText(/2 offers recorded/)).toBeVisible();
  });
});
