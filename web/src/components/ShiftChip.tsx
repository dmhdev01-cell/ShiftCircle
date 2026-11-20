import Box from '@mui/material/Box';

import { shiftChipExtra, shiftChips } from '../theme/tokens';
import type { ShiftCode } from '../theme/tokens';

interface ShiftChipProps {
  code: ShiftCode;
  /** Picked up beyond the roster - an extra (overtime) shift. */
  extra?: boolean;
  /** An actual was recorded for this shift. */
  worked?: boolean;
}

/**
 * A shift chip (docs/ui/README.md §3.2). The chip is always labelled with
 * text, never colour alone.
 */
export function ShiftChip({ code, extra = false, worked = false }: ShiftChipProps) {
  const chip = shiftChips[code];
  const background = extra ? shiftChipExtra.bg : chip.bg;
  const color = extra ? shiftChipExtra.text : chip.text;

  return (
    <Box
      component="span"
      title={chip.title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        minWidth: 52,
        height: 30,
        px: 2,
        borderRadius: 6,
        backgroundColor: background,
        color,
        fontSize: 12,
        fontWeight: 600,
        boxSizing: 'border-box',
        whiteSpace: 'nowrap',
        border: chip.border ? `1px ${chip.borderStyle ?? 'solid'} ${chip.border}` : 'none',
      }}
    >
      {worked ? '✓ ' : ''}
      {chip.label}
      {extra ? ' · extra' : ''}
    </Box>
  );
}
