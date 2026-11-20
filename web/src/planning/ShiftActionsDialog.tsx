import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import { shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow, RuleResult, ShiftItem } from '../api/types';
import { colour } from '../theme/tokens';
import { OverrideDialog } from './OverrideDialog';

interface ShiftActionsDialogProps {
  officer: OfficerRow;
  item: ShiftItem;
  unitId: string;
  onClose: () => void;
  /** Reload the board after the shift moved or was cancelled. */
  onChanged: () => void;
}

type Mode = 'choose' | 'move' | 'cancel';

/**
 * The rostered shift detail (docs/ui/README.md §5.1). Move and cancel use
 * PATCH and DELETE /assignments/{id} (docs/07 §4.2): the row's version goes in
 * If-Match, a stale version means reload, and a cancel needs a written reason.
 */
export function ShiftActionsDialog({
  officer,
  item,
  unitId,
  onClose,
  onChanged,
}: ShiftActionsDialogProps) {
  const template = shiftTemplates[item.shiftTemplate];
  const [mode, setMode] = useState<Mode>('choose');
  const [date, setDate] = useState(item.startAt.slice(0, 10));
  const [templateCode, setTemplateCode] = useState(item.shiftTemplate);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<RuleResult[] | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [stale, setStale] = useState(false);

  const warnCodes = (blocked ?? [])
    .filter((result) => result.outcome === 'WARN')
    .map((result) => result.ruleCode);
  const blocking = (blocked ?? []).filter((result) => result.outcome === 'BLOCK');
  // The api refuses an override unless every blocking rule allows one, so the
  // screen must not offer an override the api would reject (docs/07 §3).
  const canOverride =
    blocking.length > 0 && blocking.every((result) => result.overridePolicy === 'EMERGENCY');
  // Warnings are only acknowledged when nothing blocks the move.
  const canAcknowledge = blocking.length === 0 && warnCodes.length > 0;

  const finish = () => {
    onChanged();
    onClose();
  };

  const failure = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 422 && error.problem?.ruleResults) {
        setBlocked(error.problem.ruleResults);
        setMessage(error.problem.detail ?? error.problem.title ?? error.message);
        return;
      }
      if (error.status === 412 || error.status === 428) {
        setStale(true);
        setMessage(error.problem?.detail ?? 'The shift changed. Reload the board and try again.');
        return;
      }
      setMessage(error.problem?.detail ?? error.message);
      return;
    }
    setMessage(error instanceof Error ? error.message : 'The change failed.');
  };

  const move = async (overrideReason?: string) => {
    setBusy(true);
    setMessage(null);
    setStale(false);
    try {
      await api.moveAssignment(item.assignmentId, item.version, {
        change: {
          type: item.kind === 'EXTRA' ? 'EXTRA' : 'ASSIGN',
          employeeId: officer.employeeId,
          unitId,
          shiftTemplate: templateCode,
          startAt: `${date}T${shiftTemplates[templateCode].start}:00-06:00`,
        },
        ...(overrideReason
          ? {
              override: { reason: overrideReason },
              ...(warnCodes.length > 0 ? { acknowledgeWarnings: warnCodes } : {}),
            }
          : {}),
      });
      finish();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
      setOverrideOpen(false);
    }
  };

  const acknowledgeAndMove = () => {
    setBlocked(null);
    void moveWithWarnings();
  };

  const moveWithWarnings = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.moveAssignment(item.assignmentId, item.version, {
        change: {
          type: item.kind === 'EXTRA' ? 'EXTRA' : 'ASSIGN',
          employeeId: officer.employeeId,
          unitId,
          shiftTemplate: templateCode,
          startAt: `${date}T${shiftTemplates[templateCode].start}:00-06:00`,
        },
        acknowledgeWarnings: warnCodes,
      });
      finish();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setMessage(null);
    setStale(false);
    try {
      await api.cancelAssignment(item.assignmentId, item.version, reason.trim());
      finish();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const resetMode = () => {
    setMode('choose');
    setMessage(null);
    setBlocked(null);
    setStale(false);
  };

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

        {mode === 'choose' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
              Move this shift to another day, or cancel it with a written reason. Both are recorded
              in the audit log.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button variant="outlined" color="primary" onClick={() => setMode('move')}>
                Move…
              </Button>
              <Button
                variant="outlined"
                onClick={() => setMode('cancel')}
                sx={{ color: colour.status.block.text, borderColor: colour.status.block.text }}
              >
                Cancel shift…
              </Button>
            </Box>
          </Box>
        ) : mode === 'move' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="New date"
              type="date"
              size="small"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="Shift"
              size="small"
              value={templateCode}
              onChange={(event) => setTemplateCode(event.target.value)}
              slotProps={{ select: { native: true } }}
            >
              {Object.values(shiftTemplates).map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.start} – {option.end}
                  {option.endsNextDay ? ' +1' : ''}
                </option>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="contained" color="primary" disabled={busy} onClick={() => void move()}>
                Move shift
              </Button>
              <Button variant="outlined" color="primary" onClick={resetMode}>
                Back
              </Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Why is this shift cancelled?"
              size="small"
              multiline
              minRows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              helperText="At least 10 characters. The reason is recorded in the audit log."
            />
            <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
              The shift is kept in the audit trail. If it was filling an open shift, that shift goes
              back to open.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void cancel()}
                sx={{
                  backgroundColor: colour.status.block.text,
                  '&:hover': { backgroundColor: colour.status.block.text, opacity: 0.9 },
                }}
              >
                Cancel shift
              </Button>
              <Button variant="outlined" color="primary" onClick={resetMode}>
                Back
              </Button>
            </Box>
          </Box>
        )}

        {blocked && blocked.length > 0 ? (
          <Box
            role="status"
            sx={{
              mt: 2,
              p: '10px 12px',
              borderRadius: '8px',
              backgroundColor: colour.status.warn.bg,
              color: colour.status.warn.text,
              fontSize: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {blocked.map((result) => (
              <Box component="span" key={result.ruleCode}>
                <strong>{result.ruleCode}</strong> · {result.message}
              </Box>
            ))}
            {canOverride ? (
              <Box>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => setOverrideOpen(true)}
                  sx={{ mt: 1 }}
                >
                  Emergency override…
                </Button>
              </Box>
            ) : canAcknowledge ? (
              <Box>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={acknowledgeAndMove}
                  sx={{ mt: 1 }}
                >
                  Acknowledge warnings and move
                </Button>
              </Box>
            ) : null}
          </Box>
        ) : null}

        {message ? (
          <Box
            role="status"
            sx={{
              mt: 2,
              p: '10px 12px',
              borderRadius: '8px',
              backgroundColor: colour.status.block.bg,
              color: colour.status.block.text,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {message}
            {stale ? (
              <Box sx={{ mt: 1 }}>
                <Button variant="outlined" color="primary" onClick={finish}>
                  Reload the board
                </Button>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Close
        </Button>
      </DialogActions>

      <OverrideDialog
        open={overrideOpen}
        ruleCodes={blocking.map((result) => result.ruleCode)}
        warningCodes={warnCodes}
        onClose={() => setOverrideOpen(false)}
        onConfirm={(overrideReason) => {
          setOverrideOpen(false);
          void move(overrideReason);
        }}
      />
    </Dialog>
  );
}
