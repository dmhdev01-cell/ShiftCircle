import { expect, test } from '@playwright/test';

import { navTo, signIn } from './support';

/**
 * The roster and the time grid must show the whole week / pay period on a
 * laptop (HANDOFF step 12, UX fixes). A tablet may still scroll sideways, but
 * then it has to say so with a plain-words hint.
 */
test.describe('the week and the pay period fit a laptop', () => {
  for (const width of [1280, 1366]) {
    test(`shows every day at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, 'M. Ellis');

      await navTo(page, 'Planning board');
      const roster = page.getByRole('region', { name: 'Roster, scrolls sideways' });
      await expect(roster).toBeVisible();
      await expect(roster.getByRole('columnheader').last()).toBeInViewport();
      const rosterSize = await roster.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(rosterSize.scrollWidth).toBeLessThanOrEqual(rosterSize.clientWidth + 2);

      await navTo(page, 'Time & attendance');
      const grid = page.getByRole('region', { name: 'Time entries, scrolls sideways' });
      await expect(grid).toBeVisible();
      await expect(grid.getByRole('columnheader').last()).toBeInViewport();
      const gridSize = await grid.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(gridSize.scrollWidth).toBeLessThanOrEqual(gridSize.clientWidth + 2);
    });
  }

  test('says when a tablet has to scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page, 'M. Ellis');

    await navTo(page, 'Planning board');
    await expect(page.getByText('Scroll sideways to see the rest of the week.')).toBeVisible();
    const roster = page.getByRole('region', { name: 'Roster, scrolls sideways' });
    const firstColumn = roster.getByRole('row').nth(4).getByRole('cell').first();
    await firstColumn.scrollIntoViewIfNeeded();
    await roster.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(firstColumn).toBeInViewport();

    await navTo(page, 'Time & attendance');
    await expect(page.getByText('Scroll sideways for more days.')).toBeVisible();
    const grid = page.getByRole('region', { name: 'Time entries, scrolls sideways' });
    const firstOfficer = grid.getByRole('row').nth(1).getByRole('cell').first();
    await firstOfficer.scrollIntoViewIfNeeded();
    await grid.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(firstOfficer).toBeInViewport();
  });
});
