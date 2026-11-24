import type { DemoUser, PayPeriod, Unit } from '../api/types';
import { addDays, dateWords } from '../planner/unitDates';

export type ReportTab = 'coverage' | 'hours' | 'overtime' | 'overrides';

export interface DateRange {
  from: string;
  to: string;
}

/**
 * The longest range a report may span, in days between From and To. The api
 * refuses anything longer with 400 (ReportsService.MAX_DAYS); the screen says
 * so before asking.
 */
export const MAX_RANGE_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      (24 * 3600 * 1000),
  );
}

/**
 * The range each report reads when the request names none: the same rules as
 * ReportsService, so the inputs show what the report on screen covers.
 * Undefined when the screen cannot know (no demo "today" from the api yet).
 */
export function defaultRange(
  tab: ReportTab,
  asOf: string | undefined,
  payPeriods?: PayPeriod[],
): DateRange | undefined {
  if (!asOf || !isIsoDate(asOf)) return undefined;
  switch (tab) {
    case 'coverage': {
      // Five weeks back from this week's Monday to the end of next week.
      const weekday = new Date(`${asOf}T00:00:00Z`).getUTCDay();
      const monday = addDays(asOf, -((weekday + 6) % 7));
      return { from: addDays(monday, -35), to: addDays(monday, 13) };
    }
    case 'hours': {
      // The last locked pay period, else the one today falls in. Unknown until
      // the periods are read.
      if (!payPeriods) return undefined;
      const locked = payPeriods
        .filter((period) => period.status === 'LOCKED')
        .sort((a, b) => b.to.localeCompare(a.to))[0];
      const current = payPeriods.find((period) => period.from <= asOf && asOf <= period.to);
      const period = locked ?? current;
      return period ? { from: period.from, to: period.to } : { from: addDays(asOf, -13), to: asOf };
    }
    case 'overtime': {
      // The quarter so far.
      const firstMonth = Math.floor((Number(asOf.slice(5, 7)) - 1) / 3) * 3 + 1;
      return { from: `${asOf.slice(0, 4)}-${String(firstMonth).padStart(2, '0')}-01`, to: asOf };
    }
    case 'overrides':
      // The last four weeks.
      return { from: addDays(asOf, -27), to: asOf };
  }
}

/** Why the range cannot be used, in the screen's words, or null when it can. */
export function rangeProblem(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both a From and a To date.';
  if (!isIsoDate(from)) return 'The From date is not a valid date.';
  if (!isIsoDate(to)) return 'The To date is not a valid date.';
  if ([from, to].some((date) => date < '1900-01-01' || date > '2999-12-31')) {
    return 'Choose dates between 1900 and 2999.';
  }
  if (to < from) return 'The To date must be on or after the From date.';
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return `The To date can be at most ${MAX_RANGE_DAYS} days after the From date. Choose a shorter range.`;
  }
  return null;
}

/** "1 Oct 2026 – 29 Dec 2026" */
export function rangeWords(range: DateRange): string {
  return `${dateWords(range.from)} – ${dateWords(range.to)}`;
}

/**
 * The units the signed-in person may report on, as ReportsService decides:
 * an auditor reads every unit (the account carries no codes), anyone else the
 * codes their account carries. Without a signed-in user (the fixtures role
 * switch) every unit is offered and the api still checks.
 */
export function unitsInScope(units: Unit[], user: DemoUser | null): Unit[] {
  if (!user || user.roles.includes('AUDITOR')) return units;
  return units.filter((unit) => user.units.includes(unit.code));
}
