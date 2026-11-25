import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import { assignableTemplates, shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow, RuleResult, ShiftItem } from '../api/types';
import { colour } from '../theme/tokens';
import { OverrideDialog } from './OverrideDialog';
import { nameWithPosition } from './supervisorPosts';
import {
  hasStarted,
  instantWords,
  knownRefusals,
  reginaParts,
  scheduledWords,
  startedWords,
  startWords,
  timeAttendanceLink,
} from './shiftWords';
import type { KnownRefusal } from './shiftWords';

interface ShiftActionsDialogProps {
  officer: OfficerRow;
  item: ShiftItem;
  unitId: string;
  /** v1.3 S6: the board unit's kind, so the title names a supervisor or an officer on a post. */
  unitKind?: string;
  /**
   * The business clock's "now" from the board (PR-O). With it the dialog says
   * up front when the api would refuse; without it the api's answer is shown.
   */
  now?: string;
  onClose: () => void;
  /** Reload the board after the shift moved or was cancelled. */
  onChanged: () => void;
}

type Mode = 'choose' | 'move' | 'cancel';

/** An answer from the api, in its own title and detail. */
interface Message {
  title?: string;
  detail: string;
}

/** The problem slugs that mean the board is out of date. */
const RELOAD_SLUGS = ['already-cancelled'];

function problemSlug(type: string | undefined): string {
  return type ? (type.split('/').pop() ?? '') : '';
}

/** The start instant a move would send: the date at the template's start, Regina time. */
function moveStartAt(date: string, templateCode: string): string {
  return `${date}T${shiftTemplates[templateCode].start}:00-06:00`;
}

/**
 * The rostered shift detail (docs/ui/README.md §5.1). Move and cancel use
 * PATCH and DELETE /assignments/{id} (docs/07 §4.2): the row's version goes in
 * If-Match, a stale version means reload, and a cancel needs a written reason.
 *
 * PR-O: the refusals the api can know before the request (the shift has
 * started, it has an actual or an absence, it fills an open shift) are said up
 * front and the refused action is not offered. The api still checks them all.
 */
export function ShiftActionsDialog({
  officer,
  item,
  unitId,
  unitKind,
  now,
  onClose,
  onChanged,
}: ShiftActionsDialogProps) {
  const template = shiftTemplates[item.shiftTemplate];
  const [mode, setMode] = useState<Mode>('choose');
  const [date, setDate] = useState(item.startAt.slice(0, 10));
  const [templateCode, setTemplateCode] = useState(item.shiftTemplate);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
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

  const refusals = knownRefusals(item, now);
  // A locked pay period or a started shift refuses both actions, with one notice.
  const shared = refusals.move && refusals.move === refusals.cancel ? refusals.move : null;
  const started = shared?.slug === 'shift-started';
  const timeAttendance = timeAttendanceLink(item, unitId);
  const notices: { refusal: KnownRefusal; action: string }[] = [];
  if (shared) {
    if (!started) notices.push({ refusal: shared, action: 'both' });
  } else {
    if (refusals.move) notices.push({ refusal: refusals.move, action: 'move' });
    if (refusals.cancel) notices.push({ refusal: refusals.cancel, action: 'cancel' });
  }
  const newStartAt = shiftTemplates[templateCode] && date ? moveStartAt(date, templateCode) : '';
  const targetStarted = newStartAt !== '' && hasStarted(newStartAt, now);
  // The native picker greys out the days before today; the check above names the reason.
  const minDate = now ? reginaParts(now)?.date : undefined;

  const finish = () => {
    onChanged();
    onClose();
  };

  const failure = (error: unknown) => {
    if (error instanceof ApiError) {
      const problem = error.problem;
      // The api's own words: the title says what happened, the detail what to do.
      const words: Message = {
        ...(problem?.title ? { title: problem.title } : {}),
        detail: problem?.detail ?? (problem?.title ? '' : error.message),
      };
      if (error.status === 422 && problem?.ruleResults) {
        setBlocked(problem.ruleResults);
        setMessage(words);
        return;
      }
      if (error.status === 412 || error.status === 428) {
        setStale(true);
        setMessage(
          problem ? words : { detail: 'The shift changed. Reload the board and try again.' },
        );
        return;
      }
      if (RELOAD_SLUGS.includes(problemSlug(problem?.type))) {
        setStale(true);
      }
      setMessage(words);
      return;
    }
    setMessage({ detail: error instanceof Error ? error.message : 'The change failed.' });
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
          startAt: moveStartAt(date, templateCode),
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
          startAt: moveStartAt(date, templateCode),
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
        {nameWithPosition(officer, { kind: unitKind })} · {template?.label ?? item.shiftTemplate}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
          Scheduled {scheduledWords(item.startAt, item.endAt)}
        </Typography>

        {started ? (
          <Box
            role="note"
            aria-label="This shift has started"
            sx={{
              mb: 2,
              p: '12px 14px',
              borderRadius: '8px',
              backgroundColor: colour.status.info.bg,
              color: colour.status.info.text,
              fontSize: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Box component="span">
              <strong>This shift started on {startedWords(item.startAt)}.</strong> Worked shifts
              are corrected in Time &amp; attendance.
            </Box>
            <Box>
              <Button component={RouterLink} to={timeAttendance} variant="outlined" color="primary">
                Open in Time &amp; attendance
              </Button>
            </Box>
          </Box>
        ) : null}

        {notices.map(({ refusal, action }) => (
          <Box
            key={action}
            role="note"
            aria-label={refusal.title}
            sx={{
              mb: 2,
              p: '12px 14px',
              borderRadius: '8px',
              backgroundColor: colour.status.info.bg,
              color: colour.status.info.text,
              fontSize: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Box component="span">
              <strong>{refusal.title}.</strong> {refusal.detail}
            </Box>
            {refusal.timeAndAttendance ? (
              <Box>
                <Button
                  component={RouterLink}
                  to={timeAttendance}
                  variant="outlined"
                  color="primary"
                >
                  Open in Time &amp; attendance
                </Button>
              </Box>
            ) : null}
          </Box>
        ))}

        {mode === 'choose' ? (
          refusals.move && refusals.cancel ? null : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                {refusals.move
                  ? 'Cancel this shift with a written reason. It is recorded in the audit log.'
                  : refusals.cancel
                    ? 'Move this shift to another day. The move is recorded in the audit log.'
                    : 'Move this shift to another day, or cancel it with a written reason. Both are recorded in the audit log.'}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {refusals.move ? null : (
                  <Button variant="outlined" color="primary" onClick={() => setMode('move')}>
                    Move…
                  </Button>
                )}
                {refusals.cancel ? null : (
                  <Button
                    variant="outlined"
                    onClick={() => setMode('cancel')}
                    sx={{ color: colour.status.block.text, borderColor: colour.status.block.text }}
                  >
                    Cancel shift…
                  </Button>
                )}
              </Box>
            </Box>
          )
        ) : mode === 'move' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="New date"
              type="date"
              size="small"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              error={targetStarted}
              helperText={
                !date || !newStartAt
                  ? 'The day the moved shift starts.'
                  : targetStarted
                    ? `${startWords(newStartAt)} has already started${now ? ` (it is now ${instantWords(now)})` : ''}. Pick a date and shift that start later.`
                    : `The moved shift starts ${startWords(newStartAt)}.`
              }
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: minDate ? { min: minDate } : {},
              }}
            />
            <TextField
              select
              label="Shift"
              size="small"
              value={templateCode}
              onChange={(event) => setTemplateCode(event.target.value)}
              slotProps={{ select: { native: true } }}
            >
              {assignableTemplates.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.start} – {option.end}
                  {option.endsNextDay ? ' next day' : ''}
                </option>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                color="primary"
                disabled={busy || targetStarted || !date}
                onClick={() => void move()}
              >
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
                  // White on the block red is 8.6:1; the theme's primary text colour
                  // on it was 1.04:1 (PR-O UI test P2, WCAG 1.4.3).
                  backgroundColor: colour.status.block.text,
                  color: colour.text.onDark,
                  '&:hover': {
                    backgroundColor: colour.status.block.text,
                    color: colour.text.onDark,
                    opacity: 0.9,
                  },
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
            {message.title ? (
              <Box component="span" sx={{ display: 'block', fontWeight: 700 }}>
                {message.title}
              </Box>
            ) : null}
            {message.detail ? (
              <Box component="span" sx={{ display: 'block', fontWeight: 500 }}>
                {message.detail}
              </Box>
            ) : null}
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
