import type { StaffingReport } from '../api/types';
import { dateWords } from './unitDates';

export interface StaffingTileWords {
  label: string;
  value: string;
  note: string;
  tone: 'warn' | 'info';
  pill: { tone: 'warn' | 'info'; text: string };
}

/**
 * The FLOOR wording (P4-UNIT-SPEC 4.4): the figure is the least staff the
 * minimums need, never a target; meeting it is never a pass, because the
 * planner's own gaps are the real test.
 */
export function staffingTile(report: StaffingReport): StaffingTileWords {
  const worst = report.periods.reduce(
    (best, period) => (period.totals.shortfall > best.totals.shortfall ? period : best),
    report.periods[0],
  );
  const later = report.periods.length > 1 ? report.periods[report.periods.length - 1] : null;
  const short = worst.totals.shortfall;
  return {
    label: 'Needed (at least)',
    value: String(worst.totals.needed),
    note: `${worst.totals.filled} on staff${short > 0 ? ` · short ${short}` : ''}${
      later ? ` · from ${dateWords(later.from)}: at least ${later.totals.needed}` : ''
    }`,
    tone: short > 0 ? 'warn' : 'info',
    pill: short > 0 ? { tone: 'warn', text: 'Short' } : { tone: 'info', text: 'Meets the floor' },
  };
}

/** The line under the tile row and the panel heading; the leave % is the api's. */
export function staffingFloorLine(leavePercent: number): string {
  return `"Needed (at least)" is the least staff the unit minimums need with ${leavePercent}% leave. The planner's own gaps are the real test: part-time and casual officers work fewer shifts, so a plan can still have gaps.`;
}

/** The tile's "What this means", in dev-design's words. */
export function staffingHelp(leavePercent: number): string {
  return `This is a floor, not a target. It counts the officers each unit needs to fill its minimum posts every day with ${leavePercent}% of staff on leave, as if every officer worked full-time. Part-time and casual officers work fewer shifts, leave comes in clumps, and officers mostly work in their home unit, so the real need is higher. The Coverage gaps tile shows whether this draft still leaves blocks short. On staff counts people, not hours. A closed unit needs no one while it's closed.`;
}

