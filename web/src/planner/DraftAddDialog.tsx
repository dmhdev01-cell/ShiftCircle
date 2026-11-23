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
} from '../api/types';
import { colour } from '../theme/tokens';
import { DraftRuleBox } from './DraftRuleBox';
import type { DraftUnitChoice } from './DraftShiftDialog';
import {
  BLOCK_SENTENCE,
  BUSY_SENTENCE,
  changedWords,
  COMMITTED_SENTENCE,
  SAVE_SENTENCE,
  STALE_SENTENCE,
} from './draftEditWords';
import { dateWords, weekdayDateWords } from './unitDates';

function closedOn(unit: DraftUnitChoice, date: string): boolean {
  if (!unit.closedFrom) return false;
  return date >= unit.closedFrom && (!unit.closedTo || date <= unit.closedTo);
}

interface DraftAddDialogProps {
  draftId: string;
  version: number;
  officer: OfficerRow;
  date: string;
  defaultUnitId: string;
  units: DraftUnitChoice[];
  onClose: () => void;
  onSaved: (result: PlannerAssignmentResult, words: string) => void;
  onReload: () => void;
}

/** Add a shift for one officer on one empty day (release 7, P8-SPEC §2.2). */
export function DraftAddDialog({
  draftId,
  version,
  officer,
  date,
  defaultUnitId,
  units,
  onClose,
  onSaved,
  onReload,
}: DraftAddDialogProps) {
  const [templateCode, setTemplateCode] = useState(assignableTemplates[0]?.code ?? 'D8');
  const [unitId, setUnitId] = useState(defaultUnitId);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RuleCheckOutcome | null>(null);
  const [pending, setPending] = useState<PlannerAssignmentInput | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(false);

  const template = shiftTemplates[templateCode];
  const selectedUnit = units.find((entry) => entry.id === unitId);
  const selectedClosed = selectedUnit ? closedOn(selectedUnit, date) : false;
  const startAt = `${date}T${template.start}:00-06:00`;

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
      setOutcome({
        outcome: problem.outcome ?? 'BLOCK',
        ruleSetVersion: problem.ruleSetVersion ?? 0,
        overridable: problem.overridable ?? false,
        ruleResults: problem.ruleResults,
      });
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
      const saved = await api.addPlannerAssignment(draftId, version, {
        ...input,
        ...(acknowledge ? { acknowledgeWarnings: true } : {}),
      });
      onSaved(
        saved,
        changedWords(
          officer.name,
          units.find((entry) => entry.id === input.unitId)?.name ?? selectedUnit?.name ?? '',
          date,
          input.shiftTemplate,
        ),
      );
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    const input: PlannerAssignmentInput = {
      employeeId: officer.employeeId,
      unitId,
      shiftTemplate: templateCode,
      startAt,
    };
    setBusy(true);
    reset();
    setPending(input);
    try {
      const result = await api.previewPlannerAssignment(draftId, input);
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

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Add a shift to the draft</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 14 }}>
          Add a shift for {officer.name} on {weekdayDateWords(date)}.
        </Typography>

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

        <Box>
          <Button
            variant="contained"
            color="primary"
            disabled={busy || selectedClosed}
            onClick={() => void check()}
          >
            {busy ? 'Checking…' : 'Check and save'}
          </Button>
        </Box>

        {outcome ? (
          <DraftRuleBox outcome={outcome}>
            {outcome.outcome === 'BLOCK' ? (
              <Box component="span">{BLOCK_SENTENCE}</Box>
            ) : (
              <Box>
                <Button
                  variant="outlined"
                  color="primary"
                  disabled={busy}
                  onClick={() => {
                    if (pending) void save(pending, true);
                  }}
                >
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
