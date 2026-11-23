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
import { assignableTemplates, shiftTemplates } from '../api/shiftTemplates';
import type {
  OfficerRow,
  PlannerAssignmentInput,
  PlannerAssignmentResult,
  RuleCheckOutcome,
  ShiftItem,
} from '../api/types';
import { colour } from '../theme/tokens';
import { DraftRuleBox } from './DraftRuleBox';
import {
  BLOCK_SENTENCE,
  BUSY_SENTENCE,
  changedWords,
  COMMITTED_SENTENCE,
  removedWords,
  SAVE_SENTENCE,
  STALE_SENTENCE,
} from './draftEditWords';
import { dateWords, weekdayDateWords } from './unitDates';

export interface DraftUnitChoice {
  id: string;
  name: string;
  closedFrom?: string | null;
  closedTo?: string | null;
}

export interface DraftOfficerChoice {
  employeeId: string;
  name: string;
  unitName: string;
}

interface DraftShiftDialogProps {
  draftId: string;
  version: number;
  officer: OfficerRow;
  item: ShiftItem;
  unit: { id: string; name: string };
  units: DraftUnitChoice[];
  officers: DraftOfficerChoice[];
  onClose: () => void;
  onSaved: (result: PlannerAssignmentResult, words: string) => void;
  onReload: () => void;
}

type Mode = 'choose' | 'time' | 'officer' | 'remove';

function closedOn(unit: DraftUnitChoice, date: string): boolean {
  if (!unit.closedFrom) return false;
  return date >= unit.closedFrom && (!unit.closedTo || date <= unit.closedTo);
}

/**
 * One draft shift's actions (release 7): change time or unit, give it to
 * another officer, or remove it. The save is checked first; a Warn needs an
 * explicit keep, and a Block never lands.
 */
export function DraftShiftDialog({
  draftId,
  version,
  officer,
  item,
  unit,
  units,
  officers,
  onClose,
  onSaved,
  onReload,
}: DraftShiftDialogProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [date, setDate] = useState(item.startAt.slice(0, 10));
  const [templateCode, setTemplateCode] = useState(item.shiftTemplate);
  const [unitId, setUnitId] = useState(unit.id);
  const [officerId, setOfficerId] = useState(officer.employeeId);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RuleCheckOutcome | null>(null);
  const [pending, setPending] = useState<PlannerAssignmentInput | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(false);

  const template = shiftTemplates[templateCode] ?? shiftTemplates[item.shiftTemplate];
  const selectedUnit = units.find((entry) => entry.id === unitId);
  const selectedClosed = selectedUnit ? closedOn(selectedUnit, date) : false;
  const startAt = `${date}T${template.start}:00-06:00`;
  const titleTemplate = shiftTemplates[item.shiftTemplate] ?? template;

  const reset = () => {
    setOutcome(null);
    setPending(null);
    setMessage(null);
    setReload(false);
  };

  const failure = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      setMessage(error instanceof Error ? error.message : SAVE_SENTENCE);
      return;
    }
    const problem = error.problem;
    if (error.status === 422 && problem?.ruleResults?.length) {
      const next: RuleCheckOutcome = {
        outcome: problem.outcome ?? 'BLOCK',
        ruleSetVersion: problem.ruleSetVersion ?? 0,
        overridable: problem.overridable ?? false,
        ruleResults: problem.ruleResults,
      };
      setOutcome(next);
      setMessage(null);
      return;
    }
    if (error.status === 412 || error.status === 428) {
      setMessage(STALE_SENTENCE);
      setReload(true);
      return;
    }
    if (error.status === 409) {
      setMessage(problem?.detail ?? COMMITTED_SENTENCE);
      setReload(true);
      return;
    }
    if (error.status === 423) {
      setMessage(problem?.detail ?? BUSY_SENTENCE);
      return;
    }
    setMessage(problem?.detail ?? problem?.title ?? error.message);
  };

  const save = async (input: PlannerAssignmentInput, acknowledge: boolean) => {
    setBusy(true);
    reset();
    try {
      const saved = await api.updatePlannerAssignment(draftId, item.assignmentId, version, {
        ...input,
        ...(acknowledge ? { acknowledgeWarnings: true } : {}),
      });
      onSaved(
        saved,
        changedWords(
          officers.find((entry) => entry.employeeId === input.employeeId)?.name ?? officer.name,
          units.find((entry) => entry.id === input.unitId)?.name ?? unit.name,
          input.startAt.slice(0, 10),
          input.shiftTemplate,
        ),
      );
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const check = async (input: PlannerAssignmentInput) => {
    setBusy(true);
    reset();
    setPending(input);
    try {
      const result = await api.previewPlannerAssignment(draftId, {
        ...input,
        assignmentId: item.assignmentId,
      });
      if (result.outcome === 'BLOCK') {
        setOutcome(result);
        return;
      }
      if (result.outcome === 'WARN' && result.ruleResults.some((rule) => rule.outcome === 'WARN')) {
        setOutcome(result);
        return;
      }
      await save(input, false);
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const checkTime = () =>
    void check({
      employeeId: officer.employeeId,
      unitId,
      shiftTemplate: templateCode,
      startAt,
      kind: item.kind,
    });

  const checkOfficer = () =>
    void check({
      employeeId: officerId,
      unitId: unit.id,
      shiftTemplate: item.shiftTemplate,
      startAt: item.startAt,
      kind: item.kind,
    });

  const keep = () => {
    if (pending) void save(pending, true);
  };

  const remove = async () => {
    setBusy(true);
    reset();
    try {
      const saved = await api.removePlannerAssignment(draftId, item.assignmentId, version);
      onSaved(
        saved,
        removedWords(officer.name, unit.name, item.startAt.slice(0, 10), item.shiftTemplate),
      );
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
        {officer.name} · {unit.name} · {weekdayDateWords(item.startAt.slice(0, 10))} ·{' '}
        {item.shiftTemplate} {titleTemplate?.start}–{titleTemplate?.end}
        {titleTemplate?.endsNextDay ? ' +1' : ''}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
          Change this shift in the draft. Nothing reaches the planning board until you commit.
        </Typography>

        {mode === 'choose' ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Button variant="outlined" color="primary" onClick={() => setMode('time')}>
              Change time or unit…
            </Button>
            <Button variant="outlined" color="primary" onClick={() => setMode('officer')}>
              Give to another officer…
            </Button>
            <Button
              variant="outlined"
              onClick={() => setMode('remove')}
              sx={{ color: colour.status.block.text, borderColor: colour.status.block.text }}
            >
              Remove from draft…
            </Button>
          </Box>
        ) : mode === 'time' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Date"
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
              {assignableTemplates.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.start} – {option.end}
                  {option.endsNextDay ? ' +1' : ''}
                </option>
              ))}
            </TextField>
            <TextField
              select
              label="Unit"
              size="small"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              slotProps={{ select: { native: true } }}
            >
              {units.map((entry) => {
                const closed = closedOn(entry, date);
                return (
                  <option key={entry.id} value={entry.id} disabled={closed}>
                    {entry.name}
                    {entry.closedFrom ? ` (closed from ${dateWords(entry.closedFrom)})` : ''}
                  </option>
                );
              })}
            </TextField>
            {selectedClosed ? (
              <Typography role="alert" sx={{ fontSize: 13, color: colour.status.block.text }}>
                {selectedUnit?.name} is closed on this day.
              </Typography>
            ) : null}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button
                variant="contained"
                color="primary"
                disabled={busy || selectedClosed}
                onClick={checkTime}
              >
                {busy ? 'Checking…' : 'Check and save'}
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => {
                  setMode('choose');
                  reset();
                }}
              >
                Back
              </Button>
            </Box>
          </Box>
        ) : mode === 'officer' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              select
              label="Officer"
              size="small"
              value={officerId}
              onChange={(event) => setOfficerId(event.target.value)}
              slotProps={{ select: { native: true } }}
            >
              {officers.map((entry) => (
                <option key={entry.employeeId} value={entry.employeeId}>
                  {entry.name} · {entry.unitName}
                </option>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button variant="contained" color="primary" disabled={busy} onClick={checkOfficer}>
                {busy ? 'Checking…' : 'Check and save'}
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => {
                  setMode('choose');
                  reset();
                }}
              >
                Back
              </Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 14 }}>
              Remove this shift from the draft? The block may become a gap; the scorecard will show
              it.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button
                variant="contained"
                disabled={busy}
                onClick={() => void remove()}
                sx={{
                  backgroundColor: colour.status.block.text,
                  '&:hover': { backgroundColor: colour.status.block.text, opacity: 0.9 },
                }}
              >
                Remove shift
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => {
                  setMode('choose');
                  reset();
                }}
              >
                Back
              </Button>
            </Box>
          </Box>
        )}

        {outcome ? (
          <DraftRuleBox outcome={outcome}>
            {outcome.outcome === 'BLOCK' ? (
              <Box component="span">{BLOCK_SENTENCE}</Box>
            ) : (
              <Box>
                <Button variant="outlined" color="primary" disabled={busy} onClick={keep}>
                  Keep the change with these warnings
                </Button>
              </Box>
            )}
          </DraftRuleBox>
        ) : null}

        {message ? (
          <Box
            role="alert"
            sx={{
              p: '10px 12px',
              borderRadius: '8px',
              backgroundColor: colour.status.block.bg,
              color: colour.status.block.text,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {message}
            {reload ? (
              <Box sx={{ mt: 1 }}>
                <Button variant="outlined" color="primary" onClick={onReload}>
                  Reload
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
    </Dialog>
  );
}
