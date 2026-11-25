import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { apiAs } from './api';
import { expectAccessible, signIn } from './support';
import { shot } from './shots';

/**
 * v1.3 P4: the decider's side of shift proposals, the Proposals inbox
 * (plan v1.2-proposals §3.2 and §7, acceptance for P4).
 *
 * Tara sends two proposals (through the api: sending is P3's screen and spec):
 *   A: Sat 28 Nov E8 and Fri 4 Dec E8, Warnings when sent;
 *   B: Sun 29 Nov E8, a Warning when sent.
 * M. Ellis opens B (Warning when sent and now) in one window and A in another.
 * He approves Sat 28 Nov (acknowledging its warnings) and declines Fri 4 Dec
 * with a comment. That approval changes B's facts: Sun 29 Nov is now an 8th
 * day in a row (U-08) and over the weekly ceiling (U-14), so approving B is
 * refused inline with the fresh result, "was / now" shows, Approve is off and
 * there is no override button. He declines B. The board shows the new shift
 * with "from an approved proposal"; Tara sees both outcomes and the comment.
 *
 * A stack-wide spec (playwright.config STACK_SPECS): it creates a shift for
 * Tara, whom the parallel specs use. It runs after them, one at a time, and
 * cleans up before and after itself, touching only its own proposals (their
 * note starts with TAG): withdraws them, declines what is left and cancels the
 * shifts they created, so it can run again on the same stack. This run's proposals are found by a token in their note.
 */

const UNIT_B_NAME = 'Unit B · Living unit';
const SAT = '2026-11-28T15:00:00-06:00';
const FRI = '2026-12-04T15:00:00-06:00';
const SUN = '2026-11-29T15:00:00-06:00';
const WINDOW = { from: '2026-11-23', to: '2026-12-06' };

interface MyProposal {
  id: string;
  version: number;
  canWithdraw: boolean;
  note: string | null;
  displayState: string;
  items: { id: string; startAt: string; decision: string; decidedBy: string | null; comment: string | null }[];
}

async function token(request: APIRequestContext, userId: string): Promise<string> {
  const login = await request.post('/api/v1/auth/mock-login', { data: { userId } });
  expect(login.status(), `mock sign-in for ${userId}`).toBe(200);
  return (await login.json()).token as string;
}

async function unitB(request: APIRequestContext): Promise<string> {
  const api = await apiAs(request, 'm.ellis');
  const units = await api.get<{ id: string; name: string }[]>('/units');
  const unit = units.find((entry) => entry.name === UNIT_B_NAME);
  expect(unit, 'Unit B is in M. Ellis’s scope').toBeTruthy();
  return unit!.id;
}

/** Every note this spec writes starts with it, so clean-up touches only its own proposals. */
const TAG = 'e2e-inbox';

/**
 * Leave the stack as this spec found it, touching only this spec's own
 * proposals (their note starts with TAG): withdraw them while they wait,
 * decline what is still waiting after a partial answer, and cancel the shifts
 * their approved items created. A proposal the deciders can't see (404) is
 * skipped, never a reason to fail.
 */
async function cleanUp(request: APIRequestContext): Promise<void> {
  const tara = await apiAs(request, 't.nakamura');
  const ours = (await tara.get<MyProposal[]>('/me/proposals')).filter((entry) =>
    (entry.note ?? '').startsWith(TAG),
  );
  for (const proposal of ours.filter((entry) => entry.canWithdraw)) {
    const result = await tara.postIfMatch(`/proposals/${proposal.id}/withdraw`, proposal.version);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }

  const bearer = await token(request, 'm.ellis');
  const headers = { Authorization: `Bearer ${bearer}` };
  const assignments: string[] = [];
  for (const proposal of ours.filter((entry) => !entry.canWithdraw)) {
    const read = await request.get(`/api/v1/proposals/${proposal.id}`, { headers });
    if (read.status() === 404 || read.status() === 403) continue;
    expect(read.status(), await read.text()).toBe(200);
    const detail = (await read.json()) as {
      version: number;
      items: { id: string; decision: string; canDecide: boolean; assignmentId: string | null }[];
    };
    const pending = detail.items.filter((item) => item.decision === 'PENDING' && item.canDecide);
    if (pending.length > 0) {
      const decided = await request.post(`/api/v1/proposals/${proposal.id}/decision`, {
        headers: { ...headers, 'If-Match': `"${detail.version}"` },
        data: { items: pending.map((item) => ({ id: item.id, accept: false, comment: 'e2e clean-up' })) },
      });
      expect(decided.status(), await decided.text()).toBe(200);
    }
    for (const item of detail.items) {
      if (item.decision === 'ACCEPTED' && item.assignmentId) assignments.push(item.assignmentId);
    }
  }
  if (assignments.length === 0) return;

  // The version for If-Match comes from the board; a shift cancelled already is not on it.
  const unit = await unitB(request);
  const ellis = await apiAs(request, 'm.ellis');
  const board = await ellis.get<{
    officers: { cells: { items: { type: string; assignmentId: string; version: number }[] }[] }[];
  }>(`/schedule?unitId=${unit}&from=${WINDOW.from}&to=${WINDOW.to}`);
  const versions = new Map<string, number>();
  for (const officer of board.officers) {
    for (const cell of officer.cells) {
      for (const item of cell.items) if (item.type === 'SHIFT') versions.set(item.assignmentId, item.version);
    }
  }
  for (const id of assignments.filter((entry) => versions.has(entry))) {
    const response = await request.delete(`/api/v1/assignments/${id}`, {
      headers: { ...headers, 'If-Match': `"${versions.get(id)}"` },
      data: { reason: 'e2e clean-up: shift from a test proposal' },
    });
    expect(response.status(), await response.text()).toBe(200);
  }
}

async function send(request: APIRequestContext, note: string, unitId: string, starts: string[]): Promise<MyProposal> {
  const tara = await apiAs(request, 't.nakamura');
  const result = await tara.post('/proposals', {
    note,
    items: starts.map((startAt) => ({ unitId, shiftTemplate: 'E8', startAt })),
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body as MyProposal;
}

function shiftRow(page: Page, name: RegExp): Locator {
  return page.getByRole('list', { name: 'Shifts in this proposal' }).getByRole('listitem', { name });
}

async function navCount(page: Page): Promise<number> {
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Proposals \(\d+\)$/ });
  await expect(link).toBeVisible();
  return Number((await link.textContent())!.match(/\((\d+)\)/)![1]);
}

/** Approve a shift, ticking whatever acknowledgement its current result asks for. */
async function approve(row: Locator): Promise<void> {
  await row.getByRole('radio', { name: 'Approve' }).check();
  const warnings = row.getByRole('checkbox', { name: /^I acknowledge the warning/ });
  if (await warnings.count()) await warnings.check();
  const order = row.getByRole('checkbox', { name: /outside the overtime order/ });
  if (await order.count()) await order.check();
}

const SAT_ROW = /^Sat 28 Nov · E8 15:00 – 23:00 · Unit B/;
const FRI_ROW = /^Fri 4 Dec · E8 15:00 – 23:00 · Unit B/;
const SUN_ROW = /^Sun 29 Nov · E8 15:00 – 23:00 · Unit B/;

test.describe('@api shift proposals, the inbox (v1.3 P4)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    await cleanUp(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanUp(request);
  });

  test('Ellis approves one shift and declines one with a comment; a shift whose rules changed since it was sent is refused with "was / now"; Tara sees both outcomes', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    const run = `run ${Date.now().toString(36)}`;
    const unit = await unitB(request);
    const proposalA = await send(request, `${TAG}: free that Saturday and Friday (${run}).`, unit, [SAT, FRI]);
    const proposalB = await send(request, `${TAG}: Sunday too if needed (${run}).`, unit, [SUN]);
    const comment = `Unit B is fully staffed on Friday (${run}).`;

    // Window 2: B is open before anything changes, and passes with a Warning.
    const second = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport,
    });
    const other = await second.newPage();
    await signIn(other, 'M. Ellis');
    await other.goto(`/proposals?proposal=${proposalB.id}`);
    const sunday = shiftRow(other, SUN_ROW);
    await expect(sunday.getByRole('group', { name: 'Rule result' })).toContainText(/Rules when sent\s*Warning · /);
    await expect(sunday.getByRole('group', { name: 'Rule result' })).toContainText(/Rules now\s*Warning · /);
    await expect(sunday.getByText(/^Changed since it was sent/)).toHaveCount(0);
    await approve(sunday);

    // Window 1: the inbox, from the nav.
    await signIn(page, 'M. Ellis');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    const before = await navCount(page);
    expect(before, 'both of this run’s proposals are waiting').toBeGreaterThanOrEqual(2);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Proposals/ }).click();
    await expect(page.getByRole('heading', { name: 'Proposals', level: 1 })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Proposals' }).getByRole('button', { name: /Tara Nakamura/ });
    // This run's two, told apart by their shifts; the demo's planted Waiting
    // proposal (v1.3 P5, Tue 22 Dec on Unit B) is there as well.
    await expect(cards.filter({ hasText: /Sat 28 Nov|Sun 29 Nov/ })).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Tue 22 Dec · E8 15:00 – 23:00 · Unit B' })).toHaveCount(1);
    await page.goto(`/proposals?proposal=${proposalA.id}`);
    const pane = page.getByRole('region', { name: 'Selected proposal' });
    await expect(pane.getByRole('heading', { name: 'Tara Nakamura' })).toBeVisible();
    await expect(pane.getByText(`${TAG}: free that Saturday and Friday (${run}).`)).toBeVisible();
    await expect(pane.getByText(/ h of 80 h this pay period$/)).toBeVisible();

    const saturday = shiftRow(page, SAT_ROW);
    const friday = shiftRow(page, FRI_ROW);
    await expect(saturday.getByText(/^Would be overtime: \d+(\.\d+)? h · brings Tara to /)).toBeVisible();
    await expect(
      saturday.getByText('No open shift for this slot: approving adds an extra shift above minimum.'),
    ).toBeVisible();
    // No override in the inbox, whatever the result.
    await expect(page.getByRole('button', { name: /override/i })).toHaveCount(0);

    const sendButton = pane.getByRole('button', { name: /^Send decision/ });
    await expect(sendButton).toBeDisabled();
    await expect(pane.getByText('Choose Approve or Decline for every shift.')).toBeVisible();
    await approve(saturday);
    await friday.getByRole('radio', { name: 'Decline' }).check();
    await expect(pane.getByText('Each declined shift needs a comment, so the officer knows why.')).toBeVisible();
    await friday.getByLabel('Comment for Tara (required)').fill(comment);
    await expect(pane.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' })).toBeEnabled();
    await expectAccessible(page, testInfo, 'proposals-inbox-deciding');
    await shot(page, testInfo, 'supervisor', 'proposals', 'deciding');

    await pane.getByRole('button', { name: 'Send decision (1 accepted, 1 declined)' }).click();
    await expect(pane.getByText(/^Sent\. Accepted shifts are on the planning board/)).toBeVisible();
    await expect(saturday.getByText('Approved', { exact: true })).toBeVisible();
    await expect(friday.getByText(`Declined by M. Ellis: “${comment}”`)).toBeVisible();
    await expect.poll(() => navCount(page)).toBe(before - 1);
    await shot(page, testInfo, 'supervisor', 'proposals', 'sent');

    // Window 2: the approval of Sat 28 Nov changed Sunday's facts. The send is
    // refused, and the fresh result shows in place: was / now, no Approve.
    await other.getByRole('button', { name: 'Send decision (1 accepted, 0 declined)' }).click();
    await expect(other.getByRole('alert')).toContainText(
      'Not sent: A shift you approved breaks a rule now. The rules were checked again just now',
    );
    await expect(sunday.getByText(/^Changed since it was sent: Was Warning · .*, now Blocked · .*U-08/)).toBeVisible();
    await expect(sunday.getByRole('radio', { name: 'Approve' })).toBeDisabled();
    await expect(sunday.getByRole('note')).toContainText("can't be approved from a proposal");
    await expect(other.getByRole('button', { name: /override/i })).toHaveCount(0);
    await expectAccessible(other, testInfo, 'proposals-inbox-blocked-now');
    await shot(other, testInfo, 'supervisor', 'proposals', 'blocked-now');

    // A fresh read says the same: was / now, and Approve is off from the start.
    await other.reload();
    await expect(sunday.getByText(/^Changed since it was sent: Was Warning · .*, now Blocked · .*U-08/)).toBeVisible();
    await expect(sunday.getByRole('radio', { name: 'Approve' })).toBeDisabled();
    await sunday.getByRole('radio', { name: 'Decline' }).check();
    await sunday.getByLabel('Comment for Tara (required)').fill(`Would be an 8th day in a row (${run}).`);
    await other.getByRole('button', { name: 'Send decision (0 accepted, 1 declined)' }).click();
    await expect(other.getByText(/^Sent\. Tara sees the outcome/)).toBeVisible();
    await second.close();

    // The board: the new shift carries the proposal in its name and tooltip.
    await saturday.getByRole('link', { name: 'Open the board for the week of Sat 28 Nov' }).click();
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    const chip = page.getByRole('button', {
      name: /for Tara Nakamura on 2026-11-28 · from an approved proposal$/,
    });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('title', /· from an approved proposal$/);
    await expect(chip).toContainText('extra');

    // Tara sees both outcomes and the comment, as text.
    await signIn(page, 'T. Nakamura');
    const mine = page.getByRole('region', { name: 'My proposals' });
    const decided = mine
      .getByRole('listitem', { name: /^Proposal sent .*: Partly approved$/ })
      .filter({ hasText: run });
    await expect(decided).toHaveCount(1);
    await expect(decided.getByText(/^Approved by M\. Ellis/)).toBeVisible();
    await expect(decided.getByText(`Declined by M. Ellis: “${comment}”`)).toBeVisible();
    const declined = mine.getByRole('listitem', { name: /^Proposal sent .*: Declined$/ }).filter({ hasText: run });
    await expect(declined).toHaveCount(1);
    await shot(page, testInfo, 'employee', 'my-schedule', 'my-proposals-decided');

    // The api agrees.
    const tara = await apiAs(request, 't.nakamura');
    const states = await tara.get<MyProposal[]>('/me/proposals');
    expect(states.find((entry) => entry.id === proposalA.id)?.displayState).toBe('PARTLY_APPROVED');
    expect(states.find((entry) => entry.id === proposalB.id)?.displayState).toBe('DECLINED');
  });

  test('J. Chen sees only the shifts on his units: the planted Admissions shift and M. Ellis’s own proposal, never a Unit B shift', async ({
    page,
  }, testInfo) => {
    // J. Chen supervises ADM, CTL, ESC and both supervisor posts. The demo
    // plants (v1.3 P5) Tara's two-shift proposal, Unit B for Ellis and
    // Admissions for him, and Ellis's own SUP-L day shift, which only another
    // supervisor or the planner may decide.
    await signIn(page, 'J. Chen');
    await expect(page.getByRole('heading', { name: 'Planning board', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Proposals (2)' }),
    ).toBeVisible();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Proposals/ }).click();
    await expect(page.getByRole('heading', { name: 'Proposals', level: 1 })).toBeVisible();
    const list = page.getByRole('list', { name: 'Proposals' });
    const tara = list.getByRole('button', { name: /Tara Nakamura/ });
    await expect(tara).toHaveCount(1);
    await expect(tara).toContainText('Unit ADM · 2 shifts (1 on your units)');
    await expect(tara).toContainText('Wed 30 Dec · E8 15:00 – 23:00 · Unit ADM');
    await expect(tara).not.toContainText('Unit B');
    const ellis = list.getByRole('button', { name: /Morgan Ellis/ });
    await expect(ellis).toContainText('Sun 29 Nov · D8 07:00 – 15:00 · Unit SUP-L');

    // Under All: Tara's planted Admissions shift that he declined; none of
    // this spec's Unit B proposals.
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click();
    await expect(list.getByRole('button', { name: /Tara Nakamura/ })).toHaveCount(2);
    await expect(list.getByRole('button', { name: /Tara Nakamura/ }).filter({ hasText: 'Unit B' })).toHaveCount(0);
    await expectAccessible(page, testInfo, 'proposals-inbox-chen');
    await shot(page, testInfo, 'supervisor-chen', 'proposals', 'planted');
  });
});
