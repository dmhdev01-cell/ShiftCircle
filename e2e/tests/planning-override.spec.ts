import { expect, test } from '@playwright/test';

import { apiAs, findCase, isFixtures } from './api';
import type { RuleResult, Unit } from './api';
import { expectAccessible, selectUnit, signIn } from './support';

/**
 * The planning board's two ways past a rule check (docs/07 §3, ADR-023):
 * an EMERGENCY-only Block is saved with a written reason of at least 10
 * characters, and a Warn-only change is saved once the warnings are
 * acknowledged. Cases are found through the api's rule-check preview, which
 * saves nothing, so the spec does not depend on names.
 *
 * Data: Unit A, Fri 20 and Sat 21 Nov (the board shows the demo week only).
 * Nia Thompson (E1, Unit B) and the Sunday shifts (move/cancel) are left
 * alone. That week sits in the 9 - 22 Nov pay period, which E4 locks; a
 * locked period refuses every save, so the spec opens it first, as
 * move-cancel does.
 */

const DATES = ['2026-11-20', '2026-11-21'];
/** Where to look for a case: Fri to Sun of the demo week. */
const SEARCH_DATES = [...DATES, '2026-11-22'];
const TEMPLATES = ['D8', 'E8', 'N8'];
const TEMPLATE_BUTTON: Record<string, RegExp> = {
  D8: /^D8 · /,
  E8: /^E8 · /,
  N8: /^N8 · /,
};

const emergencyOnly = (results: RuleResult[]) => {
  const blocks = results.filter((result) => result.outcome === 'BLOCK');
  return blocks.length > 0 && blocks.every((result) => result.overridePolicy === 'EMERGENCY');
};
const warnOnly = (results: RuleResult[]) =>
  results.length > 0 && results.every((result) => result.outcome === 'WARN');

test.describe('planning board: override and acknowledgement', () => {
  test('@api an emergency-only Block saves with a reason; a warning saves once acknowledged', async ({ page, request }, testInfo) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'saving needs the real api');

    const api = await apiAs(request, 'm.ellis');
    const units = await api.get<Unit[]>('/units');

    const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
    const period = periods.find((entry) => entry.from <= DATES[0] && entry.to >= DATES[1]);
    if (period?.status === 'LOCKED') {
      const unlocked = await api.post(`/pay-periods/${period.id}/unlock`, {
        reason: 'Override spec: assignments in the demo week',
      });
      expect(unlocked.status).toBe(200);
    }

    // One unit holds both cases, so the board shows both without switching.
    let unitA: Unit | undefined;
    let block: Awaited<ReturnType<typeof findCase>> = null;
    let warning: Awaited<ReturnType<typeof findCase>> = null;
    for (const code of ['A', 'B']) {
      unitA = units.find((unit) => unit.code === code)!;
      block = await findCase(api, unitA, SEARCH_DATES, TEMPLATES, emergencyOnly, ['Nia Thompson']);
      if (!block) continue;
      warning = await findCase(api, unitA, SEARCH_DATES, TEMPLATES, warnOnly, ['Nia Thompson', block.officer.name]);
      if (warning) break;
    }
    expect(block, 'an empty cell whose shift is blocked only by emergency-policy rules').toBeTruthy();
    expect(warning, 'an empty cell in the same unit whose shift only warns').toBeTruthy();

    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await selectUnit(page, unitA!.name);

    // 1. The emergency override.
    const blockCell = page.getByRole('button', {
      name: `Off - assign a shift to ${block!.officer.name} on ${block!.date}`,
    });
    await blockCell.click();
    await page.getByRole('button', { name: TEMPLATE_BUTTON[block!.template] }).click();
    const panel = page.getByRole('region', { name: 'Rule check' });
    await expect(panel.getByText(/Blocked: \d+ rules? fails?/)).toBeVisible();
    for (const result of block!.results.filter((entry) => entry.outcome === 'BLOCK')) {
      await expect(panel.getByText(new RegExp(`^${result.ruleCode}`)).first()).toBeVisible();
    }
    // No plain save past a Block; the override is the only way and says so.
    await expect(panel.getByRole('button', { name: 'Assign shift' })).toHaveCount(0);
    await expect(panel.getByText('An override needs a written reason. It is saved to the audit log and flagged in reports.')).toBeVisible();
    await panel.getByRole('button', { name: 'Emergency override…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Emergency override' });
    await expect(dialog).toBeVisible();
    const reason = dialog.getByLabel('Why is this override needed?');
    const confirm = dialog.getByRole('button', { name: 'Emergency override' });
    await expect(reason).toBeFocused();
    await expect(confirm).toBeDisabled();
    await reason.fill('too short');
    await expect(confirm).toBeDisabled();
    await reason.fill('          ');
    await expect(confirm).toBeDisabled();
    await expect(dialog).toContainText('At least 10 characters.');
    await expectAccessible(page, testInfo, 'override-dialog');
    await reason.fill('Override spec: relief officer stranded by the storm');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden();
    await expect(panel.getByRole('button', { name: 'Done' })).toBeVisible();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expectSaved(api, unitA!, block!.officer.name, block!.date, block!.template);

    // 2. The warning acknowledgement.
    await page
      .getByRole('button', { name: `Off - assign a shift to ${warning!.officer.name} on ${warning!.date}` })
      .click();
    await page.getByRole('button', { name: TEMPLATE_BUTTON[warning!.template] }).click();
    await expect(panel.getByText(/warning/i).first()).toBeVisible();
    // A warning is never overridden and never saved silently: one yellow button.
    await expect(panel.getByRole('button', { name: 'Emergency override…' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Assign shift' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'warning-acknowledgement');
    await panel.getByRole('button', { name: 'Acknowledge and assign' }).click();
    await expect(panel.getByRole('button', { name: 'Done' })).toBeVisible();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expectSaved(api, unitA!, warning!.officer.name, warning!.date, warning!.template);

    // Both shifts are on the board once it is read again (see D9 below for
    // the board not refreshing on its own).
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overtime' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Planning board' }).click();
    await selectUnit(page, unitA!.name);
    for (const saved of [block!, warning!]) {
      await expect(
        page.getByRole('button', { name: `Off - assign a shift to ${saved.officer.name} on ${saved.date}` }),
      ).toHaveCount(0);
    }
  });

  test('@api the board shows a saved shift without leaving the screen', async ({ page, request }) => {
    // DEFECT D9 (found by this spec): after Assign, Acknowledge and assign or
    // an emergency override, PlanningPage never reloads the schedule (reload()
    // is wired only to publish and to the move/cancel dialog,
    // PlanningPage.tsx:330 and :519), so the saved cell still reads "Off" until
    // the person leaves the screen. Remove test.fail when fixed.
    await page.goto('/login');
    test.skip(await isFixtures(page), 'saving needs the real api');
    const api = await apiAs(request, 'm.ellis');
    const units = await api.get<Unit[]>('/units');
    const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
    const period = periods.find((entry) => entry.from <= DATES[0] && entry.to >= DATES[1]);
    if (period?.status === 'LOCKED') {
      await api.post(`/pay-periods/${period.id}/unlock`, { reason: 'Board refresh spec: a demo-week assignment' });
    }
    const savable = (results: RuleResult[]) => results.every((result) => result.outcome !== 'BLOCK');
    let unit: Unit | undefined;
    let pass: Awaited<ReturnType<typeof findCase>> = null;
    for (const code of ['B', 'A']) {
      unit = units.find((entry) => entry.code === code)!;
      pass = await findCase(api, unit, [...DATES, '2026-11-22'], TEMPLATES, savable, ['Nia Thompson', 'Tara Nakamura']);
      if (pass) break;
    }
    expect(pass, 'an empty cell in Unit A or B that a shift can be saved into').toBeTruthy();

    await signIn(page, 'M. Ellis');
    await selectUnit(page, unit!.name);
    const cell = page.getByRole('button', { name: `Off - assign a shift to ${pass!.officer.name} on ${pass!.date}` });
    await cell.click();
    await page.getByRole('button', { name: TEMPLATE_BUTTON[pass!.template] }).click();
    const panel = page.getByRole('region', { name: 'Rule check' });
    const save = panel.getByRole('button', { name: /^(Assign shift|Acknowledge and assign)$/ });
    await save.click();
    await panel.getByRole('button', { name: 'Done' }).click();
    await expectSaved(api, unit!, pass!.officer.name, pass!.date, pass!.template);

    // D9 was here: the board kept the saved cell as "Off" until the person left
    // the screen. It now reads the board again after the save.
    await expect(cell).toHaveCount(0, { timeout: 5_000 });
  });
});

/** The api has the shift: the save really happened, whatever the board shows. */
async function expectSaved(
  api: Awaited<ReturnType<typeof apiAs>>,
  unit: Unit,
  officerName: string,
  date: string,
  template: string,
): Promise<void> {
  const schedule = await api.get<{
    officers: { name: string; cells: { date: string; items: { type: string; shiftTemplate?: string }[] }[] }[];
  }>(`/schedule?unitId=${unit.id}&from=2026-11-16&to=2026-11-22`);
  const officer = schedule.officers.find((entry) => entry.name === officerName);
  const items = officer?.cells.find((cell) => cell.date === date)?.items ?? [];
  expect(
    items.some((item) => item.type === 'SHIFT' && item.shiftTemplate === template),
    `${officerName} has ${template} on ${date} in the api`,
  ).toBe(true);
}
