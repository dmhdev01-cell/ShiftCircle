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
}

/** A KPI tile (docs/ui/README.md §5.1): a label, a figure and a note. */
const TONE_COLOUR = {
  warn: colour.status.warn.text,
  pass: colour.status.pass.text,
  block: colour.status.block.text,
  info: colour.status.info.text,
} as const;

export function KpiTile({ label, value, note, tone, pill }: KpiTileProps) {
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
          {note}
        </Box>
      ) : null}
    </Box>
  );
}
