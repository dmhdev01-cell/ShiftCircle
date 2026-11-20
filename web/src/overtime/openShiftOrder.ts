import type { OpenShift } from '../api/types';

/** A shift still short of officers: what the board is for. */
export function isCurrentNeed(openShift: OpenShift, asOf: string | undefined): boolean {
  const open = openShift.status === 'OPEN' || openShift.status === 'OFFERS_SENT';
  return open && (asOf === undefined || openShift.date >= asOf);
}

/**
 * The cards in the order a supervisor wants them: the current needs first by
 * date, then everything else (filled, cancelled, past) newest first, so the
 * history is still there without pushing the job off the screen (V7).
 */
export function orderOpenShifts(
  shifts: OpenShift[],
  asOf: string | undefined,
): { current: OpenShift[]; others: OpenShift[] } {
  const current = shifts
    .filter((openShift) => isCurrentNeed(openShift, asOf))
    .sort((left, right) => left.date.localeCompare(right.date));
  const others = shifts
    .filter((openShift) => !isCurrentNeed(openShift, asOf))
    .sort((left, right) => right.date.localeCompare(left.date));
  return { current, others };
}
