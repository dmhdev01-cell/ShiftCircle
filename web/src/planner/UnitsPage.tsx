import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import { api } from '../api/client';
import type { PlannerUnit, UnitClosure } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { useRole } from '../shell/nav';
import { colour } from '../theme/tokens';
import { createdAtWords, dateWords, weekdayDateWords } from './unitDates';

/**
 * Units (release 3): close a unit from a date, optionally reopen it, and edit
 * the allocated headcount. Everything a person can see is the api's words and
 * numbers; the web formats, it does not decide dates or staffing.
 */

type DialogState =
  | { kind: 'none' }
  | { kind: 'close'; unit: PlannerUnit }
  | { kind: 'change'; unit: PlannerUnit; closure: UnitClosure }
  | { kind: 'reopen'; unit: PlannerUnit; closure: UnitClosure }
  | { kind: 'remove'; unit: PlannerUnit; closure: UnitClosure }
  | { kind: 'allocated'; unit: PlannerUnit };

function shortName(unit: PlannerUnit): string {
  return unit.name.split(' · ')[0];
}

function closureWords(closure: UnitClosure): string {
  return closure.reopensOn
    ? `Closed from ${dateWords(closure.closedFrom)} · reopens ${dateWords(closure.reopensOn)}`
    : `Closed from ${dateWords(closure.closedFrom)} · no reopening date set`;
}

export function UnitsPage() {
  const { role } = useRole();
  const [units, setUnits] = useState<PlannerUnit[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [status, setStatus] = useState<string | null>(null);
  const [shownPast, setShownPast] = useState<Record<string, boolean>>({});

  const load = useCallback(async (showLoading = false) => {
    // The mount effect runs with the initial 'loading' state; a retry or a save
    // asks for the loading line, and events may set state synchronously.
    if (showLoading) setState('loading');
    try {
      setUnits(await api.getPlannerUnits());
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (role.id !== 'PLANNER') return;
    // The first load lives in the effect (async answers only); load() is for
    // retries and saves, where a synchronous loading state is fine.
    let active = true;
    void api
      .getPlannerUnits()
      .then((next) => {
        if (!active) return;
        setUnits(next);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [role.id]);

  if (role.id !== 'PLANNER') {
    return (
      <Card>
        <CardContent sx={{ p: 4 }}>
          <Typography sx={{ fontSize: 14 }}>
            Only the facility planner can close or reopen a unit.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">Units</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          Prairie Provincial Correctional Centre · {units?.length ?? 0} units
        </Typography>
        <Typography sx={{ fontSize: 14 }}>
          Close a unit from a date when it won&apos;t be staffed, for example for a renovation.
          From that date the unit needs no staff, gets no roster and shows no coverage gaps in new
          drafts. Its officers stay employed and work as relief in other units. Nothing already
          worked or published is deleted.
        </Typography>
      </Box>

      {status ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.pass.bg,
            color: colour.status.pass.text,
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          {status}
          {status.includes('Generate a new draft') ? (
            <Button component={RouterLink} to="/planner" variant="text" size="small">
              Go to Quarter plan
            </Button>
          ) : null}
        </Box>
      ) : null}

      {state === 'loading' ? (
        <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
          Loading units…
        </Typography>
      ) : null}
      {state === 'error' ? (
        <Box role="alert" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ fontSize: 14, color: colour.status.block.text }}>
            The units could not be loaded. Try again, or reload the page.
          </Typography>
          <Box>
            <Button variant="outlined" color="primary" onClick={() => void load(true)}>
              Try again
            </Button>
          </Box>
        </Box>
      ) : null}

      {state === 'ready' && units ? (
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <caption
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Units, their closures and staff numbers
                </caption>
                <thead>
                  <tr>
                    {['Unit', 'Today', 'Closures', 'Allocated', 'On staff', ''].map((heading, index) => (
                      <th
                        key={heading || index}
                        scope="col"
                        style={{
                          textAlign: 'left',
                          padding: '6px 8px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: colour.text.secondary,
                          borderBottom: `1px solid ${colour.border.default}`,
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => {
                    const openEnded = unit.closures.some((closure) => closure.reopensOn === null);
                    const ended = unit.closures.filter((closure) => closure.state === 'ENDED');
                    const current = unit.closures.filter((closure) => closure.state !== 'ENDED');
                    const pastShown = shownPast[unit.id] === true;
                    return (
                      <tr key={unit.id} style={{ verticalAlign: 'top' }}>
                        <td style={{ padding: '10px 8px', fontWeight: 600, borderBottom: `1px solid ${colour.border.default}` }}>
                          {unit.name}
                        </td>
                        <td style={{ padding: '10px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                          {unit.today === 'OPEN' ? <StatusPill tone="pass">Open</StatusPill> : null}
                          {unit.today === 'CLOSED' ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              <StatusPill tone="warn">Closed</StatusPill>
                              {unit.todayNote ? (
                                <span style={{ fontSize: 12, color: colour.text.secondary }}>{unit.todayNote}</span>
                              ) : null}
                            </Box>
                          ) : null}
                          {unit.today === 'SWITCHED_OFF' ? <StatusPill tone="info">Switched off</StatusPill> : null}
                        </td>
                        <td style={{ padding: '10px 8px', borderBottom: `1px solid ${colour.border.default}`, minWidth: 260 }}>
                          {unit.closures.length === 0 && ended.length === 0 ? <span>None</span> : null}
                          {current.map((closure) => (
                            <Box key={closure.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                              <span>{closureWords(closure)}</span>
                              <span style={{ fontSize: 13, color: colour.text.secondary }}>
                                &quot;{closure.reason}&quot; · {closure.createdBy} · {createdAtWords(closure.createdAt)}
                              </span>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {closure.state === 'FUTURE' ? (
                                  <>
                                    <Button size="small" variant="text" onClick={() => setDialog({ kind: 'change', unit, closure })}>
                                      Change…
                                    </Button>
                                    <Button size="small" variant="text" onClick={() => setDialog({ kind: 'remove', unit, closure })}>
                                      Remove…
                                    </Button>
                                  </>
                                ) : null}
                                {closure.state === 'CURRENT' && closure.reopensOn === null ? (
                                  <Button size="small" variant="text" onClick={() => setDialog({ kind: 'reopen', unit, closure })}>
                                    Set reopening date…
                                  </Button>
                                ) : null}
                                {closure.state === 'CURRENT' && closure.reopensOn !== null ? (
                                  <Button size="small" variant="text" onClick={() => setDialog({ kind: 'reopen', unit, closure })}>
                                    Change reopening date…
                                  </Button>
                                ) : null}
                              </Box>
                            </Box>
                          ))}
                          {ended.length > 0 ? (
                            <Box>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => setShownPast((currentMap) => ({ ...currentMap, [unit.id]: !pastShown }))}
                              >
                                {pastShown ? 'Hide past closures' : `Show ${ended.length} past closure${ended.length === 1 ? '' : 's'}`}
                              </Button>
                              {pastShown
                                ? ended.map((closure) => (
                                    <Box key={closure.id} sx={{ fontSize: 13, color: colour.text.secondary }}>
                                      {closureWords(closure)} · &quot;{closure.reason}&quot;
                                    </Box>
                                  ))
                                : null}
                            </Box>
                          ) : null}
                        </td>
                        <td style={{ padding: '10px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <span className="num">{unit.allocated}</span>
                            <Button
                              size="small"
                              variant="text"
                              aria-label={`Edit allocated headcount for ${shortName(unit)}`}
                              onClick={() => setDialog({ kind: 'allocated', unit })}
                            >
                              Edit
                            </Button>
                          </Box>
                        </td>
                        <td className="num" style={{ padding: '10px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                          {unit.filled}
                        </td>
                        <td style={{ padding: '10px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                          {unit.active && !openEnded ? (
                            <Button
                              variant="outlined"
                              color="primary"
                              aria-label={`Close ${shortName(unit)} from a date`}
                              onClick={() => setDialog({ kind: 'close', unit })}
                            >
                              Close from a date…
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Box>
            <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
              Allocated is the headcount the facility is funded for in each unit. On staff counts
              active officers whose home unit it is, full-time and part-time alike. The Staffing tile
              on the Quarter plan compares both with the staff needed.
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      <ClosureDialog
        key={dialog.kind === 'none' ? 'none' : `${dialog.kind}-${'closure' in dialog ? dialog.closure.id : dialog.unit.id}`}
        dialog={dialog}
        onClose={() => setDialog({ kind: 'none' })}
        onSaved={async (message) => {
          setDialog({ kind: 'none' });
          setStatus(message);
          await load(true);
        }}
      />
      <AllocatedDialog
        key={dialog.kind === 'allocated' ? `allocated-${dialog.unit.id}` : 'allocated-none'}
        dialog={dialog}
        onClose={() => setDialog({ kind: 'none' })}
        onSaved={async () => {
          setDialog({ kind: 'none' });
          setStatus('Allocated headcount saved.');
          await load(true);
        }}
      />
    </Box>
  );
}

function ClosureDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: DialogState;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const unit = dialog.kind === 'close' || dialog.kind === 'change' || dialog.kind === 'reopen' || dialog.kind === 'remove' ? dialog.unit : null;
  const closure = dialog.kind === 'change' || dialog.kind === 'reopen' || dialog.kind === 'remove' ? dialog.closure : null;
  const open = unit !== null;
  const [closedFrom, setClosedFrom] = useState(
    dialog.kind === 'change' || dialog.kind === 'reopen' ? (closure?.closedFrom ?? '') : '',
  );
  const [reopensOn, setReopensOn] = useState(
    dialog.kind === 'change' || dialog.kind === 'reopen' ? (closure?.reopensOn ?? '') : '',
  );
  const [reason, setReason] = useState(dialog.kind === 'change' ? (closure?.reason ?? '') : '');
  const [preview, setPreview] = useState<{ officersHomed: number; publishedShiftsAffected: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    if (!open || !unit || dialog.kind === 'remove' || !closedFrom) return;
    const ticket = ++request.current;
    void api
      .previewUnitClosure(unit.id, { closedFrom, reopensOn: reopensOn || null })
      .then((next) => {
        if (ticket === request.current) setPreview(next);
      })
      .catch(() => {
        if (ticket === request.current) setPreview(null);
      });
  }, [open, unit, dialog.kind, closedFrom, reopensOn]);

  if (!unit) return null;

  const title =
    dialog.kind === 'close'
      ? `Close ${shortName(unit)} from a date`
      : dialog.kind === 'change'
        ? `Change the closure of ${shortName(unit)}`
        : dialog.kind === 'reopen'
          ? `Reopen ${shortName(unit)}`
          : 'Remove this closure?';
  const submitLabel =
    dialog.kind === 'close'
      ? `Close ${shortName(unit)}`
      : dialog.kind === 'change'
        ? 'Save changes'
        : dialog.kind === 'reopen'
          ? 'Set reopening date'
          : 'Remove closure';

  const effect = (() => {
    if (dialog.kind === 'remove') {
      return `${shortName(unit)} will be open on every day from ${dateWords(closure?.closedFrom ?? '')} again. New drafts plan it as usual. The removal is recorded in the audit log.`;
    }
    if (!closedFrom) return null;
    const officers = preview ? ` Its ${preview.officersHomed} officers stay employed` : ' Its officers stay employed';
    const published =
      preview && preview.publishedShiftsAffected > 0
        ? ` ${preview.publishedShiftsAffected} shifts already published in ${shortName(unit)} on or after that date are not deleted. They'll be listed on the Quarter plan under "Shifts in closed units" for a supervisor to move or cancel.`
        : '';
    const reopened = reopensOn ? ` The unit is open again from ${weekdayDateWords(reopensOn)}.` : '';
    return `From ${weekdayDateWords(closedFrom)}, ${shortName(unit)} needs no staff, gets no roster and shows no coverage gaps in new drafts.${officers} and work as relief in other units.${published}${reopened} The current draft, if any, isn't changed: generate a new draft to plan without the unit.`;
  })();

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (dialog.kind === 'remove' && closure) {
        await api.removeUnitClosure(unit.id, closure.id);
        await onSaved(`${shortName(unit)} is open again. New drafts plan it as usual.`);
        return;
      }
      if (!closedFrom) {
        setError('Enter the first day the unit is closed.');
        return;
      }
      if (reason.trim().length < 5) {
        setError('Write a reason of at least 5 characters.');
        return;
      }
      if (reopensOn && reopensOn <= closedFrom) {
        setError('The reopening date must be after the closing date.');
        return;
      }
      if (dialog.kind === 'close') {
        await api.addUnitClosure(unit.id, { closedFrom, reopensOn: reopensOn || null, reason });
        await onSaved(
          `${shortName(unit)} is closed from ${dateWords(closedFrom)}. Generate a new draft on the Quarter plan to plan without it.`,
        );
      } else if (dialog.kind === 'change' && closure) {
        await api.updateUnitClosure(unit.id, closure.id, { closedFrom, reopensOn: reopensOn || null, reason });
        await onSaved(`${shortName(unit)}'s closure is saved. Generate a new draft to plan with it.`);
      } else if (dialog.kind === 'reopen' && closure) {
        await api.updateUnitClosure(unit.id, closure.id, { reopensOn: reopensOn || null, reason });
        await onSaved(`${shortName(unit)}'s reopening date is saved.`);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The closure could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {dialog.kind === 'remove' && closure ? (
          <Typography sx={{ fontSize: 14 }}>{effect}</Typography>
        ) : (
          <>
            <TextField
              label="Closed from"
              type="date"
              value={closedFrom}
              onChange={(event) => setClosedFrom(event.target.value)}
              helperText="The first day the unit is closed."
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Reopens on"
              type="date"
              value={reopensOn}
              onChange={(event) => setReopensOn(event.target.value)}
              helperText="Leave empty if you don't know yet. You can set it later."
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              helperText="Shown on the Units screen and in the audit log."
            />
            {effect ? (
              <Typography aria-live="polite" sx={{ fontSize: 14 }}>
                {effect}
              </Typography>
            ) : null}
          </>
        )}
        {error ? (
          <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AllocatedDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: DialogState;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const unit = dialog.kind === 'allocated' ? dialog.unit : null;
  const [value, setValue] = useState(unit ? String(unit.allocated) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!unit) return null;

  const save = async () => {
    setError(null);
    const allocated = Number(value);
    if (!Number.isInteger(allocated) || allocated < 0 || allocated > 999) {
      setError('Enter a whole number from 0 to 999.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Write a reason of at least 5 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.setUnitAllocation(unit.id, allocated, reason);
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The headcount could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Allocated headcount for {shortName(unit)}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <TextField
          label="Allocated officers"
          type="number"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          helperText={`Default: the officers on staff in the seed (${unit.filled}).`}
          slotProps={{ htmlInput: { min: 0, max: 999, step: 1 } }}
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          helperText="Shown in the audit log."
        />
        {error ? (
          <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
