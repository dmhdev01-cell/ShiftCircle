import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow, ShiftItem } from '../api/types';
import { colour } from '../theme/tokens';

interface ShiftActionsDialogProps {
  officer: OfficerRow;
  item: ShiftItem;
  onClose: () => void;
  /** The officer moves the shift to another day. */
  onMove: (startAt: string) => void;
  /** The officer cancels the shift. */
  onCancelShift: () => void;
}

/**
 * What to do with a shift (docs/ui/README.md §5.1): move it or cancel it.
 * Both go through the rules first, so the panel shows whether the change is
 * allowed before it is saved.
 */
export function ShiftActionsDialog({
  officer,
  item,
  onClose,
  onMove,
  onCancelShift,
}: ShiftActionsDialogProps) {
  const template = shiftTemplates[item.shiftTemplate];
  const [date, setDate] = useState(item.startAt.slice(0, 10));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
        {officer.name} · {template?.label ?? item.shiftTemplate}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
          Scheduled {item.startAt.slice(0, 10)} {template?.start} – {template?.end}. The rules are
          checked before the change is saved.
        </Typography>
        <TextField
          label="Move to"
          type="date"
          fullWidth
          value={date}
          onChange={(event) => setDate(event.target.value)}
          sx={{ mb: 2 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          color="primary"
          onClick={() => onMove(`${date}T${template?.start ?? '07:00'}:00-06:00`)}
        >
          Move the shift
        </Button>
        <Button variant="outlined" color="error" onClick={onCancelShift}>
          Cancel the shift
        </Button>
        <Button variant="text" color="primary" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
