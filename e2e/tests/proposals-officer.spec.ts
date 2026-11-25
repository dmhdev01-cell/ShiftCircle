import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { apiAs } from './api';
import { expectAccessible, signIn } from './support';
import { shot } from './shots';

/**
 * v1.3 P3: the officer's side of shift proposals on My schedule
 * (plan v1.2-proposals §3.1 and §7, acceptance for P3).
 *
 * Tara drafts two shifts; together they break the weekly ceiling, so the
 * second is Blocked and Send is off with the reason. She removes it, sends the
 * other with a note and sees it Waiting under My proposals, then sends a second
 * proposal and withdraws it. Tara's free days after the demo day give Warnings
 * at best (sendable); a day shift on Fri 4 Dec follows her 12 h Thursday with
 * 7 h of rest, so U-01 blocks it (the 390 px check). No shift is created:
 * deciding is P4's screen.
 */

interface MyProposal {
  id: string;
  version: number;
  canWithdraw: boolean;
}

/**
 * Withdraw whatever Tara still has waiting: before the spec, so a re-run on the
 * same stack starts clean, and after it, so no Waiting proposal is left for the
 * inbox specs. Withdrawn proposals stay in her history, so the assertions below
 * find this run's proposals by a token in their note, never by the day alone.
 */
async function withdrawTarasWaiting(request: APIRequestContext): Promise<void> {
  const api = await apiAs(request, 't.nakamura');
  const mine = await api.get<MyProposal[]>('/me/proposals');
  for (const proposal of mine.filter((entry) => entry.canWithdraw)) {
    const result = await api.postIfMatch(`/proposals/${proposal.id}/withdraw`, proposal.version);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }
}

async function addDraft(page: Page, card: Locator, date: string, shift: RegExp): Promise<void> {
  await card.getByRole('button', { name: 'Add a shift' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a shift' });
  await dialog.getByLabel('Date').fill(date);
  await expect(dialog.getByLabel('Unit')).toHaveValue(/.+/);
  await dialog.getByRole('button', { name: shift }).click();
  await dialog.getByRole('button', { name: 'Add and check the rules' }).click();
  await expect(dialog).toBeHidden();
}

function draft(card: Locator, name: RegExp): Locator {
  return card.getByRole('list', { name: 'Draft shifts' }).getByRole('listitem', { name });
}

test.describe('@api shift proposals, the officer side (v1.3 P3)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    await withdrawTarasWaiting(request);
  });

  test.afterAll(async ({ request }) => {
    await withdrawTarasWaiting(request);
  });

  test('Tara drafts two shifts, removes one, sends with a note, a Blocked draft cannot be sent, and she withdraws a second proposal', async ({
    page,
  }, testInfo) => {
    // This run's token: earlier runs on the same stack leave withdrawn proposals
    // for the same days in Tara's history.
    const token = `run ${Date.now().toString(36)}`;
    const firstNote = `Free that Saturday evening (${token}).`;
    const secondNote = `Friday too (${token}).`;
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    const card = page.getByRole('region', { name: 'Propose shifts' });
    const mine = page.getByRole('region', { name: 'My proposals' });

    // Two drafts, checked together: on its own Tue 1 Dec is only a Warning,
    // but with the Saturday draft the week goes over the 60 h ceiling (U-14).
    await addDraft(page, card, '2026-11-28', /E8 · Evening 8 h/);
    await addDraft(page, card, '2026-12-01', /E8 · Evening 8 h/);
    const saturday = draft(card, /Sat 28 Nov · E8 15:00 – 23:00 · Unit B/);
    const tuesday = draft(card, /Tue 1 Dec · E8 15:00 – 23:00 · Unit B/);
    await expect(saturday.getByText(/^Warning · /)).toBeVisible();
    await expect(tuesday.getByText(/^Blocked · /)).toBeVisible();
    await expect(tuesday.getByText('Checked with your other drafts')).toBeVisible();

    // A Blocked draft stops the send, and says why.
    const send = card.getByRole('button', { name: 'Send to supervisor' });
    await expect(send).toBeDisabled();
    await expect(card.getByText("1 shift can't be sent. Remove it to send the others.")).toBeVisible();
    await expectAccessible(page, testInfo, 'my-schedule-propose-blocked');
    await shot(page, testInfo, 'employee', 'my-schedule', 'propose-blocked');

    // Remove it: the other draft can go.
    await tuesday.getByRole('button', { name: /^Remove Tue 1 Dec/ }).click();
    await expect(tuesday).toHaveCount(0);
    await expect(card.getByRole('list', { name: 'Draft shifts' }).getByRole('listitem')).toHaveCount(1);
    await expect(saturday.getByText(/^Warning · /)).toBeVisible();
    await expect(send).toBeEnabled();

    // Send with a note: the drafts clear and the proposal is Waiting.
    await card.getByLabel('Note to your supervisor (optional)').fill(firstNote);
    await expectAccessible(page, testInfo, 'my-schedule-propose-ready');
    await shot(page, testInfo, 'employee', 'my-schedule', 'propose-ready');
    await send.click();
    await expect(
      card.getByText("Sent to your supervisor. You'll see the answer under My proposals."),
    ).toBeVisible();
    await expect(card.getByRole('list', { name: 'Draft shifts' })).toHaveCount(0);
    const first = mine.getByRole('listitem', { name: /^Proposal sent .*: Waiting$/ }).filter({
      hasText: firstNote,
    });
    await expect(first).toHaveCount(1);
    await expect(first.getByText(`Your note: ${firstNote}`)).toBeVisible();
    await expect(first.getByText('Sat 28 Nov · E8 15:00 – 23:00 · Unit B · Living unit')).toBeVisible();

    // A second proposal, then withdraw it.
    await addDraft(page, card, '2026-12-04', /E8 · Evening 8 h/);
    await expect(draft(card, /Fri 4 Dec · E8/).getByText(/^Warning · /)).toBeVisible();
    await card.getByLabel('Note to your supervisor (optional)').fill(secondNote);
    await send.click();
    const second = mine.getByRole('listitem', { name: /^Proposal sent .*: Waiting$/ }).filter({
      hasText: secondNote,
    });
    await expect(second.getByText('Fri 4 Dec · E8 15:00 – 23:00 · Unit B · Living unit')).toBeVisible();
    await expect(second).toHaveCount(1);
    await expectAccessible(page, testInfo, 'my-schedule-my-proposals');
    await shot(page, testInfo, 'employee', 'my-schedule', 'my-proposals-waiting');

    await second.getByRole('button', { name: /^Withdraw the proposal sent/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Withdraw this proposal?' });
    await expectAccessible(page, testInfo, 'my-proposals-withdraw-confirm', '[role="dialog"]');
    await confirm.getByRole('button', { name: 'Withdraw proposal' }).click();
    await expect(mine.getByText(/^Withdrawn\. Your supervisor no longer sees it/)).toBeVisible();
    const withdrawn = mine.getByRole('listitem', { name: /^Proposal sent .*: Withdrawn$/ }).filter({
      hasText: secondNote,
    });
    await expect(withdrawn).toHaveCount(1);
    await expect(withdrawn.getByRole('button', { name: /Withdraw/ })).toHaveCount(0);
    // The first one is still waiting.
    await expect(first).toHaveCount(1);

    // The api agrees: one waiting, one withdrawn.
    const api = await apiAs(page.request, 't.nakamura');
    const states = await api.get<{ displayState: string; note: string | null }[]>('/me/proposals');
    const byNote = (note: string) => states.filter((entry) => entry.note === note);
    expect(byNote(firstNote).map((entry) => entry.displayState)).toEqual(['WAITING']);
    expect(byNote(secondNote).map((entry) => entry.displayState)).toEqual(['WITHDRAWN']);
  });

  test('the old /me/propose link lands on the Propose card', async ({ page }) => {
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    await page.goto('/me/propose');
    await expect(page).toHaveURL(/\/me\/schedule#propose$/);
    await expect(page.getByRole('region', { name: 'Propose shifts' })).toBeInViewport();
    await expect(page.getByText('Not built yet')).toHaveCount(0);
  });

  test('works at 390 px: the cards stack, Remove stays reachable, no sideways scroll', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    const card = page.getByRole('region', { name: 'Propose shifts' });
    await addDraft(page, card, '2026-11-29', /E8 · Evening 8 h/);
    await addDraft(page, card, '2026-12-04', /D8 · Day 8 h/);
    const friday = draft(card, /Fri 4 Dec · D8/);
    await expect(friday.getByText(/^Blocked · /)).toBeVisible();

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll, 'no horizontal page scroll at 390 px').toBeLessThanOrEqual(width.client + 1);
    const remove = friday.getByRole('button', { name: /^Remove Fri 4 Dec/ });
    await remove.scrollIntoViewIfNeeded();
    await expect(remove).toBeInViewport();
    const box = await card.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390 + 1, 'the card fits the screen').toBe(true);
    await expect(page.getByRole('region', { name: 'My proposals' })).toBeVisible();
    await expectAccessible(page, testInfo, 'my-schedule-propose-390');
    await shot(page, testInfo, 'employee-390px', 'my-schedule', 'propose-blocked');

    await remove.click();
    await expect(friday).toHaveCount(0);
    // Leave nothing behind for the next spec in this tab.
    await draft(card, /Sun 29 Nov · E8/).getByRole('button', { name: /^Remove/ }).click();
  });
});
