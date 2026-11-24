import { expect, test } from '@playwright/test';

import { apiAs } from './api';
import { expectAccessible, signIn, signInAgain, signOut } from './support';

/**
 * E3 (docs/10-testing.md section 5): the rules admin changes U-02 (the rest
 * target between shifts) from 12 to 14 h, builds and submits; the author
 * cannot approve; a second person approves and publishes. No code change.
 *
 * A stack-wide spec (STACK_SPECS in playwright.config.ts): on the real api it
 * publishes an effective rule change, so it runs one at a time, last.
 */

test.describe('E3 rule change with maker/checker', () => {
  test('admin edits, builds and submits; approver approves and publishes', async ({ page }, testInfo) => {
    // Writes state: it publishes a new live rule version (v8 in the fixtures, v4 on a fresh real api).
    await signIn(page, 'L. Fraser');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rest between shifts' })).toBeVisible();
    await expectAccessible(page, testInfo, 'rules-admin');

    // The real api starts with the live version and no draft; the screen creates one.
    // The fixtures already have draft v8, so this step is skipped there.
    if (await page.getByRole('button', { name: 'Start a draft' }).isVisible().catch(() => false)) {
      // D2: the live version is not a draft, so there is no "in draft" pill
      // ("Live v3 · no draft" showed "1 change in draft").
      await expect(page.getByText(/in draft$/)).toHaveCount(0);
      await page
        .getByLabel('Why is this change needed?')
        .fill('Raise the rest target between shifts to 14 hours');
      await page.getByRole('button', { name: 'Start a draft' }).click();
    }
    await expect(page.getByRole('button', { name: 'Build and check' })).toBeVisible();

    const u02 = page.getByLabel('Minimum hours off for U-02');
    // A person clicks into the field, which selects the row.
    await u02.click();
    await u02.fill('14');
    await expect(page.getByText('1 change in draft')).toBeVisible();
    // The plain-language sentence for the selected row follows the value, in
    // words: the shift kind is named, never the stored pattern, and the
    // outcome is said once (it read "After (d8|e8|...), ... has to acknowledge
    // it, and the supervisor has to acknowledge it.").
    const sentence = page.getByText(
      'After a D8, E8, N8, A12, P12, D12 or N12 shift, an officer needs at least 14 hours off within 24 hours; otherwise the change is warned. A supervisor must acknowledge it before the change is saved.',
    );
    await expect(sentence).toBeVisible();
    await expect(sentence).not.toContainText('|');
    const composed = await sentence.textContent();
    // Build saves the unsaved edit first (R3).
    await expect(page.getByText('You have unsaved edits. Build and Submit save them first.')).toBeVisible();

    await page.getByRole('button', { name: 'Build and check' }).click();
    await expect(page.getByText(/test scenarios passed/)).toBeVisible();
    // Unlike the dormant U-03, the U-02 edit has an effect the dry run shows
    // (demo §4: one result, U-02, Unit A, Pass -> Warn). The fixtures' build
    // report is canned, so this check is real-api only.
    if ((await page.getByText('Demo fixtures').count()) === 0) {
      await expect(page.getByText(/\d+ result\(s\) change on the current roster\./)).toBeVisible();
      await expect(page.getByText(/^\d+ officers? in Unit A goe?s? from Pass to Warn under U-02$/)).toBeVisible();

      // Contract: the sentence the web composed while typing is the one the
      // api keeps with the saved row (RuleSentence.java), word for word.
      const api = await apiAs(page.request, 'l.fraser');
      const versions = await api.get<{ version: number; status: string }[]>('/rule-sets');
      const draft = versions.find((entry) => entry.status === 'DRAFT');
      expect(draft, 'the draft E3 just built').toBeTruthy();
      const rest = await api.get<{ rows: { ruleCode: string; sentence: string }[] }>(
        `/rule-sets/${draft!.version}/tables/rest-between-shifts`,
      );
      expect(rest.rows.find((row) => row.ruleCode === 'U-02')?.sentence).toBe(composed);
    }
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
    await expect(page.getByText(/^Version \d+ is live now\.$/)).toBeVisible();
    // D2/D3: the now-live version has no "in draft" pill, and the version
    // history reads its dates for people, never a raw ISO stamp.
    await expect(page.getByText(/in draft$/)).toHaveCount(0);
    const history = page.getByRole('heading', { name: 'Version history' }).locator('..');
    await expect(history).not.toContainText(/\d{4}-\d{2}-\d{2}T/);
    if ((await page.getByText('Demo fixtures').count()) === 0) {
      await expect(history).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
    }

    // The hot swap really happened: the version endpoint reports the new live rule set.
    // The fixtures have no version endpoint, so this check is real-api only.
    if ((await page.getByText('Demo fixtures').count()) === 0) {
      const version = await page.request.get('/api/v1/version');
      expect((await version.json()).ruleSetVersion).not.toBe('v1');
    }
  });

  test('a supervisor can read the rules but not build, submit, approve or publish', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('heading', { name: 'Rest between shifts' })).toBeVisible();
    for (const action of ['Build and check', 'Submit for approval', 'Approve', 'Publish']) {
      await expect(page.getByRole('button', { name: action })).toHaveCount(0);
    }
    await expect(page.getByLabel('Minimum hours off for U-01')).toBeDisabled();
  });
});
