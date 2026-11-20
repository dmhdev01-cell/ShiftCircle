import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { expectAccessible, navTo, signIn, signInAgain, signOut } from './support';

/**
 * Overtime beyond E2's accept-and-confirm: an employee declines an offer, and a
 * filled shift offers no way to offer, assign or confirm (one need, one
 * officer: the api refuses a second fill since review-r3's F8 fix, and the
 * screen must not invite it).
 *
 * Data: an open shift after the demo day where Tara Nakamura is eligible,
 * other than E2's Sat 21 Nov Unit B day shift.
 */

interface OpenShift {
  id: string;
  date: string;
  unit: { id: string; name: string };
  status: string;
}
interface Candidates {
  candidates: { employeeId: string; name: string; eligibility: string }[];
  history: { status: string; employeeName: string }[];
}

/** "Thu 26 Nov", as the open-shift cards and the offer cards write a day. */
function shortDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  return `${weekday} ${parsed.getUTCDate()} ${month}`.replace('.', '');
}

async function openCard(page: Page, shift: OpenShift): Promise<void> {
  // The card for that day and unit with the same status (a day can also have
  // a filled card for the same unit).
  const card = page
    .getByRole('region', { name: 'Open shifts' })
    .getByRole('button')
    .filter({ hasText: shortDay(shift.date) })
    .filter({ hasText: shift.unit.name })
    .filter({ hasText: shift.status === 'FILLED' ? 'Filled' : /Open|Offers sent/ });
  await expect(card.first()).toBeVisible();
  await card.first().click();
  await expect(card.first()).toHaveAttribute('aria-pressed', 'true');
}

test.describe('overtime: decline, and filled shifts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'these flows need the real api');
  });

  test('@api an employee declines an offer and the supervisor sees it', async ({ page, request }, testInfo) => {
    // The demo data's only open shift Tara can take is E2's (Sat 21 Nov, Unit
    // B), so this spec creates its own: an evening in Unit B after the demo
    // week where the rule preview gives Tara no Block.
    const api = await apiAs(request, 'm.ellis');
    const units = await api.get<{ id: string; code: string; name: string }[]>('/units');
    const unitB = units.find((unit) => unit.code === 'B')!;
    const employees = await api.get<{ id: string; first_name: string; last_name: string }[]>('/employees');
    const tara = employees.find((employee) => employee.first_name === 'Tara' && employee.last_name === 'Nakamura')!;
    expect(tara, 'Tara Nakamura in M. Ellis scope').toBeTruthy();

    let startAt = '';
    let template = '';
    const starts: Record<string, string> = { D8: '07:00', E8: '15:00', N8: '23:00' };
    search: for (let day = 23; day <= 30; day += 1) {
      for (const code of ['D8', 'E8', 'N8']) {
        const candidate = `2026-11-${day}T${starts[code]}:00-06:00`;
        const preview = await api.post('/rule-checks', {
          change: { type: 'EXTRA', employeeId: tara.id, unitId: unitB.id, shiftTemplate: code, startAt: candidate },
        });
        const results = (preview.body as { ruleResults?: { outcome: string }[] }).ruleResults ?? [];
        if (preview.status === 200 && !results.some((result) => result.outcome === 'BLOCK')) {
          startAt = candidate;
          template = code;
          break search;
        }
      }
    }
    expect(startAt, 'a shift after the demo week where Tara has no Block').not.toBe('');
    const created = await api.post('/open-shifts', {
      unitId: unitB.id,
      shiftTemplate: template,
      startAt: new Date(startAt).toISOString(),
      reason: 'EXTRA_COVERAGE',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const target = created.body as OpenShift;

    await signIn(page, 'M. Ellis');
    await navTo(page, 'Overtime');
    await expect(page.getByRole('heading', { name: 'Overtime board', level: 1 })).toBeVisible();
    await openCard(page, target!);
    await page.getByRole('checkbox', { name: 'Select Tara Nakamura for this shift' }).check();
    await page.getByRole('button', { name: 'Offer to selected (1)' }).click();
    await expect(page.getByText(/1 offer recorded/)).toBeVisible();
    await signOut(page, 'M. Ellis');

    await signInAgain(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    const offer = page
      .getByRole('region', { name: 'Overtime offer' })
      .filter({ hasText: shortDay(target!.date) })
      .filter({ hasText: target!.unit.name });
    await expect(offer).toHaveCount(1);
    await offer.getByRole('button', { name: 'Decline' }).click();
    await expect(offer.getByText('Declined. Thank you - your supervisor has been told.')).toBeVisible();
    await expect(offer.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'my-schedule-declined');
    await signOut(page, 'T. Nakamura');

    await signInAgain(page, 'M. Ellis');
    await navTo(page, 'Overtime');
    await openCard(page, target!);
    const declined = page.getByRole('group', { name: 'Tara Nakamura · Declined' });
    await expect(declined).toBeVisible();
    await expect(declined.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  });

  test('@api a filled shift offers nothing to select, offer or assign', async ({ page, request }) => {
    const filled = await filledWithAcceptedOffer(request);
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Overtime');
    await openCard(page, filled);
    const officers = page.getByRole('region', { name: 'Eligible officers' });
    await expect(officers.getByText('This shift is filled. No offers can be made.')).toBeVisible();
    await expect(officers.getByRole('checkbox')).toHaveCount(0);
    await expect(officers.getByRole('button', { name: /Offer to selected/ })).toHaveCount(0);
    await expect(officers.getByRole('button', { name: 'Assign directly…' })).toHaveCount(0);
  });

  test('@api a filled shift offers no Confirm on a leftover accepted offer', async ({ page, request }) => {
    // D5 was here: OvertimePage.tsx showed Confirm for an ACCEPTED offer even
    // when the shift was filled; the api refuses it (409, F8), but the screen
    // invited a second fill.
    const filled = await filledWithAcceptedOffer(request);
    await signIn(page, 'M. Ellis');
    await navTo(page, 'Overtime');
    await openCard(page, filled);
    const officers = page.getByRole('region', { name: 'Eligible officers' });
    await expect(officers.getByText('This shift is filled. No offers can be made.')).toBeVisible();
    await expect(officers.getByRole('button', { name: 'Confirm' })).toHaveCount(0, { timeout: 3_000 });
  });
});

/**
 * A filled shift whose history still has an accepted (never confirmed) offer:
 * the case where a Confirm button would try a second fill.
 */
async function filledWithAcceptedOffer(
  request: import('@playwright/test').APIRequestContext,
): Promise<OpenShift> {
  const api = await apiAs(request, 'm.ellis');
  const shifts = await api.get<OpenShift[]>('/open-shifts');
  for (const shift of shifts.filter((entry) => entry.status === 'FILLED')) {
    const payload = await api.get<Candidates>(`/open-shifts/${shift.id}/candidates`);
    if (payload.history.some((entry) => entry.status === 'ACCEPTED')) return shift;
  }
  throw new Error('No filled shift with an accepted offer in its history (check the demo data)');
}
