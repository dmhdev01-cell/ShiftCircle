import { expect, test } from '@playwright/test';

import { expectAccessible, navTo, signIn, signInAgain, signOut } from './support';

/**
 * E2 (docs/10-testing.md section 5): the employee (Tara) accepts the offer and
 * the supervisor confirms it. Only a supervisor confirms an extra shift (S-04).
 */

async function openPc08(page: import('@playwright/test').Page): Promise<void> {
  await page
    .getByRole('button', { name: /Sat 21 Nov · Days 07:00 – 15:00/ })
    .filter({ hasText: 'Unit B · Living unit' })
    .filter({ hasText: 'Extra coverage' })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: /Sat 21 Nov · Days 07:00 – 15:00/, level: 2 }),
  ).toBeVisible();
}

test.describe('E2 overtime offer, accept, confirm', () => {
  test('an offer reaches Tara, she accepts, the supervisor confirms', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Overtime');
    await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    await openPc08(page);
    await page.getByRole('checkbox', { name: 'Select Tara Nakamura for this shift' }).check();
    await page.getByRole('button', { name: 'Offer to selected (1)' }).click();
    await expect(page.getByText(/1 offer recorded/)).toBeVisible();
    await signOut(page, 'M. Ellis');

    await signInAgain(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    await expectAccessible(page, testInfo, 'my-schedule');
    const offer = page
      .getByRole('region', { name: 'Overtime offer' })
      .filter({ hasText: 'Sat 21 Nov' })
      .filter({ hasText: '07:00 – 15:00' })
      .filter({ hasText: 'Unit B · Living unit' });
    await expect(offer).toHaveCount(1);
    // The offer says what the rules said, and never promises overtime pay (ADR-016).
    await expect(offer.getByText(/paid at overtime rates/)).toHaveCount(0);
    await offer.getByRole('button', { name: 'Accept' }).click();
    await expect(offer.getByText('Accepted. Your supervisor will confirm the assignment.')).toBeVisible();
    // Accepting does not assign the shift; there is nothing more Tara can do.
    await expect(offer.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await signOut(page, 'T. Nakamura');

    await signInAgain(page, 'M. Ellis');
    await navTo(page, 'Overtime');
    await openPc08(page);
    const accepted = page.getByRole('group', { name: 'Tara Nakamura · Accepted' });
    await expect(accepted).toBeVisible();
    await accepted.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('The accepted offer is confirmed and the shift is assigned.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Tara Nakamura · Confirmed' })).toBeVisible();
  });

  test('an employee sees no colleague hours or overtime totals', async ({ page }) => {
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    // Navigation is the employee's: no supervisor screens.
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Planning board' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await expect(page.getByText(/In overtime|Approaching/)).toHaveCount(0);
  });
});
