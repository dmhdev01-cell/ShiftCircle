import Box from '@mui/material/Box';

import type { BlockCoverage, ShortHourRange } from '../api/types';
import { colour, coverageTones } from '../theme/tokens';

function shortRangeLabel(range: ShortHourRange): string {
  const from = range.from.endsWith(':00') ? range.from.slice(0, -3) : range.from;
  const to = range.to.endsWith(':00') ? range.to.slice(0, -3) : range.to;
  return `${from}–${to}`;
}

interface CoverageCellProps {
  block: BlockCoverage;
  /** The demo "today", so the cell can say "on shift". */
  today: string;
  /**
   * The compact roster's heat cell: only "lowest/required" in the block's
   * colour; the short hours stay in the title and the accessible name.
   */
  compact?: boolean;
  /**
   * A2: open the gap-fill panel for this block-day. Given, a short cell for
   * today or later is a button; every other cell stays as it is.
   */
  onFill?: (block: BlockCoverage) => void;
  /** A2: this cell's gap is the one the fill panel shows. */
  selected?: boolean;
}

const BLOCK_NAME = { DAY: 'days', EVENING: 'evenings', NIGHT: 'nights' } as const;

function gapDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(parsed);
  return `${fmt({ weekday: 'short' })} ${fmt({ day: 'numeric' })} ${fmt({ month: 'short' })}`;
}

/**
 * A coverage cell (docs/ui/build-notes.md §1.3). It shows the lowest hourly
 * headcount in the block over the requirement, and names the hours that fall
 * short - one number per block can hide a two-hour gap.
 */
export function CoverageCell({
  block,
  today,
  compact = false,
  onFill,
  selected = false,
}: CoverageCellProps) {
  // Today and the days after it are shown as planned: the recorded actuals for
  // a day in progress are a handful of hours, and reading them as the day's
  // coverage said "0 / 5" at 10 a.m. for a shift that is 5/5. Past days keep
  // their actuals (V1).
  const showingActual = block.date < today && block.actual !== undefined;
  const shown = showingActual ? (block.actual ?? block.scheduled) : block.scheduled;
  const lowest = shown.lowestHourly;
  const over = lowest > block.required;
  const short = shown.shortHours.length > 0;
  // Heat (A1): one short reads yellow, two or more short orange.
  const tone = over
    ? coverageTones.over
    : short
      ? block.required - lowest >= 2
        ? coverageTones.gap2
        : coverageTones.gap
      : coverageTones.ok;

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

  // A2: a short block on a day still to come opens the fill panel.
  const fillable = onFill !== undefined && short && !showingActual && block.date >= today;
  const fillProps = fillable
    ? {
        component: 'button' as const,
        type: 'button' as const,
        onClick: () => onFill(block),
        'aria-pressed': selected,
        'aria-label': `Fill gap: ${gapDay(block.date)} ${BLOCK_NAME[block.block]}, ${lowest} of ${block.required}. ${title}`,
        title: `${title} · Fill this gap`,
      }
    : {};
  const fillSx = fillable
    ? {
        border: 0,
        fontFamily: 'inherit',
        cursor: 'pointer',
        outline: selected ? `2px solid ${colour.brand.primary}` : undefined,
        outlineOffset: '1px',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
        '&:hover': { boxShadow: `inset 0 0 0 1px ${tone.text}` },
        '&:focus-visible': { outline: `3px solid ${colour.brand.accent}`, outlineOffset: '1px' },
      }
    : {};

  if (compact) {
    return (
      <Box
        component="span"
        className="num"
        title={title}
        aria-label={`${lowest} of ${block.required}. ${title}`}
        {...fillProps}
        sx={{
          display: 'inline-block',
          minWidth: 34,
          px: 0.5,
          py: '1px',
          borderRadius: '4px',
          backgroundColor: tone.bg,
          color: tone.text,
          fontSize: 11,
          fontWeight: 700,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          ...fillSx,
        }}
      >
        {lowest}/{block.required}
      </Box>
    );
  }

  return (
    <Box
      title={title}
      {...fillProps}
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
        ...(fillable ? { width: '100%', textAlign: 'left' } : {}),
        ...fillSx,
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
