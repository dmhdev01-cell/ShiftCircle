import Box from '@mui/material/Box';

import { chipTextFor, formatShiftTimes, shiftTemplates } from '../api/shiftTemplates';
import {
  absenceChipStyles,
  extraChipStyle,
  offChipStyle,
  offerChipStyle,
  proposedChipStyle,
  shiftChipStyles,
} from '../theme/tokens';
import type { ChipStyle } from '../theme/tokens';

function chipBox(style: ChipStyle) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    minWidth: 52,
    height: 30,
    px: 2,
    borderRadius: '6px',
    backgroundColor: style.bg,
    color: style.text,
    fontSize: 12,
    fontWeight: 600,
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
    border: style.border ? `1px ${style.borderStyle ?? 'solid'} ${style.border}` : 'none',
  } as const;
}

interface ShiftChipProps {
  /** Shift template code, e.g. D8, A12, P12, L16. */
  template: string;
  /** Picked up beyond the roster. */
  extra?: boolean;
  /** An actual was recorded for this shift. */
  worked?: boolean;
  /** Offered as overtime, not answered yet. */
  offer?: boolean;
  /** Proposed, and the rules blocked it. */
  proposed?: boolean;
}

/**
 * A shift chip (docs/ui/README.md §3.2, docs/ui/build-notes.md §1.1). The chip
 * always carries text, never colour alone. Overtime is never a chip: an extra
 * shift shows the template chip with "· extra", and the officer's overtime
 * state is the pay-period status pill.
 */
export function ShiftChip({
  template,
  extra = false,
  worked = false,
  offer = false,
  proposed = false,
}: ShiftChipProps) {
  const text = chipTextFor(template);

  let style = shiftChipStyles[template] ?? shiftChipStyles.D8;
  let label = text;
  if (extra) {
    style = extraChipStyle;
    label = `${text} · extra`;
  }
  if (offer) {
    style = offerChipStyle;
    label = `${text} · offer`;
  }
  if (proposed) {
    style = proposedChipStyle;
    label = `! ${text} proposed`;
  }

  const times = formatShiftTimes(template);
  const what = shiftTemplates[template]?.label ?? template;

  return (
    <Box component="span" title={`${what} · ${times}`} sx={chipBox(style)}>
      {worked ? '✓ ' : ''}
      {label}
    </Box>
  );
}

/** An absence: sick or vacation. */
export function AbsenceChip({ absenceType }: { absenceType: string }) {
  const style = absenceChipStyles[absenceType] ?? absenceChipStyles.SICK;
  const label = absenceType === 'VACATION' ? 'Vac' : 'Sick';

  return (
    <Box component="span" title={label} sx={chipBox(style)}>
      {label}
    </Box>
  );
}

/** A day off. */
export function OffChip() {
  return (
    <Box component="span" title="Off" sx={chipBox(offChipStyle)}>
      Off
    </Box>
  );
}
