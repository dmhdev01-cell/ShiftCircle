import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { shot } from './shots';
import { escapeRegExp, expectAccessible, selectUnit, signIn } from './support';

/**
 * Release v1.3 S6: supervisor posts on the planning board (Dataset 100, week
 * of 16 Nov). M. Ellis has both posts in scope: the Unit picker groups them
 * after the units, a post's board shows supervisor rows with "Supervisor 1 / 1"
 * per block, and a line unit names the supervisor on duty per block.
 *
 * Read-only: nothing is saved. Dataset 100 has no supervisor-post gap, so the
 * gap-fill and R-01 checks serve the api's own SUP-L board with one block
 * marked short and an officer row added; the rule check itself is the real
 * api's (R-01 is a Block with no override).
 */

const SUP_L = 'Supervision · Living units';
const SUP_L_ID = '11111111-1111-1111-1111-000000000007';
const UNIT_A_ID = '11111111-1111-1111-1111-000000000001';
const UNIT_B_ID = '11111111-1111-1111-1111-000000000002';
const WEEK = { from: '2026-11-16', to: '2026-11-22' };
const GAP_DAY = '2026-11-20';

interface Row {
  employeeId: string;
  name: string;
  position?: string;
  qualifications: string[];
  cells: { date: string; items: unknown[] }[];
}
interface Board {
  unit: { kind?: string };
  officers: Row[];
  coverage: {
    date: string;
    block: string;
    required: number;
    covered: boolean;
    scheduled: { lowestHourly: number; shortHours: { from: string; to: string; count: number }[] };
  }[];
  supervisorsOnDuty?: { date: string; block: string; names: string[] }[];
}

async function board(page: Page): Promise<void> {
  await signIn(page, 'M. Ellis');
  await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
}

function shortName(name: string): string {
  const [first, ...rest] = name.split(' ');
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}

test.describe('v1.3 S6 supervisor posts on the board', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the supervisor posts come from the real api');
    const version = await (await request.get('/api/v1/version')).json();
    test.skip(version.activeDataset !== '100', 'the week of 16 Nov is Dataset 100');
  });

  test('@api the picker groups the posts; SUP-L shows its supervisors at 1 of 1 per block', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'm.ellis');
    const expected = await api.get<Board>(`/schedule?unitId=${SUP_L_ID}&from=${WEEK.from}&to=${WEEK.to}`);
    expect(expected.unit.kind).toBe('SUPERVISION');
    expect(expected.officers.length).toBeGreaterThan(0);
    expect(expected.officers.every((row) => row.position === 'CS')).toBe(true);

    await board(page);
    const picker = page.getByLabel('Unit').first();
    await expect(picker.locator('optgroup[label="Supervisor posts"] option')).toHaveText([
      'Supervision · Living units',
      'Supervision · Operations',
    ]);
    await expect(picker.locator('optgroup[label="Units"] option').first()).toHaveText(/^Unit A/);

    await selectUnit(page, SUP_L);
    await expect(page.getByRole('columnheader', { name: 'Supervisor', exact: true })).toBeVisible();
    await expect(page.getByText(/needs 1 supervisor$/)).toHaveCount(3);
    // Every block of the week is covered on Dataset 100: one supervisor of one.
    const covered = expected.coverage.filter((entry) => entry.covered && entry.scheduled.shortHours.length === 0);
    expect(covered).toHaveLength(21);
    // One cell per block-day, each "Supervisor n / 1" (past days show the actuals).
    await expect(page.getByText(/^Supervisor \d+ \/ 1$/)).toHaveCount(21);
    await expect(page.getByText('Supervisor 1 / 1').first()).toBeVisible();
    for (const row of expected.officers) {
      await expect(page.locator(`tr[data-officer-name="${row.name}"]`)).toBeVisible();
    }
    // Supervisors on their own post carry no badge; no Supervisor on duty line here.
    await expect(page.getByTestId('position-badge')).toHaveCount(0);
    // The post's own words: its rows are supervisors.
    await expect(page.getByText(`Showing all ${expected.officers.length} supervisors`)).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Find supervisor' })).toBeVisible();
    await expect(page.getByTestId('supervisor-on-duty')).toHaveCount(0);
    await expectAccessible(page, testInfo, 'planning-supervisor-post');
    await shot(page, testInfo, 'supervisor', 'planning', 'supervisor-post-sup-l');
  });

  test('@api Unit A names the supervisor on duty in each block', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'm.ellis');
    const expected = await api.get<Board>(`/schedule?unitId=${UNIT_A_ID}&from=${WEEK.from}&to=${WEEK.to}`);
    const onDuty = expected.supervisorsOnDuty ?? [];
    expect(onDuty).toHaveLength(21);
    // SUP-L covers every block of the week, so each one names someone.
    expect(onDuty.every((entry) => entry.names.length > 0)).toBe(true);
    // Tara Osei's seeded sick call (Tue 17 Nov nights on SUP-L) is not on duty: J. Chen covered it.
    expect(onDuty.find((entry) => entry.date === '2026-11-17' && entry.block === 'NIGHT')!.names).toEqual([
      'Jamie Chen',
    ]);

    await board(page);
    await selectUnit(page, 'Unit A · Living unit');
    const row = page.getByTestId('supervisor-on-duty');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('supervisor-on-duty-label')).toContainText('Supervisor on duty');
    for (const date of ['2026-11-17', '2026-11-19', GAP_DAY]) {
      const items = row.getByRole('list', { name: `Supervisor on duty, ${date}` }).getByRole('listitem');
      const words = ['DAY', 'EVENING', 'NIGHT'].map((block) => {
        const names = onDuty.find((entry) => entry.date === date && entry.block === block)!.names;
        return names.map(shortName).join(', ');
      });
      await expect(items).toHaveCount(3);
      for (const [index, text] of words.entries()) {
        await expect(items.nth(index)).toContainText(text);
      }
    }
    // The officers keep their board: no badge, the header still says Officer.
    await expect(page.getByRole('columnheader', { name: 'Officer', exact: true })).toBeVisible();
    await expect(page.getByTestId('position-badge')).toHaveCount(0);
    await expectAccessible(page, testInfo, 'planning-supervisor-on-duty');
    await shot(page, testInfo, 'supervisor', 'planning', 'unit-a-supervisor-on-duty');

    // Compact density: one mark per day, the names in its accessible name.
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await expect(row.getByRole('img', { name: /^Supervisor on duty\. Days: / }).first()).toBeVisible();
  });

  test('@api SUP-L gap fill lists supervisors only; an officer on the post is Blocked by R-01', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'm.ellis');
    const unitB = await api.get<Board>(`/schedule?unitId=${UNIT_B_ID}&from=${WEEK.from}&to=${WEEK.to}`);
    const officer = unitB.officers.find((row) => row.position === 'CO' && !row.qualifications.includes('ACTING_SUP'))!;
    expect(officer).toBeTruthy();

    // The api's own SUP-L board, with Fri 20 Nov days marked short and that
    // officer added as a row with nothing on it.
    let free: string[] = [];
    const isSupL = (url: URL) => url.pathname === '/api/v1/schedule' && url.searchParams.get('unitId') === SUP_L_ID;
    await page.route(isSupL, async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as Board;
      payload.coverage = payload.coverage.map((entry) =>
        entry.date === GAP_DAY && entry.block === 'DAY'
          ? {
              ...entry,
              covered: false,
              scheduled: { ...entry.scheduled, lowestHourly: 0, shortHours: [{ from: '07:00', to: '15:00', count: 0 }] },
            }
          : entry,
      );
      free = payload.officers
        .filter((row) => row.cells.find((cell) => cell.date === GAP_DAY)?.items.length === 0)
        .map((row) => row.name);
      payload.officers = [
        ...payload.officers,
        { ...officer, cells: officer.cells.map((cell) => ({ ...cell, items: [] })) },
      ];
      await route.fulfill({ response, json: payload });
    });

    await board(page);
    await selectUnit(page, SUP_L);
    await page.getByRole('button', { name: /^Fill gap: Fri days/ }).click();
    const panel = page.getByRole('region', { name: 'Fri 20 Nov · Days 07:00 – 15:00' });
    await expect(panel).toBeVisible();
    expect(free.length).toBeGreaterThan(0);
    const rows = panel.getByRole('list', { name: 'Free supervisors' }).getByRole('listitem');
    await expect(rows).toHaveCount(free.length);
    // The officer is free that day too, but is not in a supervisor post's pool.
    await expect(rows.filter({ hasText: officer.name })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: 'Find eligible supervisor → Overtime board' })).toBeVisible();
    await expectAccessible(page, testInfo, 'planning-supervisor-gap-fill');
    await shot(page, testInfo, 'supervisor', 'planning', 'supervisor-post-gap-fill');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // The officer's row reads "Officer"; their empty cell runs the real rule check.
    const officerRow = page.locator(`tr[data-officer-name="${officer.name}"]`);
    await expect(officerRow.getByTestId('position-badge')).toHaveText(/^Officer/);
    await page.getByRole('button', { name: `Off - assign a shift to ${officer.name} on ${GAP_DAY}` }).click();
    const dialog = page.getByRole('dialog', { name: `Assign a shift to ${officer.name} (officer)` });
    await dialog.getByRole('button', { name: /^D8 · / }).click();
    const dock = page.getByRole('region', { name: 'Rule check' });
    await expect(dock.getByRole('heading', { name: new RegExp(`^Assign ${officer.name} \\(officer\\)`) })).toBeVisible();
    await expect(dock.getByText(/^R-01/).first()).toBeVisible();
    await expect(dock.getByRole('status').filter({ hasText: /^Blocked/ })).toBeVisible();
    await expect(dock.getByRole('button', { name: /^Assign shift$/ })).toHaveCount(0);
    await expect(dock.getByRole('button', { name: /^Acknowledge/ })).toHaveCount(0);
    await expect(dock.getByRole('button', { name: 'Emergency override…' })).toHaveCount(0);
    await expect(dock.getByRole('link', { name: 'Find eligible supervisor' })).toBeVisible();
    await expectAccessible(page, testInfo, 'planning-supervisor-r01');
    await shot(page, testInfo, 'supervisor', 'planning', 'supervisor-post-r01-blocked');
    await dock.getByRole('button', { name: 'Close' }).click();
  });

  test('@api M. Ellis\'s own row on SUP-L offers no change and says why up front', async ({ page, request }, testInfo) => {
    const api = await apiAs(request, 'm.ellis');
    const me = await api.get<{ employee: { name: string } }>('/me/schedule');
    expect(me.employee.name).toBe('Morgan Ellis');
    const expected = await api.get<Board>(`/schedule?unitId=${SUP_L_ID}&from=${WEEK.from}&to=${WEEK.to}`);
    const mine = expected.officers.find((row) => row.name === 'Morgan Ellis')!;
    expect(mine).toBeTruthy();
    // A day still to come with nothing on it: on anyone else's row that is an "Off" button to assign.
    const offDay = mine.cells.find((cell) => cell.date >= '2026-11-19' && cell.items.length === 0)?.date;
    expect(offDay, 'Morgan Ellis has a free day from 19 Nov in the week of 16 Nov').toBeTruthy();
    const other = expected.officers.find(
      (row) => row.name !== 'Morgan Ellis' && row.cells.some((cell) => cell.date >= '2026-11-19' && cell.items.length === 0),
    )!;
    expect(other).toBeTruthy();
    const otherOff = other.cells.find((cell) => cell.date >= '2026-11-19' && cell.items.length === 0)!.date;

    await board(page);
    await selectUnit(page, SUP_L);
    const reason = "This is you. You can't change your own schedule; ask another supervisor.";
    const row = page.locator('tr[data-officer-name="Morgan Ellis"]');
    await expect(row).toHaveAttribute('data-self', 'true');
    await expect(row.getByTestId('self-row-reason')).toHaveText(reason);
    await expect(page.getByTestId('self-row-reason')).toHaveCount(1);
    // Nothing on the row can be picked: the free day is a disabled "Off", the shifts are not buttons.
    const off = row.getByRole('button', { name: `Off - assign a shift to Morgan Ellis on ${offDay}` });
    await expect(off).toBeDisabled();
    await expect(off).toHaveAttribute('title', reason);
    const buttons = row.getByRole('button');
    for (let index = 0; index < (await buttons.count()); index += 1) {
      await expect(buttons.nth(index)).toBeDisabled();
    }
    await expect(page.getByRole('region', { name: 'Rule check' })).toHaveCount(0);
    // Another supervisor's free day still opens the assign dialog.
    await expect(page.locator(`tr[data-officer-name="${other.name}"]`).getByTestId('self-row-reason')).toHaveCount(0);
    await page.getByRole('button', { name: `Off - assign a shift to ${other.name} on ${otherOff}` }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`^Assign a shift to ${escapeRegExp(other.name)}`) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expectAccessible(page, testInfo, 'planning-supervisor-own-row');
    await shot(page, testInfo, 'supervisor', 'planning', 'supervisor-post-own-row');
  });

  test('@api a supervisor post and a line unit board hold at phone width without a sideways page scroll', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await board(page);
    await selectUnit(page, SUP_L);
    await expect(page.getByRole('columnheader', { name: 'Supervisor', exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, testInfo, 'supervisor', 'planning', 'supervisor-post-390');

    // A line unit with the Supervisor on duty line holds too (its hidden labels stay in the scroll box).
    await selectUnit(page, 'Unit A · Living unit');
    await expect(page.getByTestId('supervisor-on-duty')).toBeVisible();
    const lineOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(lineOverflow).toBeLessThanOrEqual(0);
  });
});
