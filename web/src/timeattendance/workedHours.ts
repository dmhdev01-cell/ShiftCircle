import type { TimeEntry } from '../api/types';

/**
 * The hours actually worked. A shift with no recorded actual has worked none
 * yet: falling back to the planned times made a future period read as if every
 * hour had been worked (V3). Scheduled hours are counted from the roster
 * separately.
 */
export function workedOf(entry: TimeEntry): number {
  if (!entry.actualStart || !entry.actualEnd) return 0;
  const start = new Date(entry.actualStart).getTime();
  const end = new Date(entry.actualEnd).getTime();
  return Math.round(((end - start) / 3_600_000) * 4) / 4;
}
