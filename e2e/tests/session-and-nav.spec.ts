import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { isFixtures } from './api';
import { DISCLAIMER, expectDisclaimer, signIn, signInAgain, signOut } from './support';

/**
 * Sign-in, where each role lands, the navigation each role gets, sign-out, a
 * session that ends with a 401, the footer line on every route, and no
 * government mark anywhere (HANDOFF guardrail 8, docs/ui/build-notes.md §2.1).
 */

interface Landing {
  user: string;
  topBar: string;
  heading: string | RegExp;
  nav: string[];
}

// docs/ui/build-notes.md §2.1 destinations and shell/roles.ts nav, as the
// person sees them (About & version is on every role's nav).
const LANDINGS: Landing[] = [
  {
    user: 'M. Ellis',
    topBar: 'Supervisor · M. Ellis',
    heading: 'Planning board',
    nav: ['Planning board', 'Overtime', 'Reports', 'Rules', 'Audit log', 'Wall display', 'Employee view', 'Time & attendance', 'About & version'],
  },
  {
    user: 'J. Chen',
    topBar: 'Supervisor · J. Chen',
    heading: 'Planning board',
    nav: ['Planning board', 'Overtime', 'Reports', 'Rules', 'Audit log', 'Wall display', 'Employee view', 'Time & attendance', 'About & version'],
  },
  {
    user: 'T. Nakamura',
    topBar: 'Employee · T. Nakamura',
    heading: 'My schedule',
    nav: ['My schedule', 'About & version'],
  },
  { user: 'L. Fraser', topBar: 'Rules admin · L. Fraser', heading: 'Rules', nav: ['Rules', 'About & version'] },
  { user: 'P. Singh', topBar: 'Rules approver · P. Singh', heading: 'Rules', nav: ['Rules', 'About & version'] },
  {
    user: 'A. Reviewer',
    topBar: 'Auditor · A. Reviewer',
    heading: 'Reports',
    nav: ['Planning board', 'Reports', 'Rules', 'Audit log', 'Wall display', 'About & version'],
  },
];

async function goInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** No coat of arms, wheat sheaf, crest or government logo in images or the DOM. */
async function expectNoGovernmentMark(page: Page): Promise<void> {
  const marks = await page.evaluate(() => {
    const pattern = /coat.?of.?arms|crest|wheat|sheaf|logo|saskatchewan\.ca|gov(ernment)?[-_ ]?mark/i;
    const found: string[] = [];
    for (const image of Array.from(document.images)) {
      const text = `${image.src} ${image.alt}`;
      if (pattern.test(text)) found.push(`img ${text}`);
    }
    for (const element of Array.from(document.querySelectorAll('[aria-label], [title], [class], [id]'))) {
      const text = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('id'),
      ].join(' ');
      if (/coat.?of.?arms|crest|wheat.?sheaf/i.test(text)) found.push(`${element.tagName} ${text}`);
    }
    // Background images are another way to slip a mark in.
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const background = getComputedStyle(element).backgroundImage;
      if (background && background !== 'none' && /url\(/.test(background)) found.push(`background ${background}`);
    }
    return found;
  });
  expect(marks, 'government marks or images on the page').toEqual([]);
}

test.describe('session and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'mock sign-in needs the real api');
  });

  test('the sign-in screen says it is a mock and lists the seven demo users', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Mock sign-in · demo only');
    for (const user of ['M. Ellis', 'J. Chen', 'T. Nakamura', 'L. Fraser', 'P. Singh', 'A. Reviewer', 'Unit office TV']) {
      await expect(page.getByRole('button', { name: new RegExp(user.replace('.', '\\.')) })).toBeVisible();
    }
    await expectDisclaimer(page);
    await expectNoGovernmentMark(page);
  });

  for (const landing of LANDINGS) {
    test(`${landing.user} lands on ${String(landing.heading)} with only their navigation`, async ({ page }) => {
      await signIn(page, landing.user);
      await expect(page.getByRole('heading', { name: landing.heading, level: 1 })).toBeVisible();
      await expect(page.getByRole('banner')).toContainText(landing.topBar);
      await expect(page.getByRole('banner')).toContainText('(mock sign-in)');
      const links = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
      await expect(links).toHaveText(landing.nav);
      await expectDisclaimer(page);
      await expectNoGovernmentMark(page);
    });
  }

  test('the wall display account lands on the TV screen with no navigation', async ({ page }) => {
    await signIn(page, 'Unit office TV');
    await expect(page.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await expectNoGovernmentMark(page);
  });

  test('signing out ends the session and a screen asks for sign-in again', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await signOut(page, 'M. Ellis');
    await expect(page.getByRole('banner')).not.toContainText('M. Ellis');
    // A deliberate sign-out is not an expired session: no warning.
    await expect(page.getByText('Your session ended. Sign in again.')).toHaveCount(0);
    // Going back to a screen without a token asks for sign-in again.
    await goInApp(page, '/planning');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });

  test('a signed-out visitor is not offered the supervisor navigation', async ({ page }) => {
    // D8 was here: the sign-in screen showed the full supervisor side
    // navigation because the role fell back to SUPERVISOR when no session
    // existed (shell/nav.tsx). A signed-out visitor now gets no role nav.
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Planning board' }),
    ).toHaveCount(0, { timeout: 3_000 });
  });

  test('a 401 from the api sends the person back to sign in with a notice', async ({ page }) => {
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    // The token stops being accepted (expired or revoked).
    await page.route('**/api/v1/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/problem+json', json: { title: 'Not signed in', status: 401 } }),
    );
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overtime' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Your session ended. Sign in again.' })).toBeVisible();
  });

  // DEFECT D11 (found by dev-qa): the token lives only in memory, so a full
  // reload or a deep link loses the session; the screen then fires 401s and
  // page errors instead of going to sign-in. Whether to persist the token is
  // the person's security decision; either way the reload must land on sign-in
  // with a notice, without page errors, and return to the route asked for.
  // Remove test.fail when fixed.
  for (const [link, path, heading] of [
    ['Reports', '/reports/coverage', 'Reports'],
    ['Planning board', '/planning', 'Planning board'],
  ] as const) {
    test(`a reload on ${path} lands on sign-in with a notice and no page errors`, async ({ page }) => {
      // Measured at ac7e1cd: /planning already lands on sign-in with the
      // notice (its 401 ends the session cleanly); /reports/coverage does not.
      test.fail(path === '/reports/coverage', 'D11: a reload loses the in-memory session and shows errors instead of sign-in');
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await signIn(page, 'M. Ellis');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path}$`));

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('status').filter({ hasText: /session|sign in again/i })).toBeVisible();
      expect(errors, 'page errors after the reload').toEqual([]);
    });

    // M. Ellis lands on /planning anyway, so only another route can show a return.
    if (path === '/planning') continue;
    test(`after a reload on ${path}, signing in returns to that screen`, async ({ page }) => {
      test.fail(true, 'D11: after the reload, sign-in goes to the role landing, not the asked route');
      await signIn(page, 'M. Ellis');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: /M\. Ellis/ }).click({ timeout: 5_000 });
      await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 5_000 });
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    });
  }

  test('About & version shows the build the stack runs', async ({ page, request }) => {
    const version = await (await request.get('/api/v1/version')).json();
    await signIn(page, 'P. Singh');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About & version' }).click();
    await expect(page.getByRole('heading', { name: 'About & version', level: 1 })).toBeVisible();
    await expect(page.getByText(version.gitCommit, { exact: true })).toBeVisible();
    await expect(page.getByText(version.ruleSetVersion, { exact: true })).toBeVisible();
    await expect(page.getByText(/Every person, unit and figure in the prototype is synthetic/)).toBeVisible();
  });

  test('the top bar shows the demo day, not the day before', async ({ page, request }) => {
    // D1 was here: TopBar.tsx parsed asOf as UTC midnight and formatted it in
    // Regina time, so 2026-11-19 showed as "Wed 18 Nov 2026" on every screen.
    const version = await (await request.get('/api/v1/version')).json();
    expect(version.asOf).toBe('2026-11-19');
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('banner')).toContainText('Thu 19 Nov 2026', { timeout: 5_000 });
  });

  test('a hard reload without the token asks for a sign-in and returns to the route', async ({ page }) => {
    // D11: the token lives in memory, so a reload or a deep link arrives with
    // no session. The screens used to render and call the api with no token.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await signIn(page, 'M. Ellis');
    for (const path of ['/reports/coverage', '/planning']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
      await expect(page.getByText('Please sign in to continue.')).toBeVisible();
      // Sign in where the guard put us, so the route that was asked for is kept.
      await signInAgain(page, 'M. Ellis');
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    expect(errors, 'page errors while reloading without a token').toEqual([]);
  });

  test('the footer line is on every route, including sign-in and the not-built screens', async ({ page }) => {
    await expectDisclaimer(page);
    await signIn(page, 'M. Ellis');
    for (const path of [
      '/planning', '/overtime', '/reports/coverage', '/rules', '/audit', '/me/schedule', '/time',
      '/about', '/proposals', '/me/hours', '/me/propose', '/rules/1/review', '/no-such-page', '/display',
    ]) {
      await goInApp(page, path);
      await expect(page.getByText(DISCLAIMER), `footer on ${path}`).toBeVisible();
      await expectNoGovernmentMark(page);
    }
  });
});
