import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

import { colour } from '../theme/tokens';

export type StatusTone = 'under' | 'warn' | 'ot' | 'block' | 'pass' | 'info';

/**
 * A status pill (docs/ui/README.md §3.2). The tone is always carried by text
 * as well as colour - status is never shown by colour alone.
 */
export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const palette = colour.status[tone];

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        px: 2,
        borderRadius: '12px',
        backgroundColor: palette.bg,
        color: palette.text,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}
