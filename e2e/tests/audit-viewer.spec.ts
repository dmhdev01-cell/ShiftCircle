import { expect, test } from '@playwright/test';

import { isFixtures } from './api';
import { expectAccessible, navTo, signIn } from './support';

/**
 * The audit viewer (read-only): filters, an empty result in plain words,
 * Load more for older events, Clear, and the supervisor's narrower view
 * (no rule-change events, docs/09 §2).
 */

test.describe('audit viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the audit trail is the real api');
  });

  test('@api the auditor filters, loads older events, and clears the filters', async ({ page }, testInfo) => {
    await signIn(page, 'A. Reviewer');
    await navTo(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    const rows = page.getByRole('table', { name: 'Audit events' }).getByRole('row');
    await expect(rows.nth(1)).toBeVisible();
    await expectAccessible(page, testInfo, 'audit-log');

    // Load more appends older events and never removes the first page.
    const loadMore = page.getByRole('button', { name: 'Load more' });
    if (await loadMore.isVisible()) {
      const before = await rows.count();
      await loadMore.click();
      await expect.poll(async () => rows.count()).toBeGreaterThan(before);
    }

    // Nothing matches, in plain words: no event has happened by 2027, and the
    // Done by picker only offers people who exist (it replaced the free-text
    // 'Actor' filter: acceptance row 2).
    await page.getByLabel('From').fill('2027-01-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No audit events match these filters.')).toBeVisible();
    await expect(rows).toHaveCount(1);

    // An entity filter narrows to that kind of record.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByLabel('Done by')).toHaveValue('');
    await expect(rows.nth(1)).toBeVisible();
    // Filter on the kind of record the newest event is about, so the result is
    // never empty, and every row left must be of that kind.
    const entity = page.getByLabel('Entity');
    const options = await entity.locator('option').allTextContents();
    expect(options[0]).toBe('All entities');
    const firstEntity = ((await rows.nth(1).locator('td').nth(3).textContent()) ?? '').split(' · ')[0].trim();
    expect(options, `the Entity filter offers "${firstEntity}"`).toContain(firstEntity);
    await entity.selectOption({ label: firstEntity });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect
      .poll(async () => {
        const cells = await rows.locator('td:nth-child(4)').allTextContents();
        return cells.length > 0 && cells.every((cell) => cell.startsWith(firstEntity));
      }, { message: `every row is a ${firstEntity} after filtering` })
      .toBe(true);

    // Read-only: no row has an action.
    await expect(page.getByRole('table', { name: 'Audit events' }).getByRole('button')).toHaveCount(0);
  });

  test('@api a supervisor does not see rule-change events', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    const table = page.getByRole('table', { name: 'Audit events' });
    await expect(table.getByRole('row').first()).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: /Rule set|Rule version/i })).toHaveCount(0);
  });
});

test.describe('the audit filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the audit log comes from the real api');
  });

  test('picks an action by its plain label and shows the Done by heading', async ({ page }) => {
    await signIn(page, 'A. Reviewer');
    await navTo(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();

    // The column heading is the person's word, and the filter carries the same.
    const table = await screen_table(page);
    await expect(table.getByRole('columnheader', { name: 'Done by' })).toBeVisible();
    await expect(page.getByLabel('Done by')).toBeVisible();

    // Action is a picker of plain labels, not a typed code.
    const action = page.getByLabel('Action');
    const option = await action.getByRole('option').nth(1).textContent();
    expect(option ?? '').not.toMatch(/_/);
    await action.selectOption({ label: option ?? '' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  });
});

/** The events table, once the first answer has landed. */
async function screen_table(page: import('@playwright/test').Page) {
  const table = page.getByRole('table', { name: 'Audit events' });
  await expect(table).toBeVisible();
  return table;
}
