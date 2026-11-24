import { expect, test } from '@playwright/test';

import { expectAccessible, expectDisclaimer, selectUnit, signIn } from './support';

/**
 * E1 (docs/10-testing.md section 5): the supervisor tries to assign Nia
 * Thompson to Saturday days (planted case PC-01) and the rules block it; the
 * override needs a written reason; "Find eligible officer" leads to offers.
 */

const PC01_CHIP = /! D proposed for Nia Thompson/;

test.describe('E1 blocked assignment (PC-01)', () => {
  test('@fixtures a Block shows its reasons and offers no way to save', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await expectDisclaimer(page);
    await expectAccessible(page, testInfo, 'planning-board');

    await page.getByRole('button', { name: PC01_CHIP }).click();

    await expect(page.getByRole('heading', { name: /Assign Nia Thompson/ })).toBeVisible();
    await expect(page.getByText('Blocked: 3 rules fail')).toBeVisible();
    // The reasons name the rules and say why, in plain words.
    await expect(page.getByText(/U-01 · Minimum rest/)).toBeVisible();
    await expect(page.getByText(/U-05/).first()).toBeVisible();
    await expect(page.getByText(/U-14/).first()).toBeVisible();
    // The fixture's U-01 text says "7 hours' rest"; the api says "Less than 8 hours rest".
    await expect(page.getByText(/Less than 8 hours rest|7 hours' rest/)).toBeVisible();
    // Safeguard: nothing to save and nothing to acknowledge past a Block.
    await expect(page.getByRole('button', { name: /^Assign shift$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Acknowledge/ })).toHaveCount(0);
    // U-14 is a Block whose policy is ACKNOWLEDGE, so the api refuses an
    // override; the screen must not offer one.
    await expect(page.getByRole('button', { name: 'Emergency override…' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'planning-rule-check');
  });

  test('@fixtures the dock keeps its primary action above the fold', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await signIn(page, 'M. Ellis');
    await page.getByRole('button', { name: PC01_CHIP }).click();

    await expect(page.getByText('Blocked: 3 rules fail')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find eligible officer' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport();
  });

  test('@fixtures a Block with an ACKNOWLEDGE policy offers no way past it', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await page.getByRole('button', { name: PC01_CHIP }).click();

    await expect(page.getByText('Blocked: 3 rules fail')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Emergency override…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Acknowledge/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign shift' })).toHaveCount(0);
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'planning-rule-check');
  });

  // The real api has no proposals in the schedule payload yet (proposals are a
  // Should item), so the fixture's proposed chip is fixtures-only. Against the
  // real api the same PC-01 case is driven from Nia's empty Saturday cell.
  test('@api PC-01 blocks from the empty cell and the overtime link works', async ({ page }, testInfo) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    // Fixtures have the proposed chip instead of an empty cell.
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'the fixture board uses the proposed chip',
    );
    await selectUnit(page, 'Unit B · Living unit');

    const cell = page.getByRole('button', {
      name: 'Off - assign a shift to Nia Thompson on 2026-11-21',
    });
    await expect(cell).toBeVisible();
    await cell.click();
    await page.getByRole('button', { name: /D8 · Day 8 h/ }).click();

    // The real rule set blocks U-01, U-05 and U-14 (the proposed shift takes
    // the week over the 60 h ceiling); the repaired seed also adds U-08 here
    // (ten consecutive work days). The fixture returns two blocks.
    await expect(page.getByText(/Blocked: [234] rules fail/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Assign Nia Thompson/ })).toBeVisible();
    await expect(page.getByText(/U-01 · Minimum rest/)).toBeVisible();
    await expect(page.getByText(/Less than 8 hours rest/)).toBeVisible();
    // The seed repair restores PC-01's U-14 meaning: 64 h in the week.
    await expect(page.getByText(/U-14 · Weekly ceiling/)).toBeVisible();
    // D4 (demo verification): Blocks come first, and identical results are
    // one row with a count (U-16 Warn was listed 14 times, and U-14 sat below
    // the Warns, out of the dock).
    const rows = page
      .getByRole('list')
      .filter({ has: page.getByText('U-01 · Minimum rest') })
      .getByRole('listitem');
    const codes = (await rows.allTextContents()).map((text) => /U-\d+/.exec(text)?.[0]);
    const blocks = await rows.filter({ hasText: /^Block/ }).count();
    expect(blocks).toBeGreaterThanOrEqual(3);
    expect(codes.slice(0, blocks)).toContain('U-14');
    for (let index = 0; index < blocks; index += 1) {
      await expect(rows.nth(index)).toContainText(/^Block/);
    }
    if (codes.includes('U-16')) {
      expect(codes.filter((code) => code === 'U-16').length).toBe(1);
    }
    if ((page.viewportSize()?.height ?? 0) >= 900 && (page.viewportSize()?.width ?? 0) >= 1440) {
      // Every Block is readable in the dock without scrolling it (demo §2).
      for (let index = 0; index < blocks; index += 1) {
        await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
      }
    }
    await expect(page.getByRole('button', { name: /^Assign shift$/ })).toHaveCount(0);
    // U-14 is a Block row whose policy is ACKNOWLEDGE, so the api refuses an
    // override and the screen must not offer the dialog.
    await expect(page.getByRole('button', { name: 'Emergency override…' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'planning-rule-check');

    await page.getByRole('link', { name: 'Find eligible officer' }).click();
    await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Sat 21 Nov · Days 07:00 – 15:00/, level: 2 }),
    ).toBeVisible();
  });

  test('@fixtures Find eligible officer leads to the ranked list and offers to two officers', async ({ page }, testInfo) => {
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
