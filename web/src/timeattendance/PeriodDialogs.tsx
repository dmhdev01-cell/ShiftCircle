import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { PayPeriod } from '../api/types';
import { colour } from '../theme/tokens';

/** The reason has to be a real sentence, so it can be audited. */
export const MIN_REASON_LENGTH = 10;

interface LockPeriodDialogProps {
  open: boolean;
  period: PayPeriod;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * The lock confirmation (docs/ui/build-notes.md §2.2). It repeats the totals
 * and says that the actuals become read-only.
 */
export function LockPeriodDialog({ open, period, onClose, onConfirm }: LockPeriodDialogProps) {
  const totals = period.totals;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Lock pay period</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          {totals
            ? `${totals.officers} officers · ${totals.workedHours.toLocaleString('en-CA')} worked h · ${totals.overtimeHours} overtime h`
            : period.label}
        </Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary, mt: 2 }}>
          Once the period is locked the actuals become read-only. The payroll export is taken from
          the locked figures.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" onClick={onConfirm}>
          Lock pay period
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface UnlockDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * The unlock dialog (docs/ui/build-notes.md §2.2). It asks for a reason,
 * because the unlock is recorded in the audit log.
 */
export function UnlockDialog({ open, onClose, onConfirm }: UnlockDialogProps) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < MIN_REASON_LENGTH;

  const close = () => {
    setReason('');
    onClose();
  };

  const confirm = () => {
    if (tooShort) return;
    onConfirm(reason.trim());
    setReason('');
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Unlock pay period</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary, mb: 2 }}>
          Unlocking recalculates pay codes. The earlier export stays on record.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          label="Why is this period being unlocked?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          helperText={`At least ${MIN_REASON_LENGTH} characters. It is saved to the audit log.`}
          error={reason.length > 0 && tooShort}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={close}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" onClick={confirm} disabled={tooShort}>
          Unlock
        </Button>
      </DialogActions>
    </Dialog>
  );
}
