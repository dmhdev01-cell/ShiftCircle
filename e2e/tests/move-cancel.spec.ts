import { expect, test } from '@playwright/test';

import { navTo, selectUnit, signIn } from './support';

/**
 * Move and cancel a rostered shift through the real contract (docs/07 §4.2):
 * PATCH/DELETE with If-Match, a cancel reason of at least 10 characters, and
 * the board reloading from the api. The shift is chosen from the api's own
 * schedule so the test does not depend on a name or a slot.
 */

const CHIP: Record<string, string> = {
  D8: 'D',
  E8: 'E',
  N8: 'N',
  A12: 'A12',
  P12: 'P12',
  L16: 'L16',
};

interface Shift {
  type: 'SHIFT';
  assignmentId: string;
  shiftTemplate: string;
  startAt: string;
  worked: boolean;
  offer?: boolean;
  proposed?: boolean;
  version: number;
}

interface Officer {
  employeeId: string;
  name: string;
  cells: { date: string; items: { type: string }[] }[];
}

test.describe('move and cancel a rostered shift', () => {
  test('@api moves it one day and cancels it with a reason', async ({ page }) => {
    await page.goto('/login');
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'move/cancel writes state and needs the real api',
    );

    const login = await page.request.post('/api/v1/auth/mock-login', {
      data: { userId: 'm.ellis' },
    });
    const token = (await login.json()).token as string;
    const headers = { Authorization: `Bearer ${token}` };
    const units = await (await page.request.get('/api/v1/units', { headers })).json();
    const unit = units.find((entry: { code: string }) => entry.code === 'A');
    expect(unit).toBeTruthy();

    // E4 may have locked the 9-22 Nov period earlier in the run. Moving or
    // cancelling a shift must be refused then (409), so the spec opens the
    // period first rather than depending on file order.
    const periods = await (await page.request.get('/api/v1/pay-periods', { headers })).json();
    const period = periods.find(
      (entry: { from: string; to: string }) =>
        entry.from <= '2026-11-22' && entry.to >= '2026-11-22',
    );
    if (period?.status === 'LOCKED') {
      const unlocked = await page.request.post(
        `/api/v1/pay-periods/${period.id}/unlock`,
        { headers, data: { reason: 'Move/cancel spec: shift maintenance' } },
      );
      expect(unlocked.status()).toBe(200);
    }

    const schedule = await (
      await page.request.get(
        `/api/v1/schedule?unitId=${unit.id}&from=2026-11-16&to=2026-11-22`,
        { headers },
      )
    ).json();

    // An officer with one unworked Sunday day/evening shift: swapping D8 and
    // E8 on the same date keeps the hours and cannot meet a rest block.
    let chosen: { officer: Officer; shift: Shift; template: string } | null = null;
    for (const officer of schedule.officers as Officer[]) {
      const sunday = officer.cells.find((cell) => cell.date === '2026-11-22');
      const shifts = (sunday?.items ?? []).filter(
        (item): item is Shift => item.type === 'SHIFT',
      );
      if (shifts.length !== 1) continue;
      const [shift] = shifts;
      if (shift.worked || shift.offer || shift.proposed) continue;
      if (shift.shiftTemplate !== 'D8' && shift.shiftTemplate !== 'E8') continue;
      chosen = {
        officer,
        shift,
        template: shift.shiftTemplate === 'D8' ? 'E8' : 'D8',
      };
      break;
    }
    expect(chosen, 'a safe Sunday shift to move').toBeTruthy();
    const { officer, shift, template } = chosen!;
    const chip = CHIP[shift.shiftTemplate] ?? shift.shiftTemplate;
    const targetChip = CHIP[template] ?? template;

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');
    await selectUnit(page, unit.name);

    await page.getByRole('button', { name: `${chip} for ${officer.name} on 2026-11-22` }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(officer.name) });
    await dialog.getByRole('button', { name: 'Move…' }).click();
    await dialog.getByLabel('Shift', { exact: true }).selectOption(template);
    await dialog.getByRole('button', { name: 'Move shift' }).click();

    const moved = page.getByRole('button', {
      name: `${targetChip} for ${officer.name} on 2026-11-22`,
    });
    // A warning-only or emergency block is part of the same contract; wait for
    // whichever answer comes back, then act the way a supervisor would.
    const override = dialog.getByRole('button', { name: 'Emergency override…' });
    const acknowledge = dialog.getByRole('button', { name: 'Acknowledge warnings and move' });
    const answer = await Promise.race([
      override.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'override' as const),
      acknowledge.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'acknowledge' as const),
      moved.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'moved' as const),
    ]).catch(() => 'timeout' as const);

    if (answer === 'override') {
      await override.click();
      await page.getByLabel('Why is this override needed?').fill('Move spec: relief coverage');
      await page.getByRole('button', { name: 'Emergency override' }).click();
    } else if (answer === 'acknowledge') {
      await acknowledge.click();
    }

    await expect(moved).toBeVisible();
    await expect(
      page.getByRole('button', { name: `${chip} for ${officer.name} on 2026-11-22` }),
    ).toHaveCount(0);

    await moved.click();
    const movedDialog = page.getByRole('dialog', { name: new RegExp(officer.name) });
    await movedDialog.getByRole('button', { name: 'Cancel shift…' }).click();
    await movedDialog
      .getByLabel('Why is this shift cancelled?')
      .fill('Move/cancel spec: shift no longer needed');
    await movedDialog.getByRole('button', { name: 'Cancel shift' }).click();

    await expect(moved).toHaveCount(0);
  });
});
