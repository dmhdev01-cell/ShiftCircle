import { expect, test } from '@playwright/test';

import { signIn } from './support';

/**
 * E5 (docs/10-testing.md section 5): the wall display shows counts only, no
 * names anywhere in the DOM, and refreshes.
 */

const DEMO_NAMES = [
  'Tara Nakamura', 'Nia Thompson', 'Ruth Okafor', 'Marc Desjardins', 'Kari Lindqvist',
  'Sam Abara', 'Piotr Kowalczyk', 'Leah Morin', 'Devon Clarke', 'Aiden Bergeron',
];

test.describe('E5 wall display', () => {
  test.fixme(true, 'The wall display screen is not built yet (App.tsx renders a placeholder at /display).');

  test('shows counts only, with no officer names anywhere in the page', async ({ page }) => {
    await signIn(page, 'Unit office TV');
    await expect(page.getByText("Today's coverage")).toBeVisible();
    const html = await page.content();
    for (const name of DEMO_NAMES) {
      expect(html, `name in the wall display DOM: ${name}`).not.toContain(name);
    }
  });

  test('refreshes the counts every 60 seconds', async ({ page }) => {
    await page.clock.install();
    await signIn(page, 'Unit office TV');
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/display/today')) requests.push(request.url());
    });
    await page.clock.runFor(61_000);
    expect(requests.length).toBeGreaterThan(0);
  });
});
