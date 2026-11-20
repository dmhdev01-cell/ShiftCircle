import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';

/**
 * Shared steps for the flows. Everything is found by role, label or text,
 * never by CSS path, so the specs describe what a person sees.
 *
 * The fixtures-mode web keeps its session and data in memory, so a flow moves
 * between screens by clicking, not by page.goto (a reload would reset it).
 */

export const DISCLAIMER =
  'Not an official Government of Saskatchewan service · fictional, synthetic data only';

/** Open the mock sign-in screen and pick a demo user. */
export async function signIn(page: Page, displayName: string): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(escapeRegExp(displayName)) }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
}

/** Sign out through the account menu; lands on the sign-in screen. */
export async function signOut(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: `Account menu for ${displayName}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** From the sign-in screen, sign in a second person without reloading. */
export async function signInAgain(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(escapeRegExp(displayName)) }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
}

/** Go to a screen through the main navigation. */
export async function navTo(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

/**
 * Accessibility check for the screen as it is now (docs/10-testing.md: no
 * serious or critical axe violations, WCAG 2.1 AA). The full result is
 * attached to the report so moderate findings are visible too.
 */
export async function expectAccessible(page: Page, testInfo: TestInfo, screenName: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await testInfo.attach(`axe-${screenName}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  const serious = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help} [${violation.nodes.length} node(s)]`);
  expect(serious, `axe serious/critical violations on ${screenName}`).toEqual([]);
}

/** The footer line every screen must carry (HANDOFF guardrail 8). */
export async function expectDisclaimer(page: Page): Promise<void> {
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

/**
 * Keyboard only: press Tab until the target has focus. Fails with the focus
 * trail if it takes more than maxTabs presses, so a broken focus order shows
 * up as a readable failure.
 */
export async function tabTo(page: Page, target: Locator, maxTabs = 120): Promise<number> {
  const trail: string[] = [];
  for (let presses = 1; presses <= maxTabs; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return presses;
    }
    trail.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return '(none)';
        const label = element.getAttribute('aria-label') ?? element.textContent ?? '';
        return `${element.tagName.toLowerCase()} "${label.trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
      }),
    );
  }
  throw new Error(`Focus never reached the target in ${maxTabs} Tabs. Last stops: ${trail.slice(-8).join(' > ')}`);
}

/** The element that has focus is the target. */
export async function expectFocused(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
