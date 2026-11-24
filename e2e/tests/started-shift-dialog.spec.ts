import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { navTo, selectUnit, signIn } from './support';

/**
 * PR-O (v1.2): the rostered shift dialog says up front when the api would
 * refuse. A shift that has started (start <= the business clock's now, noon on
 * Thu 19 Nov in the demo) offers no move or cancel; it says so in plain words
 * and links to Time & attendance on that shift. A future shift still moves.
 * The shifts are chosen from the api's own board so the spec does not depend
 * on a name or a slot.
 */

const CHIP: Record<string, string> = { D8: 'D', E8: 'E', N8: 'N' };
const ZONE = 'America/Regina';

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

interface Board {
  now?: string;
  asOf: string;
  officers: Officer[];
}

function shiftsOn(officer: Officer, date: string): Shift[] {
  const cell = officer.cells.find((entry) => entry.date === date);
  return (cell?.items ?? []).filter((item): item is Shift => item.type === 'SHIFT');
}

/** "Tue 17 Nov at 23:00", the words the dialog uses, on the centre's clock. */
function startedWords(startAt: string): string {
  const at = new Date(startAt);
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: ZONE }).format(at);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: ZONE }).format(at);
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: ZONE }).format(at);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: ZONE,
  }).format(at);
  return `${weekday} ${day} ${month} at ${time}`;
}

async function unitABoard(request: APIRequestContext, from = '2026-11-16', to = '2026-11-22') {
  const login = await request.post('/api/v1/auth/mock-login', { data: { userId: 'm.ellis' } });
  const token = (await login.json()).token as string;
  const headers = { Authorization: `Bearer ${token}` };
  const units = await (await request.get('/api/v1/units', { headers })).json();
  const unit = units.find((entry: { code: string }) => entry.code === 'A');
  expect(unit).toBeTruthy();
  const board = (await (
    await request.get(`/api/v1/schedule?unitId=${unit.id}&from=${from}&to=${to}`, {
      headers,
    })
  ).json()) as Board;
  return { unit: unit as { id: string; name: string }, board, headers };
}

test.describe('the shift dialog on a started shift', () => {
  test('@api a started shift offers no move or cancel and links to Time & attendance', async ({
    page,
  }) => {
    await page.goto('/login');
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'the started test reads the business clock from the real api',
    );

    const { unit, board } = await unitABoard(page.request);
    // The api sends the business clock's instant with the board (PR-O).
    expect(board.now).toBe('2026-11-19T18:00:00Z');

    // The owner's case: a night shift on Tue 17 Nov, two days before the demo day.
    let chosen: { officer: Officer; shift: Shift; date: string } | null = null;
    for (const date of ['2026-11-17', '2026-11-18', '2026-11-16']) {
      for (const officer of board.officers) {
        const shifts = shiftsOn(officer, date);
        if (shifts.length !== 1) continue;
        const [shift] = shifts;
        if (!CHIP[shift.shiftTemplate] || shift.offer || shift.proposed) continue;
        if (new Date(shift.startAt).getTime() > new Date(board.now!).getTime()) continue;
        chosen = { officer, shift, date };
        break;
      }
      if (chosen) break;
    }
    expect(chosen, 'a started shift on Unit A').toBeTruthy();
    const { officer, shift, date } = chosen!;

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');
    await selectUnit(page, unit.name);

    await page
      .getByRole('button', { name: `${CHIP[shift.shiftTemplate]} for ${officer.name} on ${date}` })
      .click();
    const dialog = page.getByRole('dialog', { name: new RegExp(officer.name) });
    const notice = dialog.getByRole('note', { name: 'This shift has started' });
    await expect(notice).toContainText(
      `This shift started on ${startedWords(shift.startAt)}. Worked shifts are corrected in Time & attendance.`,
    );
    // Readable, not ISO: "Scheduled Tue 17 Nov 2026, 23:00 – 07:00 next day".
    await expect(dialog.getByText(/^Scheduled [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} 2026, \d{2}:\d{2} – /)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Move…' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Cancel shift…' })).toHaveCount(0);

    await notice.getByRole('link', { name: 'Open in Time & attendance' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/time\\?date=${date}&unit=${unit.id}&shift=${shift.assignmentId}$`),
    );
    await expect(page.getByRole('heading', { name: 'Time & attendance' })).toBeVisible();
    // The shift's own record panel is open, on the officer from the board.
    await expect(page.getByRole('heading', { name: /Record actual/ })).toBeVisible();
    await expect(page.getByLabel('Unit')).toHaveValue(unit.id);
  });

  test('@api a future shift still moves, and a start that has passed is refused before submit', async ({
    page,
  }) => {
    await page.goto('/login');
    test.skip(
      (await page.getByText('Demo fixtures').count()) > 0,
      'the move writes state and needs the real api',
    );

    // The week after the demo week: the parallel specs that write (move-cancel,
    // planning-override, E1, gap fill) all work in the demo week.
    const { unit, board, headers } = await unitABoard(page.request, '2026-11-23', '2026-11-29');

    // Open the period if a run has locked it, as move-cancel.spec.ts does, so
    // the move is not refused for that reason.
    const periods = await (await page.request.get('/api/v1/pay-periods', { headers })).json();
    const period = periods.find(
      (entry: { from: string; to: string }) =>
        entry.from <= '2026-11-25' && entry.to >= '2026-11-25',
    );
    if (period?.status === 'LOCKED') {
      const unlocked = await page.request.post(`/api/v1/pay-periods/${period.id}/unlock`, {
        headers,
        data: { reason: 'Started-shift spec: shift maintenance' },
      });
      expect(unlocked.status()).toBe(200);
    }

    // Wednesday 25 Nov: one unworked D8 or E8, swapped for the other on the
    // same date, so the hours stay the same.
    let chosen: { officer: Officer; shift: Shift; template: string } | null = null;
    for (const officer of board.officers) {
      const shifts = shiftsOn(officer, '2026-11-25');
      if (shifts.length !== 1) continue;
      const [shift] = shifts;
      if (shift.worked || shift.offer || shift.proposed) continue;
      if (shift.shiftTemplate !== 'D8' && shift.shiftTemplate !== 'E8') continue;
      chosen = { officer, shift, template: shift.shiftTemplate === 'D8' ? 'E8' : 'D8' };
      break;
    }
    expect(chosen, 'a safe Wednesday shift to move').toBeTruthy();
    const { officer, shift, template } = chosen!;

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Planning board');
    await selectUnit(page, unit.name);
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('23 – 29 Nov 2026');

    const chip = CHIP[shift.shiftTemplate];
    await page.getByRole('button', { name: `${chip} for ${officer.name} on 2026-11-25` }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(officer.name) });
    await expect(dialog.getByRole('note')).toHaveCount(0);
    await expect(dialog.getByText(/^Scheduled Wed 25 Nov 2026, /)).toBeVisible();
    await dialog.getByRole('button', { name: 'Move…' }).click();

    // A start that has already passed is refused before anything is sent.
    await dialog.getByLabel('New date').fill('2026-11-18');
    await expect(
      dialog.getByText(/^Wed 18 Nov 2026 at \d{2}:\d{2} has already started \(it is now Thu 19 Nov 2026, 12:00\)\./),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Move shift' })).toBeDisabled();

    await dialog.getByLabel('New date').fill('2026-11-25');
    await dialog.getByLabel('Shift', { exact: true }).selectOption(template);
    await expect(dialog.getByText(/^The moved shift starts Wed 25 Nov 2026 at /)).toBeVisible();
    await dialog.getByRole('button', { name: 'Move shift' }).click();

    const moved = page.getByRole('button', {
      name: `${CHIP[template]} for ${officer.name} on 2026-11-25`,
    });
    const override = dialog.getByRole('button', { name: 'Emergency override…' });
    const acknowledge = dialog.getByRole('button', { name: 'Acknowledge warnings and move' });
    const answer = await Promise.race([
      override.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'override' as const),
      acknowledge.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'acknowledge' as const),
      moved.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'moved' as const),
    ]).catch(() => 'timeout' as const);
    if (answer === 'override') {
      await override.click();
      await page.getByLabel('Why is this override needed?').fill('Started spec: relief coverage');
      await page.getByRole('button', { name: 'Emergency override' }).click();
    } else if (answer === 'acknowledge') {
      await acknowledge.click();
    }

    await expect(moved).toBeVisible();
  });
});
