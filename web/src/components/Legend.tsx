import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

import { colour } from '../theme/tokens';

/** One entry of a key: a sample chip or mark, then its words. */
export function LegendItem({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

/**
 * A key under a screen (docs/ui/README.md §1: chips and states always carry
 * words). The planning board has had one since the first build; My schedule
 * and Time & attendance had none, so a person had to guess what a chip or a
 * pill meant (observations #1 and #8).
 */
export function Legend({ title = 'Key', children }: { title?: string; children: ReactNode }) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px 16px',
        p: '12px 16px',
        borderTop: `1px solid ${colour.border.default}`,
        backgroundColor: colour.bg.surface,
        fontSize: 12,
        color: colour.text.secondary,
      }}
    >
      <Box component="span" sx={{ fontWeight: 600, color: colour.text.primary }}>
        {title}
      </Box>
      {children}
    </Box>
  );
}
