import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';

import { apiAs } from './api';

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

/** Pick the unit a flow is about (the planning board defaults to the first in scope). */
export async function selectUnit(page: Page, name: string): Promise<void> {
  await page.getByLabel('Unit').first().selectOption({ label: name });
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

/**
 * Reset the demo data through the api and wait for DONE. The api's own way to
 * make a committed quarter plannable again, and to start a spec from the
 * seeded 100 baseline whatever another spec did.
 */
export async function resetDemoData(
  request: APIRequestContext,
  dataset: '100' | '120' | '150' = '100',
): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.get<{ state: string; error: string | null }>('/demo/reset/status');
    if (status.state === 'DONE') return;
    if (status.state === 'FAILED') throw new Error(`demo reset failed: ${status.error ?? 'no reason'}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('demo reset did not finish');
}

/**
 * Leave the planner with no open draft and an uncommitted quarter: reset the
 * data when the quarter is committed (a new draft is refused then), discard an
 * open draft otherwise. The planner screens need that starting point.
 */
export async function ensurePlannableQuarter(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const plan = await api.get<{ state: string; draft?: { id: string } | null }>('/planner/plan');
  if (plan.draft) {
    await api.post(`/planner/drafts/${plan.draft.id}/discard`);
  }
  if (plan.state === 'COMMITTED') {
    await resetDemoData(request, '100');
  }
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
export async function expectAccessible(
  page: Page,
  testInfo: TestInfo,
  screenName: string,
  include?: string,
): Promise<void> {
  // MUI fades and transitions blend text colours, and axe reads the blend as a
  // contrast failure (an outlined primary at 0.7 opacity measures ~4.15:1).
  // Wait for the page's animations, then measure the settled screen.
  await page.waitForFunction(
    () => document.getAnimations().every((animation) => animation.playState !== 'running'),
    undefined,
    { timeout: 15_000 },
  );
  let scan = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  // A modal dims the page behind it; scanning only the dialog keeps the
  // finding about the screen under test rather than the backdrop's blend.
  if (include) scan = scan.include(include);
  const results = await scan.analyze();
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
