import { expect, test } from '@playwright/test';

import { apiAs, isFixtures } from './api';

/**
 * Planned absences are a read-only input (P3 amendment 20.2): a planner marks
 * a future absence, the next generate skips that officer on that date, and the
 * scorecard carries the absences line (covered by relief or visibly uncovered).
 *
 * Self-contained: discards any open draft, learns a scheduled officer from a
 * first generate with the default seed, adds the absence, regenerates with the
 * same seed and reads the officer's schedule back.
 */

const FROM = '2027-01-04';
const TO = '2027-01-10';

interface PlanState {
  state: 'NONE' | 'DRAFT' | 'COMMITTED';
  defaultSeed: number;
  draft?: { id: string } | null;
}

interface Unit {
  id: string;
  code: string;
  name: string;
}

interface OfficerRow {
  employeeId: string;
  name: string;
  cells: { date: string; items: ({ type: 'SHIFT'; shiftTemplate: string } | { type: 'ABSENCE'; absenceType: string })[] }[];
}

interface Schedule {
  officers: OfficerRow[];
}

interface Absences {
  officers: number;
  days: number;
  line: string;
}

interface Draft {
  id: string;
  scorecard?: { absences?: Absences };
}

test.describe('planned absences', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    test.skip(process.env.E2E_MODE === 'fixtures' || (await isFixtures(page)), 'planned absences are a real-api input');
  });

  test('@api skip the officer and are counted on the scorecard', async ({ request }) => {
    test.setTimeout(240_000);
    const api = await apiAs(request, 'p.planner');
    const plan = await api.get<PlanState>('/planner/plan');
    if (plan.draft) {
      await api.post(`/planner/drafts/${plan.draft.id}/discard`);
    }

    // A plan generated before any leave: find an officer who works midweek. A
    // 409 means a generation or commit is still finishing; retry once.
    let first = await api.post('/planner/drafts', { seed: plan.defaultSeed });
    if (first.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      first = await api.post('/planner/drafts', { seed: plan.defaultSeed });
    }
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    const firstId = (first.body as Draft).id;

    const units = await api.get<Unit[]>('/units');
    let found: { unitId: string; name: string; employeeId: string; date: string } | undefined;
    for (const unit of units) {
      const schedule = await api.get<Schedule>(
        `/planner/drafts/${firstId}/schedule?unitId=${unit.id}&from=${FROM}&to=${TO}`,
      );
      for (const officer of schedule.officers) {
        for (const cell of officer.cells) {
          // A day with a shift and no leave: since PR-D a leave day carries an ABSENCE item,
          // and re-posting a kept absence on a rerun would answer 200, not 201.
          const working =
            cell.items.some((item) => item.type === 'SHIFT') &&
            !cell.items.some((item) => item.type === 'ABSENCE');
          if (cell.date >= '2027-01-05' && cell.date <= '2027-01-08' && working) {
            found ??= { unitId: unit.id, name: officer.name, employeeId: officer.employeeId, date: cell.date };
          }
        }
      }
      if (found) break;
    }
    expect(found, 'a scheduled officer in the plan week').toBeTruthy();
    const absence = found!;

    // The absence is an input to generation, so the draft goes first.
    await api.post(`/planner/drafts/${firstId}/discard`);
    const added = await api.post('/planner/absences', {
      employeeId: absence.employeeId,
      date: absence.date,
      type: 'VACATION',
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);

    // Same seed, now with leave: the officer is skipped and the scorecard says
    // how the day was covered.
    let second = await api.post('/planner/drafts', { seed: plan.defaultSeed });
    if (second.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      second = await api.post('/planner/drafts', { seed: plan.defaultSeed });
    }
    expect([200, 201], JSON.stringify(second.body)).toContain(second.status);
    const draft = second.body as Draft;
    const absences = draft.scorecard?.absences;
    expect(absences, 'the scorecard carries the absences line').toBeTruthy();
    expect(absences!.officers).toBeGreaterThanOrEqual(1);
    expect(absences!.days).toBeGreaterThanOrEqual(1);
    expect(absences!.line).toMatch(/on leave/);
    expect(absences!.line).toMatch(/relief/i);

    const after = await api.get<Schedule>(
      `/planner/drafts/${draft.id}/schedule?unitId=${absence.unitId}&from=${FROM}&to=${TO}`,
    );
    const officer = after.officers.find((row) => row.employeeId === absence.employeeId);
    expect(officer, `${absence.name} is still on the roster`).toBeTruthy();
    const cell = officer!.cells.find((entry) => entry.date === absence.date);
    expect(cell, `${absence.name} has a ${absence.date} cell`).toBeTruthy();
    // No shift that day; since PR-D the draft roster shows the leave itself (a Vac chip, not Off).
    expect(cell!.items, `${absence.name} on leave on ${absence.date}`).toEqual([
      { type: 'ABSENCE', absenceType: 'VACATION' },
    ]);

    // Leave no open draft behind (the absence row stays: it is a plan input).
    await api.post(`/planner/drafts/${draft.id}/discard`);
  });
});
