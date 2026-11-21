import type { CoverageWeek } from '../api/types';

/**
 * The bar's two segments as percentages of the chart height, from the same
 * axis the bars sit on: regular shifts below, the extra shifts that covered the
 * rest above (observation 31).
 */
export function barSegments(
  week: CoverageWeek,
  axisFrom: number,
  axisTo: number,
): { regular: number; extra: number } {
  const span = axisTo - axisFrom;
  const extraPercent = week.extraPercent ?? 0;
  const regularPercent = week.scheduledPercent - extraPercent;
  return {
    regular: Math.max(0, ((regularPercent - axisFrom) / span) * 100),
    extra: Math.max(0, (extraPercent / span) * 100),
  };
}

/**
 * One sentence over the weeks shown, in dev-design's templates (observation
 * 31): how many weeks leaned on extra shifts, the highest, and what would have
 * happened without them. One decimal, earliest week on a tie.
 */
export function coverageSummary(weeks: CoverageWeek[]): string {
  const extra = weeks.filter((week) => (week.extraPercent ?? 0) > 0);
  if (extra.length === 0) return "No week's coverage came from extra shifts.";

  const top = extra.reduce((best, week) =>
    (week.extraPercent ?? 0) > (best.extraPercent ?? 0) ? week : best,
  );
  const head = `In ${extra.length} of ${weeks.length} weeks, part of the coverage came from extra shifts (overtime), up to ${(top.extraPercent ?? 0).toFixed(
    1,
  )}% of the required hours in the week of ${top.label}.`;

  // Only weeks that reached 100% can have reached it because of extra shifts;
  // a week already under 100% is not one they saved.
  const reached = extra.filter((week) => week.scheduledPercent >= 100);
  if (reached.length === 0) return head;
  const onlyBecause = reached.filter(
    (week) => week.scheduledPercent - (week.extraPercent ?? 0) < 100,
  ).length;
  const tail =
    onlyBecause === 0
      ? ' Every week that reached 100% would have reached it without them.'
      : onlyBecause === 1
        ? ' 1 week reached 100% only because of them.'
        : ` ${onlyBecause} weeks reached 100% only because of them.`;
  return head + tail;
}

