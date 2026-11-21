import { expect, test } from '@playwright/test';

import { DISCLAIMER, expectAccessible, navTo, signIn } from './support';

/**
 * E5 (docs/10-testing.md section 5): the wall display shows counts only, no
 * names anywhere in the page, refreshes, and says so when it is not live.
 * Runs against the fixtures web and the real api; the one test that cuts the
 * network is @api (the fixtures web makes no request to cut).
 */

const DEMO_NAMES = [
  'Tara Nakamura', 'Nia Thompson', 'Ruth Okafor', 'Marc Desjardins', 'Kari Lindqvist',
  'Sam Abara', 'Piotr Kowalczyk', 'Leah Morin', 'Devon Clarke', 'Aiden Bergeron',
];

/** 14:32 in Regina on the demo day. */
const DEMO_TIME = new Date('2026-11-19T20:32:00Z');

async function openAsDisplay(page: import('@playwright/test').Page): Promise<void> {
  await signIn(page, 'Unit office TV');
  await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Unit A · Living unit' })).toBeVisible();
}

async function updatedText(page: import('@playwright/test').Page): Promise<string> {
  const status = page.getByRole('status').filter({ hasText: /updated \d{2}:\d{2}/ });
  await expect(status).toBeVisible();
  return (await status.textContent()) ?? '';
}

test.describe('E5 wall display', () => {
  test('shows counts only, with no officer names or employee numbers anywhere in the page', async ({ page }, testInfo) => {
    await openAsDisplay(page);
    await expect(page.getByRole('region', { name: 'Facility today' })).toBeVisible();
    await expect(page.getByText('Shared screen: counts only, no names')).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();

    const html = await page.content();
    for (const name of DEMO_NAMES) {
      expect(html, `name in the wall display DOM: ${name}`).not.toContain(name);
    }
    expect(html, 'an employee number in the wall display DOM').not.toMatch(/\bE-\d{3,}\b/);
    await expectAccessible(page, testInfo, 'wall-display');
  });

  test('refreshes every 60 seconds and says when it last did', async ({ page }) => {
    await page.clock.install({ time: DEMO_TIME });
    await openAsDisplay(page);
    const before = await updatedText(page);

    await page.clock.runFor(61_000);
    await expect
      .poll(async () => updatedText(page), { message: 'the "updated" time moves after a refresh' })
      .not.toBe(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('@api says it is not live when the api cannot be reached, and recovers', async ({ page }, testInfo) => {
    await page.goto('/login');
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'the network test needs the real api',
    );
    await page.clock.install({ time: DEMO_TIME });
    await openAsDisplay(page);
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.route('**/api/v1/display/today', (route) => route.abort());
    await page.clock.runFor(61_000);
    await expect(page.getByRole('alert')).toContainText('Not live: no update since');
    await expect(page.getByText(/^Last known: /).first()).toBeVisible();
    // The banner takes room: the stale screen must fit too (it once spilled into the footer).
    if (testInfo.project.name === 'desktop') {
      for (const size of [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
      ]) {
        await page.setViewportSize(size);
        await expectFits(page, `stale ${size.width}×${size.height}`);
      }
    }
    await expect(page.getByRole('heading', { name: 'Facility today · last known' })).toBeVisible();

    await page.unroute('**/api/v1/display/today');
    await page.clock.runFor(61_000);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a supervisor sees only their own units', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Wall display');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Unit A · Living unit' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Unit B · Living unit' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Unit C · Living unit' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Leave the wall display' })).toBeVisible();

    // Acceptance row 7d: the Exit control must not overlap the clock or the
    // footer at either viewport (a fixed corner button covered the clock).
    const exit = page.getByRole('button', { name: 'Exit wall display' });
    await expect(exit).toBeVisible();
    for (const [what, other] of [
      ['clock', page.getByRole('timer')],
      ['footer', page.getByText(/refreshes every/).first()],
    ] as const) {
      const box = await exit.boundingBox();
      const otherBox = await other.boundingBox();
      expect(box && otherBox, `${what} has a box`).toBeTruthy();
      const overlaps =
        box!.x < otherBox!.x + otherBox!.width &&
        otherBox!.x < box!.x + box!.width &&
        box!.y < otherBox!.y + otherBox!.height &&
        otherBox!.y < box!.y + box!.height;
      expect(overlaps, `the Exit button does not cover the ${what}`).toBe(false);
    }
  });

  test('fits a 1920×1080 TV and a 1366×768 screen without scrolling', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'TV sizes are checked once, in the desktop project');
    // 14:32 and 20:05: in the fixtures, Unit C's evening shortfall is first a
    // row further down the card, then the card's headline. Both must fit.
    await page.clock.install({ time: DEMO_TIME });
    for (const time of [DEMO_TIME, new Date('2026-11-20T02:05:00Z')])
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
    ]) {
      await page.clock.setSystemTime(time);
      await page.setViewportSize(size);
      await openAsDisplay(page);
      await page.clock.runFor(2_000);
      await expectFits(page, `${size.width}×${size.height}`);
    }
  });
});

/**
 * The page doesn't scroll, and nothing spills: a card can overflow onto its
 * neighbour or the footer without the page scrolling, so every card and the
 * main area must hold its content.
 */
async function expectFits(page: import('@playwright/test').Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    vertical: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    horizontal: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  }));
  expect(overflow, `page overflow at ${label}`).toEqual({ vertical: 0, horizontal: 0 });
  const spilled = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main, main section[aria-label]')]
      .filter((element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.getAttribute('aria-label') ?? 'main'} (${element.scrollHeight} > ${element.clientHeight})`),
  );
  expect(spilled, `content spilling out at ${label}`).toEqual([]);
}
