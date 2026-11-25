import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { expectAccessible, selectUnit, signIn } from './support';

/**
 * M3 from the functional gap analysis: a link led to something the prototype
 * does not have, and now says so plainly instead of quietly showing another
 * open shift's ranked list. (M1, the Propose card that could not send, is
 * built in v1.3 P3: proposals-officer.spec.ts covers it.)
 */

test.describe('not-built states say so', () => {
  test('@api M3: Find eligible officer on a slot with no open shift says so', async ({
    page,
    request,
  }, testInfo) => {
    await signIn(page, 'M. Ellis');
    test.skip(await isFixtures(page), 'the real open shifts decide the slot');

    // Precondition: Unit B has no open shift on Sat 21 Nov at 15:00.
    const api = await apiAs(request, 'm.ellis');
    const units = await api.get<{ id: string; name: string }[]>('/units');
    const unitB = units.find((unit) => unit.name === 'Unit B · Living unit');
    expect(unitB, 'Unit B is in M. Ellis’s scope').toBeTruthy();
    const slot = new Date('2026-11-21T15:00:00-06:00').getTime();
    const open = await api.get<{ unit: { id: string }; startAt: string }[]>(
      `/open-shifts?unitId=${unitB!.id}`,
    );
    expect(
      open.filter((shift) => new Date(shift.startAt).getTime() === slot),
      'no open shift for Unit B Sat 21 Nov 15:00',
    ).toEqual([]);

    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await selectUnit(page, 'Unit B · Living unit');
    // Nia Thompson works Fri 12:00–24:00; an evening on Saturday takes her
    // week over the 60 h ceiling, so the rules block it.
    await page.getByRole('button', { name: 'Off - assign a shift to Nia Thompson on 2026-11-21' }).click();
    await page.getByRole('button', { name: /E8 · Evening 8 h/ }).click();
    await expect(page.getByText(/Blocked: \d+ rules? fails?/)).toBeVisible();

    await page.getByRole('link', { name: 'Find eligible officer' }).click();
    await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Eligible officers' });
    await expect(
      panel.getByRole('heading', { name: 'No open shift for this slot yet', level: 2 }),
    ).toBeVisible();
    await expect(panel.getByText('Unit B · Living unit · Sat 21 Nov 15:00')).toBeVisible();
    // No other shift's list is passed off as the answer.
    await expect(panel.getByRole('checkbox')).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: /Fri 20 Nov|Sat 21 Nov · Days/ })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'overtime-no-open-shift');

    // The next step returns to the slot's week on the planning board.
    await panel.getByRole('link', { name: 'Back to the planning board' }).click();
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/planning\?unit=.+&week=2026-11-21/);
    await expect(
      page.getByRole('button', { name: 'Off - assign a shift to Nia Thompson on 2026-11-21' }),
    ).toBeVisible();
  });
});
