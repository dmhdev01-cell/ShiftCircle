import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { isFixtures } from './api';
import { expectAccessible, navTo, resetDemoData, signIn } from './support';
import { shot } from './shots';

/**
 * v1.3 P5: the planted demo proposals and the walk in docs/demo-script.md §8.
 *
 * A fresh reset of Dataset 100 plants four proposals (no shift, so no
 * checksum moves): Tara's Waiting proposal with a Unit B shift for M. Ellis
 * and an Admissions shift for J. Chen, her Declined one with Chen's comment,
 * an Expired one, and Ellis's own Waiting SUP-L day shift, which only another
 * supervisor or the planner may decide. The nav counts are Ellis 1, Chen 2.
 *
 * A stack-wide spec: it approves shifts, so it resets Dataset 100 before and
 * after itself and leaves the planted state for the specs after it.
 */

const B_ROW = /^Tue 22 Dec · E8 15:00 – 23:00 · Unit B/;
const ADM_ROW = /^Wed 30 Dec · E8 15:00 – 23:00 · Admissions/;
const SUP_ROW = /^Sun 29 Nov · D8 07:00 – 15:00 · Supervision · Living units/;

function shiftRow(page: Page, name: RegExp): Locator {
  return page.getByRole('list', { name: 'Shifts in this proposal' }).getByRole('listitem', { name });
}

function navProposals(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Proposals/ });
}

/** Approve a shift, ticking whatever acknowledgement its current result asks for. */
async function approve(row: Locator): Promise<void> {
  await row.getByRole('radio', { name: 'Approve' }).check();
  const warnings = row.getByRole('checkbox', { name: /^I acknowledge the warning/ });
  if (await warnings.count()) await warnings.check();
  const order = row.getByRole('checkbox', { name: /outside the overtime order/ });
  if (await order.count()) await order.check();
}

test.describe('@api the planted demo proposals and the demo-script §8 walk (v1.3 P5)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetDemoData(request, '100');
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetDemoData(request, '100');
  });

  test('a fresh reset shows Ellis 1 and Chen 2 waiting; Ellis and Chen decide; Tara sees every outcome', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the planted proposals need the real api');

    // Step 1. Tara's side: three proposals, each in its own state.
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    const mine = page.getByRole('region', { name: 'My proposals' });
    const waiting = mine.getByRole('listitem', { name: /^Proposal sent .*: Waiting$/ });
    await expect(waiting).toHaveCount(1);
    await expect(waiting).toContainText('Tue 22 Dec · E8 15:00 – 23:00 · Unit B · Living unit');
    await expect(waiting).toContainText('Wed 30 Dec · E8 15:00 – 23:00 · Admissions');
    await expect(waiting.getByRole('button', { name: /^Withdraw the proposal sent/ })).toBeVisible();
    const declined = mine.getByRole('listitem', { name: /^Proposal sent .*: Declined$/ });
    await expect(declined).toContainText('Declined by J. Chen: “Admissions is fully staffed that evening.”');
    const expired = mine.getByRole('listitem', { name: /^Proposal sent .*: Expired$/ });
    await expect(expired).toContainText('Mon 16 Nov · E8 15:00 – 23:00 · Unit B');
    await expect(expired.getByRole('button', { name: /Withdraw/ })).toHaveCount(0);
    await mine.scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'employee', 'my-schedule', 'planted-proposals');

    // Step 2. M. Ellis: Proposals (1). Her own SUP-L proposal is not counted.
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await expect(navProposals(page)).toHaveText('Proposals (1)');
    await navProposals(page).click();
    await expect(page.getByRole('heading', { name: 'Proposals', level: 1 })).toBeVisible();
    const list = page.getByRole('list', { name: 'Proposals' });
    const taraCard = list.getByRole('button', { name: /Tara Nakamura/ });
    await expect(taraCard).toContainText('Unit B · 2 shifts (1 on your units)');
    await expect(taraCard).not.toContainText('Admissions');
    const ownCard = list.getByRole('button', { name: /Morgan Ellis/ });
    await expect(ownCard).toContainText('Yours');
    await shot(page, testInfo, 'supervisor', 'proposals', 'planted-inbox');

    // Her own proposal is read-only.
    await ownCard.click();
    const pane = page.getByRole('region', { name: 'Selected proposal' });
    await expect(pane.getByRole('heading', { name: 'Morgan Ellis' })).toBeVisible();
    await expect(pane.getByRole('note')).toContainText('Yours: waiting for another supervisor or the planner.');
    await expect(pane.getByRole('radio')).toHaveCount(0);

    // Step 3. Ellis approves Tara's Unit B shift; the Admissions one is Chen's.
    await taraCard.click();
    await expect(pane.getByRole('heading', { name: 'Tara Nakamura' })).toBeVisible();
    await expect(pane.getByText("Happy to pick up two evenings over the holidays if you're short.")).toBeVisible();
    // The pay-period line says both figures; the status is for after approval (P5 UI gate M1).
    await expect(pane.getByText('60 h of 80 h now · 68 h after approval')).toBeVisible();
    await expect(pane.getByText('Under after approval')).toBeVisible();
    const onB = shiftRow(page, B_ROW);
    await expect(onB.getByRole('group', { name: 'Rule result' })).toContainText(/Rules when sent\s*Warning · /);
    const onAdm = shiftRow(page, ADM_ROW);
    await expect(onAdm.getByRole('radio')).toHaveCount(0);
    await expect(onAdm).toContainText("Not on your units: Unit ADM's supervisor or the planner decides it.");
    await approve(onB);
    await expectAccessible(page, testInfo, 'proposals-demo-ellis-deciding');
    await shot(page, testInfo, 'supervisor', 'proposals', 'planted-deciding');
    await pane.getByRole('button', { name: 'Send decision (1 accepted, 0 declined)' }).click();
    await expect(pane.getByText(/^Sent\. Accepted shifts are on the planning board/)).toBeVisible();
    // Focus moves to the outcome, not back to the page (P5 UI gate).
    await expect(pane.getByRole('status').filter({ hasText: /^Sent\./ })).toBeFocused();
    await expect(onB.getByText('Approved', { exact: true })).toBeVisible();
    await expect(navProposals(page)).toHaveText('Proposals (0)');
    await shot(page, testInfo, 'supervisor', 'proposals', 'planted-sent');

    // Step 4. J. Chen: Proposals (2): Tara's Admissions shift and Ellis's own.
    await signIn(page, 'J. Chen');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await expect(navProposals(page)).toHaveText('Proposals (2)');
    await navProposals(page).click();
    await expect(page.getByRole('heading', { name: 'Proposals', level: 1 })).toBeVisible();
    await shot(page, testInfo, 'supervisor-chen', 'proposals', 'planted-inbox');
    await list.getByRole('button', { name: /Tara Nakamura/ }).click();
    await expect(pane.getByRole('heading', { name: 'Tara Nakamura' })).toBeVisible();
    await approve(shiftRow(page, ADM_ROW));
    await pane.getByRole('button', { name: 'Send decision (1 accepted, 0 declined)' }).click();
    await expect(pane.getByText(/^Sent\. Accepted shifts are on the planning board/)).toBeVisible();

    await list.getByRole('button', { name: /Morgan Ellis/ }).click();
    await expect(pane.getByRole('heading', { name: 'Morgan Ellis' })).toBeVisible();
    await expect(pane.getByText('I can take the Sunday day shift on Living units.')).toBeVisible();
    await expect(pane.getByText('72 h of 80 h now · 80 h after approval')).toBeVisible();
    await expect(pane.getByText('In overtime after approval')).toBeVisible();
    await approve(shiftRow(page, SUP_ROW));
    await shot(page, testInfo, 'supervisor-chen', 'proposals', 'planted-ellis-own');
    await pane.getByRole('button', { name: 'Send decision (1 accepted, 0 declined)' }).click();
    await expect(pane.getByText(/^Sent\. Accepted shifts are on the planning board/)).toBeVisible();
    await expect(navProposals(page)).toHaveText('Proposals (0)');

    // Step 5. Tara sees both approvals, with who approved each.
    await signIn(page, 'T. Nakamura');
    await expect(page.getByRole('heading', { name: 'My schedule', level: 1 })).toBeVisible();
    const approved = mine.getByRole('listitem', { name: /^Proposal sent .*: Approved$/ });
    await expect(approved).toHaveCount(1);
    await expect(approved.getByText(/^Approved by M\. Ellis/)).toBeVisible();
    await expect(approved.getByText(/^Approved by J\. Chen/)).toBeVisible();
    await mine.scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'employee', 'my-schedule', 'planted-approved');

    // Step 6. The audit log names each decision.
    await signIn(page, 'A. Reviewer');
    await navTo(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    const planted = page.getByRole('row').filter({ hasText: 'Planted: true' });
    await expect(planted).toHaveCount(6);
    await expect(planted.filter({ hasText: 'Decision: DECLINED' })).toContainText('J. Chen');
    await expect(planted.filter({ hasText: 'Proposed shift expired' })).toContainText('System');
    await expect(page.getByRole('row').filter({ hasText: 'Proposed shift decided' }).filter({ hasText: 'ACCEPTED' })).toHaveCount(3);
    await shot(page, testInfo, 'auditor', 'audit', 'planted-decisions');
  });
});
