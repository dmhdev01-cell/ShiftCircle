import Box from '@mui/material/Box';

import { colour } from '../theme/tokens';

interface KpiTileProps {
  label: string;
  value: string | number;
  note?: string;
}

/** A KPI tile (docs/ui/README.md §5.1): a label, a figure and a note. */
export function KpiTile({ label, value, note }: KpiTileProps) {
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
        sx={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: colour.text.primary }}
      >
        {value}
      </Box>
      {note ? (
        <Box component="span" sx={{ fontSize: 12, color: colour.text.muted }}>
          {note}
        </Box>
      ) : null}
    </Box>
  );
}
