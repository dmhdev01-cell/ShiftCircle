import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';

interface KpiTileProps {
  label: string;
  value: string | number;
  note?: string;
  /** Optional colour for the figure (the staffing tile says Short in warn). */
  tone?: 'warn' | 'pass' | 'block' | 'info';
  /** An optional status pill under the figure (the staffing floor's state). */
  pill?: { tone: 'warn' | 'pass' | 'info' | 'block'; text: string };
  /**
   * 'tile' (default) is the full card. 'chip' is the compact board's strip
   * (A1): the same label, figure and note on one line, about a quarter of the
   * height, so more roster rows fit above the fold.
   */
  variant?: 'tile' | 'chip';
  /** Chip only: tint the chip as a warning (a gap count above zero). */
  highlight?: boolean;
  /**
   * A2: what the note shows, when it holds more than words (the gap words as
   * buttons). `note` stays the plain text for the chip's title.
   */
  noteContent?: ReactNode;
}

/** A KPI tile (docs/ui/README.md §5.1): a label, a figure and a note. */
const TONE_COLOUR = {
  warn: colour.status.warn.text,
  pass: colour.status.pass.text,
  block: colour.status.block.text,
  info: colour.status.info.text,
} as const;

export function KpiTile({
  label,
  value,
  note,
  tone,
  pill,
  variant = 'tile',
  highlight = false,
  noteContent,
}: KpiTileProps) {
  if (variant === 'chip') {
    return (
      <Box
        title={note ? `${label}: ${note}` : label}
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 1,
          maxWidth: '100%',
          minHeight: 28,
          boxSizing: 'border-box',
          p: '3px 12px',
          backgroundColor: highlight ? colour.status.warn.bg : colour.bg.surface,
          border: `1px solid ${highlight ? '#E8CF55' : colour.border.default}`,
          borderRadius: '999px',
          fontSize: 12,
          color: colour.text.secondary,
        }}
      >
        <Box
          className="num"
          component="span"
          sx={{ fontSize: 14, fontWeight: 700, color: tone ? TONE_COLOUR[tone] : colour.text.primary }}
        >
          {value}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: colour.text.primary, whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        {note ? (
          <Box
            component="span"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            · {noteContent ?? note}
          </Box>
        ) : null}
      </Box>
    );
  }
  return (
    <Box
      sx={{
        flex: '1 1 170px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: '14px 16px',
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
      }}
    >
      <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
        {label}
      </Box>
      <Box
        className="num"
        component="span"
        sx={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.1,
          color: tone ? TONE_COLOUR[tone] : colour.text.primary,
        }}
      >
        {value}
      </Box>
      {pill ? (
        <Box>
          <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
        </Box>
      ) : null}
      {note ? (
        <Box component="span" sx={{ fontSize: 12, color: colour.text.muted }}>
          {noteContent ?? note}
        </Box>
      ) : null}
    </Box>
  );
}
