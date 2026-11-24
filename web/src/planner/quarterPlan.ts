import type { PlannerGap, PlannerScorecard, PlannerWarningGroup } from '../api/types';

/**
 * A7: the Gaps tab groups short block-days into runs: the same unit and block
 * on consecutive days ("Escort & transport · Evenings · Wed 13 – Sun 17 Jan ·
 * 5 days"). Pure functions, so the page and its tests share them.
 */
export interface GapRun {
  unitId: string;
  unitName: string;
  block: PlannerGap['block'];
  from: string;
  to: string;
  gaps: PlannerGap[];
}

const BLOCK_ORDER: Record<string, number> = { DAY: 0, EVENING: 1, NIGHT: 2 };

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Runs in the order a supervisor reads them: by date, then unit, then block. */
export function gapRuns(gaps: PlannerGap[]): GapRun[] {
  const sorted = [...gaps].sort(
    (a, b) =>
      a.unitName.localeCompare(b.unitName) ||
      (BLOCK_ORDER[a.block] ?? 9) - (BLOCK_ORDER[b.block] ?? 9) ||
      a.date.localeCompare(b.date),
  );
  const runs: GapRun[] = [];
  for (const gap of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.unitId === gap.unitId && last.block === gap.block && nextDay(last.to) === gap.date) {
      last.to = gap.date;
      last.gaps.push(gap);
    } else {
      runs.push({ unitId: gap.unitId, unitName: gap.unitName, block: gap.block, from: gap.date, to: gap.date, gaps: [gap] });
    }
  }
  return runs.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.unitName.localeCompare(b.unitName) ||
      (BLOCK_ORDER[a.block] ?? 9) - (BLOCK_ORDER[b.block] ?? 9),
  );
}

/** "1", "1–2": how many officers short across the run. */
export function shortWords(run: GapRun): string {
  const shorts = run.gaps.map((gap) => Math.max(0, gap.required - gap.placed));
  const min = Math.min(...shorts);
  const max = Math.max(...shorts);
  return min === max ? `${min}` : `${min}–${max}`;
}

/** "3 / 4", or "2–3 / 4" when the run's days differ. */
export function staffedWords(run: GapRun): string {
  const range = (values: number[]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? `${min}` : `${min}–${max}`;
  };
  return `${range(run.gaps.map((gap) => gap.placed))} / ${range(run.gaps.map((gap) => gap.required))}`;
}

const BLOCK_PEOPLE: Record<string, string> = { DAY: 'day', EVENING: 'evening', NIGHT: 'night' };

/** The api's one reason, said plainly; any other reason is shown as sent. */
export function reasonWords(run: GapRun): string {
  const reason = run.gaps[0]?.reason ?? null;
  if (reason === null) return '—';
  if (reason.startsWith('No eligible officer left without a Block rule')) {
    return `Not enough ${BLOCK_PEOPLE[run.block] ?? ''} officers in ${run.unitName} without breaking a rest or hours rule. A supervisor fills it on the planning board.`;
  }
  return reason;
}

/** A6/A7: the Monday of every week in the quarter window. */
export function quarterWeeks(from: string, to: string): string[] {
  const monday = (date: string) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
    return parsed.toISOString().slice(0, 10);
  };
  const weeks: string[] = [];
  const last = monday(to);
  for (let week = monday(from); week <= last; ) {
    weeks.push(week);
    const next = new Date(`${week}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    week = next.toISOString().slice(0, 10);
  }
  return weeks;
}

/**
 * A8: the draft's rule warnings keyed by officer name, date and shift code, so
 * a chip can carry its own ⚠. The api names the shift by its template code
 * (older fixtures add the times after a space).
 */
export function warningIndex(groups: PlannerWarningGroup[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of groups) {
    for (const item of group.items) {
      const key = `${item.employeeName}|${item.date}|${item.shift.split(' ')[0]}`;
      const words = `${group.ruleName}: ${item.message}`;
      const known = index.get(key);
      index.set(key, known ? `${known}; ${words}` : words);
    }
  }
  return index;
}

/**
 * The part-time line (fit-gap i-6): the hours part-time officers were planned
 * against their FTE target, from the scorecard's own FTE bands. Null when the
 * dataset has no part-time officers.
 */
export function partTimeCapacity(
  scorecard: PlannerScorecard,
): { planned: number; target: number; unused: number } | null {
  const bands = (scorecard.fteBands?.bands ?? []).filter((band) => band.band !== 'FULL_TIME');
  if (bands.length === 0) return null;
  const planned = Math.round(bands.reduce((sum, band) => sum + band.officers * band.plannedAvg, 0));
  const target = Math.round(bands.reduce((sum, band) => sum + band.officers * band.targetHours, 0));
  return { planned, target, unused: Math.max(0, target - planned) };
}
