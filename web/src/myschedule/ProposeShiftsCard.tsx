import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import { PROPOSE_DRAFTS_PREFIX } from '../api/session';
import { assignableTemplates } from '../api/shiftTemplates';
import type { ProposalItemInput } from '../api/types';
import { useUnits } from '../api/useUnits';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import {
  MAX_DRAFTS,
  MAX_NOTE,
  PROPOSAL_HORIZON,
  draftResult,
  draftStartAt,
  nextDay,
  sendBlockedReason,
  shiftLine,
} from './proposalWords';
import type { DraftResult } from './proposalWords';

/** A shift the officer would like to work. Kept in this browser until sent. */
interface Draft {
  id: string;
  date: string;
  shiftTemplate: string;
  unitId: string;
  unitName: string;
}

type Check =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; results: DraftResult[] }
  | { kind: 'error'; message: string };

const storageKey = (employeeId: string) => `${PROPOSE_DRAFTS_PREFIX}${employeeId}`;

/** Drafts survive a refresh in this tab: a per-viewer convenience, never relied on. */
function loadDrafts(employeeId: string): Draft[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey(employeeId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is Draft =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Draft).id === 'string' &&
          typeof (entry as Draft).date === 'string' &&
          typeof (entry as Draft).shiftTemplate === 'string' &&
          typeof (entry as Draft).unitId === 'string' &&
          typeof (entry as Draft).unitName === 'string',
      )
      .slice(0, MAX_DRAFTS);
  } catch {
    return [];
  }
}

function saveDrafts(employeeId: string, drafts: Draft[]): void {
  try {
    if (drafts.length === 0) window.sessionStorage.removeItem(storageKey(employeeId));
    else window.sessionStorage.setItem(storageKey(employeeId), JSON.stringify(drafts));
  } catch {
    // Storage blocked or full: the drafts still work for this visit.
  }
}

function toInput(draft: Draft): ProposalItemInput {
  return {
    unitId: draft.unitId,
    shiftTemplate: draft.shiftTemplate,
    startAt: draftStartAt(draft.date, draft.shiftTemplate),
  };
}

/**
 * My schedule → Propose shifts (plan v1.3 §3.1). The officer drafts extra
 * shifts; every draft is rule-checked together with the others through
 * POST /proposals/preview, so two drafts too close together show it. A Blocked
 * draft can't be sent (owner Q3). Only a supervisor or the planner can approve.
 */
export function ProposeShiftsCard({
  employee,
  asOf,
  onSent,
}: {
  employee: { id: string; unit: { id: string; name: string } };
  asOf: string | undefined;
  onSent: () => void;
}) {
  const units = useUnits();
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(employee.id));
  // The answer for one exact set of drafts; any other set is still being checked.
  const [answer, setAnswer] = useState<
    { key: string; results: DraftResult[] } | { key: string; error: string } | null
  >(null);
  const [recheck, setRecheck] = useState(0);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const earliest = nextDay(asOf ?? '2026-11-19');
  const [newDate, setNewDate] = useState(() => nextDay(nextDay(earliest)));
  const [newTemplate, setNewTemplate] = useState('D8');
  const [newUnit, setNewUnit] = useState(employee.unit.id);
  const request = useRef(0);

  const draftsKey = `${recheck}:${JSON.stringify(drafts.map(toInput))}`;

  // One combined check whenever the drafts change; a late answer for an older
  // set of drafts is ignored.
  useEffect(() => {
    saveDrafts(employee.id, drafts);
    const ticket = ++request.current;
    if (drafts.length === 0) return;
    api
      .previewProposal(drafts.map(toInput))
      .then((preview) => {
        if (ticket !== request.current) return;
        const byIndex = new Map(preview.items.map((item) => [item.index, draftResult(item)]));
        const results = drafts.map(
          (_, index) =>
            byIndex.get(index) ?? { tone: 'info' as const, label: 'Not checked', stopsSend: true },
        );
        setAnswer({ key: draftsKey, results });
      })
      .catch((error: unknown) => {
        if (ticket !== request.current) return;
        setAnswer({
          key: draftsKey,
          error: error instanceof Error ? error.message : 'The rules could not be checked.',
        });
      });
  }, [drafts, draftsKey, employee.id]);

  const check: Check =
    drafts.length === 0
      ? { kind: 'idle' }
      : answer === null || answer.key !== draftsKey
        ? { kind: 'checking' }
        : 'error' in answer
          ? { kind: 'error', message: answer.error }
          : { kind: 'done', results: answer.results };

  const unitOptions =
    units.kind === 'ready' && units.units.length > 0
      ? units.units.map((unit) => ({ id: unit.id, name: unit.name }))
      : [{ id: employee.unit.id, name: employee.unit.name }];

  const addDraft = () => {
    const unit = unitOptions.find((option) => option.id === newUnit) ?? unitOptions[0];
    const id = `${newDate}-${newTemplate}-${unit.id}`;
    setSent(null);
    setSendError(null);
    setDrafts((current) =>
      [
        ...current.filter((draft) => draft.id !== id),
        { id, date: newDate, shiftTemplate: newTemplate, unitId: unit.id, unitName: unit.name },
      ].sort((a, b) =>
        draftStartAt(a.date, a.shiftTemplate).localeCompare(draftStartAt(b.date, b.shiftTemplate)),
      ),
    );
    setAdding(false);
  };

  const removeDraft = (id: string) => {
    setSendError(null);
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const results = check.kind === 'done' ? check.results : drafts.map(() => undefined);
  const blockedReason = sendBlockedReason({
    draftCount: drafts.length,
    checking: check.kind === 'checking',
    checkError: check.kind === 'error' ? check.message : null,
    results,
    noteLength: note.length,
  });

  const canCheckAgain =
    check.kind === 'error' ||
    (check.kind === 'done' && check.results.some((result) => result.label === 'Not checked'));

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      await api.submitProposal(note, drafts.map(toInput));
      setDrafts([]);
      setNote('');
      setSent("Sent to your supervisor. You'll see the answer under My proposals.");
      onSent();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The proposal could not be sent.');
      // The answer may have changed (a rule, a waiting duplicate): check again.
      setRecheck((count) => count + 1);
    } finally {
      setSending(false);
    }
  };

  const reasonId = 'propose-send-reason';
  const noteHelpId = 'propose-note-help';

  return (
    <Box
      component="section"
      id="propose"
      aria-label="Propose shifts"
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        scrollMarginTop: '80px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
          Propose shifts
        </Typography>
        <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary, lineHeight: 1.45 }}>
          Ask for extra shifts. Each one is checked against the rules together with your other
          drafts. Only a supervisor can approve an extra shift.
        </Box>
      </Box>

      {drafts.length > 0 ? (
        <Box component="ul" aria-label="Draft shifts" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {drafts.map((draft, index) => {
            const result = results[index];
            const what = shiftLine(draft.date, draft.shiftTemplate, draft.unitName);
            return (
              <Box
                component="li"
                key={draft.id}
                aria-label={what}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  p: '10px 12px',
                  border: `1px solid ${result?.stopsSend ? colour.status.block.border : colour.border.default}`,
                  borderRadius: '8px',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <Box component="span" sx={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {what}
                  </Box>
                  <Button
                    size="small"
                    variant="text"
                    color="primary"
                    onClick={() => removeDraft(draft.id)}
                    aria-label={`Remove ${what}`}
                    sx={{ minHeight: 32, flexShrink: 0, ml: 'auto' }}
                  >
                    Remove
                  </Button>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  {result ? (
                    <StatusPill tone={result.tone}>{result.label}</StatusPill>
                  ) : (
                    <StatusPill tone="info">{check.kind === 'error' ? 'Not checked' : 'Checking'}</StatusPill>
                  )}
                  {result?.why ? (
                    <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary, overflowWrap: 'anywhere' }}>
                      {result.why}
                    </Box>
                  ) : null}
                </Box>
                {drafts.length > 1 && result ? (
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                    Checked with your other drafts
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <Button
          variant="outlined"
          color="primary"
          onClick={() => {
            setSent(null);
            setAdding(true);
          }}
          disabled={drafts.length >= MAX_DRAFTS}
        >
          Add a shift
        </Button>
        {drafts.length >= MAX_DRAFTS ? (
          <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
            At most {MAX_DRAFTS} shifts in one proposal.
          </Box>
        ) : null}
      </Box>

      {drafts.length > 0 ? (
        <>
          <TextField
            label="Note to your supervisor (optional)"
            multiline
            minRows={2}
            fullWidth
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={note.length > MAX_NOTE}
            slotProps={{ htmlInput: { 'aria-describedby': noteHelpId } }}
          />
          <Box
            id={noteHelpId}
            component="span"
            sx={{
              mt: -2,
              fontSize: 12,
              color: note.length > MAX_NOTE ? colour.status.block.text : colour.text.secondary,
            }}
          >
            Don&apos;t include medical details. {note.length} of {MAX_NOTE} characters.
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              color="primary"
              onClick={() => void send()}
              disabled={blockedReason !== null || sending}
              aria-describedby={blockedReason ? reasonId : undefined}
            >
              {sending ? 'Sending…' : 'Send to supervisor'}
            </Button>
            {blockedReason ? (
              <Box id={reasonId} component="span" role="status" sx={{ fontSize: 13, color: colour.text.secondary }}>
                {blockedReason}
              </Box>
            ) : null}
            {canCheckAgain ? (
              // After a failed check (a 429 "try again in N seconds", the api
              // unreachable) nothing retries by itself: the officer asks again.
              <Button variant="text" color="primary" onClick={() => setRecheck((count) => count + 1)}>
                Check again
              </Button>
            ) : null}
          </Box>
        </>
      ) : null}

      {sendError ? (
        <Box
          role="alert"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.block.bg,
            color: colour.status.block.text,
            fontSize: 13,
          }}
        >
          Not sent: {sendError}
        </Box>
      ) : null}
      {sent ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.under.bg,
            color: colour.status.under.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {sent}
        </Box>
      ) : null}

      <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Add a shift</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
            The rules are checked as soon as you add the shift, together with your other drafts.
          </Typography>
          <TextField
            label="Date"
            type="date"
            fullWidth
            value={newDate}
            onChange={(event) => setNewDate(event.target.value)}
            sx={{ mb: 2, mt: 1 }}
            slotProps={{ htmlInput: { min: earliest, max: PROPOSAL_HORIZON } }}
          />
          <TextField
            label="Unit"
            select
            fullWidth
            value={newUnit}
            onChange={(event) => setNewUnit(event.target.value)}
            sx={{ mb: 2 }}
            slotProps={{ select: { native: true } }}
          >
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
                {unit.id === employee.unit.id ? ' (your unit)' : ''}
              </option>
            ))}
          </TextField>
          <Box role="group" aria-label="Shift" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {assignableTemplates.map((option) => (
              <Button
                key={option.code}
                variant={option.code === newTemplate ? 'contained' : 'outlined'}
                color="primary"
                aria-pressed={option.code === newTemplate}
                onClick={() => setNewTemplate(option.code)}
                sx={{ justifyContent: 'space-between' }}
              >
                <span>
                  {option.code} · {option.label}
                </span>
                <span className="num">
                  {option.start} – {option.end}
                  {option.endsNextDay ? ' +1' : ''}
                </span>
              </Button>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={addDraft}
            disabled={!newDate || newDate < earliest || newDate > PROPOSAL_HORIZON}
          >
            Add and check the rules
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
