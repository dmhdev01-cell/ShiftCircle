import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Real-api helpers for set-up and look-ups. The screens are still driven by
 * clicks; these only find data a test can use without colliding with another
 * spec, or put the stack in a known state first.
 */

export const USER_IDS: Record<string, string> = {
  'M. Ellis': 'm.ellis',
  'J. Chen': 'j.chen',
  'T. Nakamura': 't.nakamura',
  'L. Fraser': 'l.fraser',
  'P. Singh': 'p.singh',
  'A. Reviewer': 'a.reviewer',
  'Unit office TV': 'tv.display',
};

export interface Api {
  get<T = unknown>(path: string): Promise<T>;
  post(path: string, data?: unknown): Promise<{ status: number; body: unknown }>;
  put(path: string, data?: unknown): Promise<{ status: number; body: unknown }>;
  /** A POST carrying If-Match, for the endpoints that are optimistic. */
  postIfMatch(
    path: string,
    version: number,
    data?: unknown,
  ): Promise<{ status: number; body: unknown }>;
}

/** True when the web under test is the fixtures-mode build. */
export async function isFixtures(page: Page): Promise<boolean> {
  return (await page.getByText('Demo fixtures').count()) > 0;
}

/** A signed-in api client for one demo user (mock sign-in). */
export async function apiAs(request: APIRequestContext, userId: string): Promise<Api> {
  const login = await request.post('/api/v1/auth/mock-login', { data: { userId } });
  expect(login.status(), `mock sign-in for ${userId}`).toBe(200);
  const token = (await login.json()).token as string;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async get<T>(path: string): Promise<T> {
      const response = await request.get(`/api/v1${path}`, { headers });
      expect(response.status(), `GET ${path}`).toBe(200);
      return (await response.json()) as T;
    },
    async put(path: string, data?: unknown) {
      const response = await request.put(`/api/v1${path}`, { headers, data });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status(), body };
    },
    async post(path: string, data?: unknown) {
      const response = await request.post(`/api/v1${path}`, { headers, data });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status(), body };
    },
    async postIfMatch(path: string, version: number, data?: unknown) {
      const response = await request.post(`/api/v1${path}`, {
        headers: { ...headers, 'If-Match': `"${version}"` },
        data,
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status(), body };
    },
  };
}

/**
 * The display payload with its first unit two officers short in every block
 * (the shape of GET /display/today: units[].coverage[] per block). The demo
 * dataset is fully covered today, so a short-staffed screen needs this.
 */
export function shortStaffed(body: {
  units?: {
    coverage?: {
      block: string;
      required: number;
      scheduled: { lowestHourly: number; shortHours: unknown[] };
      covered: boolean;
    }[];
  }[];
}): unknown {
  const ranges: Record<string, [string, string]> = {
    DAY: ['07:00', '15:00'],
    EVENING: ['15:00', '23:00'],
    NIGHT: ['23:00', '07:00'],
  };
  for (const block of body.units?.[0]?.coverage ?? []) {
    const count = Math.max(0, block.required - 2);
    const [from, to] = ranges[block.block] ?? ['00:00', '00:00'];
    block.scheduled.lowestHourly = count;
    block.scheduled.shortHours = [{ from, to, count }];
    block.covered = false;
  }
  return body;
}

/**
 * E4 locks the 9 - 22 Nov pay period, and a locked period refuses every
 * change in the demo week ("Unlock it with a reason to make changes"). Specs
 * that check or save a change there open it first, as move-cancel does.
 */
export async function openDemoWeekPeriod(api: Api, reason: string): Promise<void> {
  const periods = await api.get<{ id: string; from: string; to: string; status: string }[]>('/pay-periods');
  const period = periods.find((entry) => entry.from <= '2026-11-20' && entry.to >= '2026-11-22');
  if (period?.status === 'LOCKED') {
    const unlocked = await api.post(`/pay-periods/${period.id}/unlock`, { reason });
    expect(unlocked.status, 'unlock the demo-week pay period').toBe(200);
  }
}

export interface Unit {
  id: string;
  code: string;
  name: string;
}

export interface RuleResult {
  ruleCode: string;
  outcome: 'PASS' | 'WARN' | 'BLOCK';
  overridePolicy?: string;
}

export interface ScheduleOfficer {
  employeeId: string;
  name: string;
  cells: { date: string; items: { type: string }[] }[];
}

/**
 * Look for an empty cell whose proposed shift gets exactly the verdict a test
 * needs, by asking the api's rule-check preview (which saves nothing).
 */
export async function findCase(
  api: Api,
  unit: Unit,
  dates: string[],
  templates: string[],
  accept: (results: RuleResult[]) => boolean,
  skipNames: string[] = [],
): Promise<{ officer: ScheduleOfficer; date: string; template: string; results: RuleResult[] } | null> {
  const from = dates[0];
  const to = dates[dates.length - 1];
  const schedule = await api.get<{ officers: ScheduleOfficer[] }>(
    `/schedule?unitId=${unit.id}&from=${from}&to=${to}`,
  );
  for (const officer of schedule.officers) {
    if (skipNames.includes(officer.name)) continue;
    for (const date of dates) {
      const cell = officer.cells.find((entry) => entry.date === date);
      if (!cell || cell.items.length > 0) continue;
      for (const template of templates) {
        const start = template.startsWith('E') ? '15:00' : template.startsWith('N') ? '23:00' : '07:00';
        const preview = await api.post('/rule-checks', {
          change: {
            type: 'ASSIGN',
            employeeId: officer.employeeId,
            unitId: unit.id,
            shiftTemplate: template,
            startAt: `${date}T${start}:00-06:00`,
          },
        });
        if (preview.status !== 200) continue;
        const results = ((preview.body as { ruleResults?: RuleResult[] }).ruleResults ?? []).filter(
          (result) => result.outcome !== 'PASS',
        );
        if (accept(results)) return { officer, date, template, results };
      }
    }
  }
  return null;
}
