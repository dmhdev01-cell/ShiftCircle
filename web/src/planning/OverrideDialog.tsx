import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';

import { colour } from '../theme/tokens';

/** The reason has to be a real sentence, so it can be audited. */
export const MIN_REASON_LENGTH = 10;

interface OverrideDialogProps {
  open: boolean;
  /** The rules the override applies to, for example "U-01, U-05". */
  ruleCodes: string[];
  /** The warnings the override acknowledges with it. */
  warningCodes?: string[];
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * The emergency override dialog (docs/ui/README.md §5.1). An override always
 * needs a written reason: it is saved to the audit log and flagged in
 * reports. Nothing is auto-approved (HANDOFF.md §5.3).
 */
export function OverrideDialog({
  open,
  ruleCodes,
  warningCodes = [],
  onClose,
  onConfirm,
}: OverrideDialogProps) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < MIN_REASON_LENGTH;

  const confirm = () => {
    if (tooShort) return;
    onConfirm(reason.trim());
    setReason('');
  };

  const close = () => {
    setReason('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Emergency override</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          label="Why is this override needed?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          helperText={`At least ${MIN_REASON_LENGTH} characters. It is saved to the audit log and flagged in reports.`}
          error={reason.length > 0 && tooShort}
          sx={{ mt: 1 }}
        />
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: colour.text.secondary }}>
          {ruleCodes.length > 0
            ? `This overrides ${ruleCodes.join(', ')}. The rules are still recorded as broken.`
            : 'This overrides the rules that failed. They are still recorded as broken.'}
        </p>
        {warningCodes.length > 0 ? (
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: colour.text.secondary }}>
            The warnings are acknowledged with the override: {warningCodes.join(', ')}.
          </p>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={close}>
          Cancel
        </Button>
        <Button variant="outlined" color="error" onClick={confirm} disabled={tooShort}>
          Emergency override
        </Button>
      </DialogActions>
    </Dialog>
  );
}
