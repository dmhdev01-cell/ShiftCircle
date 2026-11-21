import { expect, test } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, signIn, signInAgain } from './support';

/**
 * Option C: the shift pattern is per officer. The planner changes an 8-hour
 * officer's pattern on Preferences; a 12-hour officer's crew pattern is words,
 * not a picker. The change reaches the api and survives a reload.
 */

interface PreferenceRow {
  employeeId: string;
  name: string;
  pattern: string;
  patternWords: string;
  patternEditable: boolean;
}

async function preferences(request: APIRequestContext): Promise<PreferenceRow[]> {
  const api = await apiAs(request, 'p.planner');
  return api.get<PreferenceRow[]>('/planner/preferences');
}

test.describe('the officer pattern', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(
      process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)),
      'the pattern saves through the real api',
    );
  });

  test('@api changes an 8-hour officer and keeps a 12-hour officer read-only', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const before = await preferences(request);
    const eight = before.find((row) => row.patternEditable);
    const twelve = before.find((row) => row.pattern === '4_ON_4_OFF');
    expect(eight, 'the dataset has an 8-hour officer').toBeTruthy();
    expect(twelve, 'the dataset has a 12-hour officer').toBeTruthy();

    const api = await apiAs(request, 'p.planner');
    try {
      await signIn(page, 'P. Planner');
      await navTo(page, 'Preferences');
      const picker = page.getByLabel(`Pattern for ${eight!.name}`);
      await expect(picker).toHaveValue(eight!.pattern);
      await picker.selectOption('7_ON_3_OFF');
      await expect
        .poll(
          async () =>
            (await preferences(request)).find((row) => row.employeeId === eight!.employeeId)
              ?.pattern,
        )
        .toBe('7_ON_3_OFF');

      // A 12-hour officer keeps the crew's cycle: words, no picker.
      await expect(page.getByLabel(`Pattern for ${twelve!.name}`)).toHaveCount(0);
      await expect(page.getByText('4 on, 4 off').first()).toBeVisible();

      // Reload loses the session; signing in again shows the saved pattern.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
      await signInAgain(page, 'P. Planner');
      await navTo(page, 'Preferences');
      await expect(page.getByLabel(`Pattern for ${eight!.name}`)).toHaveValue('7_ON_3_OFF');
    } finally {
      // Leave the officer's pattern as it was for the rest of the run.
      await api.put(`/planner/preferences/${eight!.employeeId}/pattern`, {
        pattern: eight!.pattern,
      });
    }
  });
});
