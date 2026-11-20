import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';

interface PublishPeriodButtonProps {
  /** The roster week the board shows (docs/07 §4.2). */
  period: { id: string; label: string; status: 'DRAFT' | 'PUBLISHED' };
  /** Reload the board, so the header shows the published state. */
  onPublished: () => void;
}

/**
 * The supervisor's publish action (docs/07 §4.2).
 *
 * Publishing tells the officers the roster is final. It is one-way in the
 * prototype: a correction is a further assignment, and the board shows it as an
 * unpublished change. The publication is written to the audit log, and the api
 * refuses a second publish with a conflict.
 */
export function PublishPeriodButton({ period, onPublished }: PublishPeriodButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'pass' | 'block'>('pass');

  const published = period.status === 'PUBLISHED';

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.publishSchedulePeriod(period.id);
      setOpen(false);
      setTone('pass');
      setMessage('Published. The officers see this roster as final.');
      onPublished();
    } catch (error) {
      setOpen(false);
      if (error instanceof ApiError && error.status === 409) {
        setTone('block');
        setMessage('This period is already published.');
        onPublished();
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setTone('block');
        setMessage('That period is not in your unit.');
        return;
      }
      setTone('block');
      setMessage(
        error instanceof Error ? error.message : 'The period could not be published.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Button
        variant="contained"
        color="primary"
        disabled={published || busy}
        onClick={() => setOpen(true)}
      >
        {busy ? 'Publishing…' : 'Publish period'}
      </Button>

      {published ? (
        <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
          Published. A correction is a further assignment.
        </Typography>
      ) : null}

      {message ? (
        <Typography
          role="status"
          sx={{
            fontSize: 12,
            fontWeight: 600,
            color: tone === 'pass' ? colour.status.pass.text : colour.status.block.text,
          }}
        >
          {message}
        </Typography>
      ) : null}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
          Publish the roster for {period.label}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <StatusPill tone="info">
              {period.status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </StatusPill>
          </Box>
          <Typography sx={{ fontSize: 14, mb: 2 }}>
            Publishing tells the officers in this unit that the roster is final. The board keeps
            showing later changes as unpublished.
          </Typography>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 1 }}>
            In this prototype publishing is one-way: it cannot be undone. A correction is a further
            assignment, and the reason for any emergency override is recorded in the audit log.
          </Typography>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
            Your name and the time are recorded in the audit log.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="contained" color="primary" disabled={busy} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish period'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
