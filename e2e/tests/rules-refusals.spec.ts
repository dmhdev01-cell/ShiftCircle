import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { shot } from './shots';
import { expectAccessible, signIn, signInAgain, signOut } from './support';

/**
 * The rules admin's refusals in plain words (review-r2/r3 fixes, docs/04 §5a):
 * a rest value outside 8 - 24 hours is refused and nothing is saved; the
 * approver cannot edit a draft; the plain-language sentence reads as words.
 *
 * The shift-kind column is a select of named kinds (Any shift, Regular shift,
 * 16 h shift), so a hostile pattern cannot be typed through the screen; the
 * api refusal of hostile patterns is pinned by RuleRowEditApiTest and review
 * rounds R39/R40 (see COVERAGE.md).
 *
 * E3 also edits the rules and publishes. If E3 holds a submitted version when
 * this spec starts, no draft can be edited and the spec says so and stops.
 */

async function openDraft(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
  const start = page.getByRole('button', { name: 'Start a draft' });
  const build = page.getByRole('button', { name: 'Build and check' });
  // Either a draft can be started, a draft is open, or another spec holds a
  // submitted version (then neither button is there).
  await expect(start.or(build).or(page.getByText(/Submitted|Approved/).first())).toBeVisible();
  if (await start.isVisible()) {
    await page.getByLabel('Why is this change needed?').fill('Refusal spec: try values outside the legal range');
    await start.click();
  }
}

test.describe('rules admin refusals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the refusals come from the real api');
  });

  test('@api a rest value below the legal floor or above 24 h is refused in plain words', async ({ page, request }, testInfo) => {
    await signIn(page, 'L. Fraser');
    await openDraft(page);
    const build = page.getByRole('button', { name: 'Build and check' });
    const editable = await build
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!editable, 'another spec holds a submitted version; run this spec alone');

    const u01 = page.getByLabel('Minimum hours off for U-01');
    for (const value of ['7', '25']) {
      await u01.click();
      await u01.fill(value);
      await build.click();
      const refusal = page.getByText(/between 8 and 24|below 8|at least 8|legal floor/i).first();
      await expect(refusal).toBeVisible();
      // Plain words: no stack trace, class name or SQL in what the admin reads.
      await expect(page.getByText(/Exception|java\.|SQLSTATE|org\.springframework/)).toHaveCount(0);
      // Nothing about the build passing.
      await expect(page.getByText(/test scenarios passed/)).toHaveCount(0);
      if (value === '7') {
        await expectAccessible(page, testInfo, 'rules-refusal');
        await shot(page, testInfo, 'rules-admin', 'rules', 'refusal');
      }
    }

    // The stored draft still has the legal value.
    const api = await apiAs(request, 'l.fraser');
    const sets = await api.get<{ version: number; status: string }[]>('/rule-sets');
    const draft = sets.find((set) => set.status === 'DRAFT');
    expect(draft, 'the draft this spec edited').toBeTruthy();
    const table = await api.get<{ rows: { ruleCode: string; params: { minRestHours?: number } }[] }>(
      `/rule-sets/${draft!.version}/tables/REST`,
    );
    const stored = table.rows.find((row) => row.ruleCode === 'U-01');
    expect(stored?.params.minRestHours, 'U-01 as stored after the refusals').toBe(8);

    // Put the screen back so a person reading the draft sees no stray edit.
    await u01.fill('8');
  });

  test('@api the approver cannot edit a draft, and the plain-language sentence is words', async ({ page }) => {
    await signIn(page, 'P. Singh');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Minimum hours off for U-01')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Build and check' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start a draft' })).toHaveCount(0);
    await signOut(page, 'P. Singh');

    // D6 was here: the api's `sentence` for U-01 and U-04 read "After .*, an
    // officer needs at least 8 hours off ... the change is block." - the raw
    // pattern and the enum word in the plain language the admin reads. Main
    // fixes it (8c5d705): "any shift ... is blocked".
    await signInAgain(page, 'L. Fraser');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    const sentence = page.getByText(/an officer needs at least \d+ hours off/).first();
    await expect(sentence).toBeVisible();
    await expect(sentence).not.toContainText('.*', { timeout: 3_000 });
    // The bare enum words, with their full stop ("the change is block." /
    // "is warn."); the fixed wording "is blocked" must not match.
    await expect(sentence).not.toContainText(/\bis (block|warn)\./);
  });
});
