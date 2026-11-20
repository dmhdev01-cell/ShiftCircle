import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

import { shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow, ShiftItem } from '../api/types';
import { colour } from '../theme/tokens';

interface ShiftActionsDialogProps {
  officer: OfficerRow;
  item: ShiftItem;
  onClose: () => void;
}

/**
 * The rostered shift detail (docs/ui/README.md §5.1).
 *
 * Moving and cancelling a rostered shift are api capabilities that are not
 * built yet: docs/07 §4.2 lists `PATCH` and `DELETE /assignments/{id}`, but the
 * api only has `POST /assignments`. The screen says so instead of sending a
 * move as a new assignment, which would silently create a second shift.
 */
export function ShiftActionsDialog({ officer, item, onClose }: ShiftActionsDialogProps) {
  const template = shiftTemplates[item.shiftTemplate];

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
        {officer.name} · {template?.label ?? item.shiftTemplate}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
          Scheduled {item.startAt.slice(0, 10)} {template?.start} – {template?.end}
          {template?.endsNextDay ? ' +1' : ''}.
        </Typography>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
          Moving or cancelling a rostered shift is not available yet: the api has no endpoint for it,
          and this screen will not pretend that it does.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
