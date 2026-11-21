import type { StaffingReport } from '../api/types';
import { dateWords } from './unitDates';

export function staffingTile(report: StaffingReport): {
  value: string;
  note: string;
  tone: 'warn' | 'pass';
} {
  const worst = report.periods.reduce(
    (best, period) => (period.totals.short > best.totals.short ? period : best),
    report.periods[0],
  );
  const later = report.periods.length > 1 ? report.periods[report.periods.length - 1] : null;
  return {
    value: worst.totals.short > 0 ? `Short ${worst.totals.short}` : 'Enough',
    note: `${worst.totals.needed} needed · ${worst.totals.filled} on staff${
      later ? ` · from ${dateWords(later.from)}: ${later.totals.needed} needed` : ''
    }`,
    tone: worst.totals.short > 0 ? 'warn' : 'pass',
  };
}

