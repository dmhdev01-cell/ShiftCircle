import { expect, test } from '@playwright/test';

import { expectAccessible, navTo, signIn, signInAgain, signOut } from './support';

/**
 * E2 (docs/10-testing.md section 5): the employee (Tara) accepts the offer and
 * the supervisor confirms it. Only a supervisor confirms an extra shift (S-04).
 */

async function openPc08(page: import('@playwright/test').Page): Promise<void> {
  const unitB = page
    .getByRole('button', { name: /Sat 21 Nov · Days 07:00 – 15:00/ })
    .filter({ hasText: 'Unit B · Living unit' });
  // Wait for the list before choosing: the first matching card can be the
  // filled one, and offering on it is refused.
  await expect(unitB.first()).toBeVisible();
  // The real api has both the filled and the open shift for that slot; the
  // fixtures have only the open one.
  const extra = unitB.filter({ hasText: 'Extra coverage' });
  const card = (await extra.count()) > 0 ? extra.first() : unitB.first();
  await card.click();
  await expect(
    page.getByRole('heading', { name: /Sat 21 Nov · Days 07:00 – 15:00/, level: 2 }),
  ).toBeVisible();
}

test.describe('E2 overtime offer, accept, confirm', () => {
  test('an offer reaches Tara, she accepts, the supervisor confirms', async ({ page, browser }, testInfo) => {
    await signIn(page, 'M. Ellis');
    const fixtures = (await page.getByText('Demo fixtures').count()) > 0;

    // Demo §3 / D1: on the real api Tara's My schedule is already open in a
    // second window when the offer is sent. The fixtures keep their data in
    // one page, so there Tara signs in after the offer instead.
    let tara = page;
    if (!fixtures) {
      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        viewport: testInfo.project.use.viewport,
      });
      tara = await context.newPage();
      await signIn(tara, 'T. Nakamura');
      await expect(tara.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    }

    await navTo(page, 'Overtime');
    await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    await openPc08(page);
    await page.getByRole('checkbox', { name: 'Select Tara Nakamura for this shift' }).check();
    await page.getByRole('button', { name: 'Offer to selected (1)' }).click();
    await expect(page.getByText(/1 offer recorded/)).toBeVisible();

    if (fixtures) {
      await signOut(page, 'M. Ellis');
      await signInAgain(page, 'T. Nakamura');
    } else {
      // Coming back to the window fetches the offers again: no page refresh.
      await tara.bringToFront();
      await tara.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    await expect(tara.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    await expectAccessible(tara, testInfo, 'my-schedule');
    const offer = tara
      .getByRole('region', { name: 'Overtime offer' })
      .filter({ hasText: 'Sat 21 Nov' })
      .filter({ hasText: '07:00 – 15:00' })
      .filter({ hasText: 'Unit B · Living unit' });
    await expect(offer).toHaveCount(1);
    // D1: the newest open offer comes first: above the older seeded offers
    // (Sun 13 Dec and Thu 10 Dec came first before). A parallel spec may offer
    // Tara a newer November shift, so only the December cards are checked.
    const cards = await tara.getByRole('region', { name: 'Overtime offer' }).allTextContents();
    const position = cards.findIndex((text) => text.includes('Sat 21 Nov') && text.includes('Unit B'));
    expect(position).toBeGreaterThanOrEqual(0);
    expect(cards.slice(0, position).filter((text) => / Dec /.test(text))).toEqual([]);
    // The offer says what the rules said, and never promises overtime pay (ADR-016).
    await expect(offer.getByText(/paid at overtime rates/)).toHaveCount(0);
    await offer.getByRole('button', { name: 'Accept' }).click();
    await expect(offer.getByText('Accepted. Your supervisor will confirm the assignment.')).toBeVisible();
    // Accepting does not assign the shift; there is nothing more Tara can do.
    await expect(offer.getByRole('button', { name: 'Accept' })).toHaveCount(0);

    if (fixtures) {
      await signOut(page, 'T. Nakamura');
      await signInAgain(page, 'M. Ellis');
      await navTo(page, 'Overtime');
    } else {
      await tara.context().close();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    }
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
