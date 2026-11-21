import { expect, test } from '@playwright/test';

import type { APIRequestContext, Page } from '@playwright/test';

import { apiAs, isFixtures } from './api';
import { navTo, selectUnit, signIn, signOut } from './support';

/**
 * Dataset 120 (100 full-time crews + ~20 part-time casuals; the person chose
 * it at 04:19Z): the planner shows the honest gaps, the committed 2027 plan
 * carries the D12/N12 12 h crew chips, a supervisor fills one gap on the
 * board, and an illegal fifth consecutive 12 h day is refused by U-09.
 *
 * Self-contained: resets the stack to dataset 120 and commits its own plan.
 * Playwright gives no ordering across spec files, so it must not rely on
 * another spec's state.
 */

const DEMO_MONDAY = '2026-11-16';
const PLAN_FROM = '2027-01-04';

interface PlanState {
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  defaultSeed: number;
  draft?: { id: string } | null;
  committedDraft?: { id: string } | null;
}

interface Unit {
  id: string;
  code: string;
  name: string;
}

interface Gap {
  unitId: string;
  unitName: string;
  date: string;
  block: 'DAY' | 'EVENING' | 'NIGHT';
  required: number;
  placed: number;
}

interface ShiftItem {
  shiftTemplate: string;
}

interface DayCell {
  date: string;
  items: ShiftItem[];
}

interface Officer {
  employeeId: string;
  name: string;
  cells: DayCell[];
}

interface RuleResult {
  outcome: string;
  ruleCode: string;
}

/** The template a gap's block needs on the crew model. */
const GAP_TEMPLATE: Record<Gap['block'], { code: string; start: string; label: string }> = {
  DAY: { code: 'D12', start: '07:00', label: 'D12 · Day 12 h' },
  EVENING: { code: 'E8', start: '15:00', label: 'E8 · Evening 8 h' },
  NIGHT: { code: 'N12', start: '19:00', label: 'N12 · Night 12 h' },
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  return addDays(date, -((value.getUTCDay() + 6) % 7));
}

/** Reset the stack to a dataset through the api, and wait for DONE. */
async function resetTo(request: APIRequestContext, dataset: '100' | '120'): Promise<void> {
  const api = await apiAs(request, 'p.planner');
  const started = await api.post('/demo/reset', { confirm: 'RESET', dataset });
  expect([200, 202]).toContain(started.status);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.get<{ state: string; dataset?: string; error: string | null }>(
      '/demo/reset/status',
    );
    if (status.state === 'DONE') {
      expect(status.dataset ?? dataset).toBe(dataset);
      return;
    }
    if (status.state === 'FAILED') throw new Error(`reset to ${dataset} failed: ${status.error ?? 'no reason'}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`reset to ${dataset} did not finish`);
}

/** Commit a plan on the current stack and return its id. */
async function commitPlan(request: APIRequestContext): Promise<string> {
  const api = await apiAs(request, 'p.planner');
  const plan = await api.get<PlanState>('/planner/plan');
  if (plan.state === 'COMMITTED' && plan.committedDraft) return plan.committedDraft.id;
  const draft = await api.post('/planner/drafts', { seed: plan.defaultSeed });
  expect([200, 201]).toContain(draft.status);
  const id = (draft.body as { id: string }).id;
  const preview = await api.get<{ version: number; warningCount: number }>(
    `/planner/drafts/${id}/commit-preview`,
  );
  const committed = await api.postIfMatch(`/planner/drafts/${id}/commit`, preview.version, {
    acceptedWarningCount: preview.warningCount,
  });
  expect(committed.status).toBe(200);
  return id;
}

/** Walk the board from the demo week to the wanted Monday (whole weeks). */
async function goToWeek(page: Page, current: { monday: string }, target: string): Promise<void> {
  const weeks =
    (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${current.monday}T00:00:00Z`)) / (7 * 86_400_000);
  const button = weeks < 0 ? 'Previous week' : 'Next week';
  for (let step = 0; step < Math.abs(weeks); step += 1) {
    await page.getByRole('button', { name: button }).click();
  }
  current.monday = target;
}

/**
 * An officer who is Off on the gap's date and can legally take the block's
 * template, found through the same preview the board runs.
 */
async function fillableOfficer(
  request: APIRequestContext,
  userId: string,
  gap: Gap,
): Promise<{ employeeId: string; name: string }> {
  const api = await apiAs(request, userId);
  const from = mondayOf(gap.date);
  const schedule = await api.get<{ officers: Officer[] }>(
    `/schedule?unitId=${gap.unitId}&from=${from}&to=${addDays(from, 6)}`,
  );
  const template = GAP_TEMPLATE[gap.block];
  for (const officer of schedule.officers) {
    const cell = officer.cells.find((entry) => entry.date === gap.date);
    if (!cell || cell.items.length > 0) continue;
    const preview = await api.post('/rule-checks', {
      change: {
        type: 'ASSIGN',
        employeeId: officer.employeeId,
        unitId: gap.unitId,
        shiftTemplate: template.code,
        startAt: `${gap.date}T${template.start}:00-06:00`,
      },
    });
    const results = (preview.body as { ruleResults?: RuleResult[] }).ruleResults ?? [];
    if (preview.status === 200 && !results.some((result) => result.outcome === 'BLOCK')) {
      return { employeeId: officer.employeeId, name: officer.name };
    }
  }
  throw new Error(`no officer in ${gap.unitName} can take a ${template.code} on ${gap.date}`);
}

/**
 * An officer on four consecutive D12 days who is Off the day after: assigning
 * that fifth day must be blocked by U-09 (more than 4 consecutive 12 h shifts).
 */
async function fifthDayOfFour(
  request: APIRequestContext,
): Promise<{ unitId: string; employeeId: string; date: string }> {
  const api = await apiAs(request, 'm.ellis');
  const units = await api.get<Unit[]>('/units');
  for (const unit of units) {
    const schedule = await api.get<{ officers: Officer[] }>(
      `/schedule?unitId=${unit.id}&from=${PLAN_FROM}&to=2027-01-17`,
    );
    for (const officer of schedule.officers) {
      const items = new Map(officer.cells.map((cell) => [cell.date, cell.items]));
      for (const cell of officer.cells) {
        const run = [0, 1, 2, 3].map((offset) => addDays(cell.date, offset));
        const fourD12 = run.every((date) =>
          (items.get(date) ?? []).some((item) => item.shiftTemplate === 'D12'),
        );
        const fifth = addDays(cell.date, 4);
        const fifthEmpty = (items.get(fifth) ?? []).length === 0;
        if (fourD12 && fifthEmpty) {
          return { unitId: unit.id, employeeId: officer.employeeId, date: fifth };
        }
      }
    }
  }
  throw new Error('no four consecutive D12 days in the committed plan');
}

test.describe('dataset 120', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(await isFixtures(page), 'the crews and casuals need the real api');
  });

  // Leave the seeded 100 dataset behind: the rest of the suite (and the demo)
  // assumes the untouched baseline, and the reset is the only stack-wide write.
  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await resetTo(request, '100');
  });

  test('shows the gaps, carries D12/N12, fills one, and refuses a fifth 12 h day', async ({
    page,
    request,
  }) => {
    test.setTimeout(300000);
    await resetTo(request, '120');
    const draftId = await commitPlan(request);

    const planner = await apiAs(request, 'p.planner');
    const gaps = await planner.get<Gap[]>(`/planner/drafts/${draftId}/gaps`);
    // Loose bound: the 120 dataset keeps the honest ~38 gaps for supervisors.
    expect(gaps.length, 'gaps on dataset 120').toBeGreaterThan(20);

    // The rules refuse a fifth consecutive 12 h day: four committed D12 days,
    // then a preview of the day after (U-09, Block).
    const run = await fifthDayOfFour(request);
    const checkApi = await apiAs(request, 'm.ellis');
    const fifth = await checkApi.post('/rule-checks', {
      change: {
        type: 'ASSIGN',
        employeeId: run.employeeId,
        unitId: run.unitId,
        shiftTemplate: 'D12',
        startAt: `${run.date}T07:00:00-06:00`,
      },
    });
    expect(fifth.status).toBe(200);
    const results = (fifth.body as { ruleResults?: RuleResult[] }).ruleResults ?? [];
    expect(
      results.some((result) => result.ruleCode === 'U-09' && result.outcome === 'BLOCK'),
      JSON.stringify(results),
    ).toBe(true);

    // The planner sees the gaps counted on the Gaps tab.
    await signIn(page, 'P. Planner');
    await navTo(page, 'Quarter plan');
    const gapsTab = page.getByRole('tab', { name: /Gaps \(/ });
    await expect(gapsTab).toBeVisible();
    const count = Number((await gapsTab.textContent())?.match(/Gaps \((\d+)\)/)?.[1] ?? 0);
    expect(count, 'the Gaps tab counts the short block-days').toBeGreaterThan(20);
    await signOut(page, 'P. Planner');

    // A supervisor opens the committed plan. The crews live in specific units,
    // and each supervisor sees only their own: use the supervisor whose units
    // hold a gap (M. Ellis owns A/B, J. Chen the crew units). That supervisor
    // also fills the gap (demo step 7).
    const supervisors = [
      { id: 'm.ellis', name: 'M. Ellis' },
      { id: 'j.chen', name: 'J. Chen' },
    ];
    let actor:
      | { id: string; name: string; units: Unit[]; gap: Gap }
      | undefined;
    for (const candidate of supervisors) {
      const candidateApi = await apiAs(request, candidate.id);
      const units = await candidateApi.get<Unit[]>('/units');
      const gap = gaps.find((entry) => units.some((unit) => unit.id === entry.unitId));
      if (gap) {
        actor = { ...candidate, units, gap };
        break;
      }
    }
    expect(actor, 'a supervisor whose units hold a gap').toBeTruthy();
    const supervisor = actor!;
    const gap = supervisor.gap;

    await signIn(page, supervisor.name);
    await navTo(page, 'Planning board');
    const current = { monday: DEMO_MONDAY };
    await goToWeek(page, current, PLAN_FROM);
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('4 – 10 Jan 2027');
    let chips = 0;
    for (const unit of supervisor.units) {
      await selectUnit(page, unit.name);
      chips = await page.getByRole('button', { name: /^(D12|N12) for / }).count();
      if (chips > 0) break;
    }
    expect(chips, 'a D12 or N12 chip on the committed 2027 week').toBeGreaterThan(0);

    const officer = await fillableOfficer(request, supervisor.id, gap);
    await selectUnit(page, gap!.unitName);
    await goToWeek(page, current, mondayOf(gap!.date));
    const off = page.getByRole('button', {
      name: `Off - assign a shift to ${officer.name} on ${gap!.date}`,
    });
    await off.click();
    await page.getByRole('button', { name: GAP_TEMPLATE[gap!.block].label }).click();
    const panel = page.getByRole('region', { name: 'Rule check' });
    const save = panel.getByRole('button', { name: /^(Assign shift|Acknowledge and assign)$/ });
    await expect(save).toBeVisible({ timeout: 15_000 });
    await save.click();
    await panel.getByRole('button', { name: 'Done' }).click();
    // The cell now holds the shift; the officer is no longer Off that day.
    await expect(off).toHaveCount(0, { timeout: 10_000 });
  });
});
