import Box from '@mui/material/Box';

import type { BlockCoverage, ShortHourRange } from '../api/types';

function shortRangeLabel(range: ShortHourRange): string {
  const from = range.from.endsWith(':00') ? range.from.slice(0, -3) : range.from;
  const to = range.to.endsWith(':00') ? range.to.slice(0, -3) : range.to;
  return `${from}–${to}`;
}

interface CoverageCellProps {
  block: BlockCoverage;
  /** The demo "today", so the cell can say "on shift". */
  today: string;
}

const TONES = {
  ok: { bg: '#E8F1F8', text: '#00558C' },
  gap: { bg: '#FDF1B0', text: '#5A4500' },
  over: { bg: '#EEF0F2', text: '#333333' },
} as const;

/**
 * A coverage cell (docs/ui/build-notes.md §1.3). It shows the lowest hourly
 * headcount in the block over the requirement, and names the hours that fall
 * short - one number per block can hide a two-hour gap.
 */
export function CoverageCell({ block, today }: CoverageCellProps) {
  // Today and the days after it are shown as planned: the recorded actuals for
  // a day in progress are a handful of hours, and reading them as the day's
  // coverage said "0 / 5" at 10 a.m. for a shift that is 5/5. Past days keep
  // their actuals (V1).
  const showingActual = block.date < today && block.actual !== undefined;
  const shown = showingActual ? (block.actual ?? block.scheduled) : block.scheduled;
  const lowest = shown.lowestHourly;
  const over = lowest > block.required;
  const short = shown.shortHours.length > 0;
  const tone = over ? TONES.over : short ? TONES.gap : TONES.ok;

  let note: string;
  if (over) {
    note = `+${lowest - block.required} over`;
  } else if (short) {
    note = `short ${shown.shortHours.map(shortRangeLabel).join(', ')}`;
  } else if (showingActual) {
    const extra = block.actual?.maxHourly ? block.actual.maxHourly - block.required : 0;
    note = extra > 0 ? `✓ ${lowest} worked (${extra} extra)` : `✓ ${lowest} worked`;
  } else if (block.date === today) {
    note = 'on shift';
  } else {
    note = '';
  }

  const title = [
    `Lowest ${lowest} of ${block.required} required`,
    shown.shortHours.length > 0
      ? `Short ${shown.shortHours.map(shortRangeLabel).join(', ')}`
      : 'No short hours',
    shown.maxHourly ? `Peak ${shown.maxHourly}` : null,
    showingActual ? 'Actuals recorded' : 'Planned only',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box
      title={title}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: '6px 8px',
        borderRadius: '6px',
        backgroundColor: tone.bg,
        color: tone.text,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <Box className="num">
        {lowest} / {block.required}
      </Box>
      <Box component="small" sx={{ fontWeight: 500, fontSize: 11 }}>
        {note}
      </Box>
    </Box>
  );
}
