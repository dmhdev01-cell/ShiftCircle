import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import type { AbsenceType } from '../api/types';
import { AbsenceChip } from '../components/ShiftChip';
import { colour } from '../theme/tokens';
import { LEAVE_TYPE_WORDS, leaveDates, leaveProblem, leaveRangeWords } from './plannedLeave';
import { dateWords, weekdayDateWords } from './unitDates';

export interface LeaveOfficerChoice {
  employeeId: string;
  name: string;
  unitName: string;
}

interface NotSaved {
  date: string;
  reason: string;
}

interface PlannedLeaveDialogProps {
  officers: LeaveOfficerChoice[];
  onClose: () => void;
  /** Every day was saved (new or already recorded with the same type). */
  onSaved: (words: string) => void;
}

const TYPES: AbsenceType[] = ['VACATION', 'SICK', 'OTHER'];

/**
 * Planned leave entry for the planner (PR-D, fit-gap A9). The api takes one
 * date per call (POST /planner/absences), so a range is one call per day, in
 * order. The next Generate skips the officer on those days, and the draft
 * roster shows them as Vac, Sick or Other chips instead of Off.
 */
export function PlannedLeaveDialog({ officers, onClose, onSaved }: PlannedLeaveDialogProps) {
  const [quarter, setQuarter] = useState<{ from: string; to: string } | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState<AbsenceType>('VACATION');
  const [tried, setTried] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [outcome, setOutcome] = useState<{ saved: number; notSaved: NotSaved[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getPlannerPlan()
      .then((plan) => {
        if (active) setQuarter({ from: plan.window.from, to: plan.window.to });
      })
      .catch(() => {
        // The api still refuses a date outside the quarter; the form only loses its hint.
      });
    return () => {
      active = false;
    };
  }, []);

  const sorted = useMemo(
    () => [...officers].sort((a, b) => a.name.localeCompare(b.name)),
    [officers],
  );
  const officer = sorted.find((entry) => entry.employeeId === employeeId);
  const problem = leaveProblem({ employeeId, from, to }, quarter);
  const busy = progress !== null;
  // The amber partial list is only for a run that reached the end; a fatal stop has its own line.
  const finished = outcome !== null && outcome.notSaved.length > 0 && failure === null;
  const locked = busy || outcome !== null;

  const save = async () => {
    setTried(true);
    setFailure(null);
    if (problem || !officer) return;
    const dates = leaveDates(from, to);
    const notSaved: NotSaved[] = [];
    let saved = 0;
    setProgress({ done: 0, of: dates.length });
    for (const [index, date] of dates.entries()) {
      try {
        await api.planAbsence({ employeeId, date, type });
        saved += 1;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
          notSaved.push({ date, reason: error.message });
        } else {
          // Unreachable, signed out or a server error: stop, and say what was saved.
          setProgress(null);
          setOutcome({ saved, notSaved });
          setFailure(
            `${error instanceof Error ? error.message : 'The leave could not be saved.'} ` +
              `${saved} of ${dates.length} days were saved before it stopped.`,
          );
          return;
        }
      }
      setProgress({ done: index + 1, of: dates.length });
    }
    setProgress(null);
    const words =
      `${LEAVE_TYPE_WORDS[type]} recorded for ${officer.name}: ${leaveRangeWords(from, to)}. ` +
      'Each day is in the audit log as “Absence recorded”. Generate the plan again to roster around it.';
    if (notSaved.length === 0) {
      onSaved(words);
      return;
    }
    setOutcome({ saved, notSaved });
  };

  const fieldError = tried ? problem : null;

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="planned-leave-title">
      <DialogTitle id="planned-leave-title" sx={{ fontSize: 18, fontWeight: 700 }}>
        Add planned leave
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 14 }}>
          The next Generate does not roster the officer on these days. The draft roster shows the
          leave as a Vac, Sick or Other chip instead of Off.
        </Typography>

        <TextField
          select
          label="Officer"
          size="small"
          value={employeeId}
          disabled={locked}
          onChange={(event) => setEmployeeId(event.target.value)}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          <option value="">Choose an officer</option>
          {sorted.map((entry) => (
            <option key={entry.employeeId} value={entry.employeeId}>
              {entry.name} · {entry.unitName}
            </option>
          ))}
        </TextField>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <TextField
            type="date"
            label="First day"
            size="small"
            value={from}
            disabled={locked}
            onChange={(event) => {
              setFrom(event.target.value);
              if (!to || to < event.target.value) setTo(event.target.value);
            }}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: quarter?.from, max: quarter?.to },
            }}
            sx={{ flex: '1 1 180px' }}
          />
          <TextField
            type="date"
            label="Last day"
            size="small"
            value={to}
            disabled={locked}
            onChange={(event) => setTo(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: from || quarter?.from, max: quarter?.to },
            }}
            sx={{ flex: '1 1 180px' }}
          />
        </Box>
        {quarter ? (
          <Typography sx={{ fontSize: 12, color: colour.text.secondary, mt: -1 }}>
            Plan quarter: {dateWords(quarter.from)} – {dateWords(quarter.to)}. At most 31 days at a
            time.
          </Typography>
        ) : null}

        <FormControl disabled={locked}>
          <FormLabel id="planned-leave-type" sx={{ fontSize: 14, fontWeight: 600, color: colour.text.primary }}>
            Type
          </FormLabel>
          <RadioGroup
            row
            aria-labelledby="planned-leave-type"
            value={type}
            onChange={(event) => setType(event.target.value as AbsenceType)}
          >
            {TYPES.map((value) => (
              <FormControlLabel
                key={value}
                value={value}
                control={<Radio />}
                label={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 14 }}>
                    {LEAVE_TYPE_WORDS[value]}{' '}
                    <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex' }}>
                      <AbsenceChip absenceType={value} />
                    </Box>
                  </Box>
                }
                sx={{ minHeight: 44, mr: 3 }}
              />
            ))}
          </RadioGroup>
        </FormControl>
        <Typography sx={{ fontSize: 12, color: colour.text.secondary, mt: -1 }}>
          Type only: no reason or medical detail is recorded (privacy).
        </Typography>

        {!problem && officer ? (
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            {LEAVE_TYPE_WORDS[type]} for {officer.name}: {leaveRangeWords(from, to)}
          </Typography>
        ) : null}

        {fieldError ? (
          <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
            {fieldError}
          </Typography>
        ) : null}

        {progress ? (
          <Typography role="status" sx={{ fontSize: 14 }}>
            Saving day {Math.min(progress.done + 1, progress.of)} of {progress.of}…
          </Typography>
        ) : null}

        {failure ? (
          <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
            {failure}
          </Typography>
        ) : null}

        {finished && outcome ? (
          <Box
            role="alert"
            sx={{
              p: '10px 12px',
              borderRadius: '8px',
              backgroundColor: colour.status.warn.bg,
              color: colour.status.warn.text,
              fontSize: 14,
            }}
          >
            <strong>
              Saved {outcome.saved} of {outcome.saved + outcome.notSaved.length} days.
            </strong>{' '}
            Not saved:
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
              {outcome.notSaved.map((entry) => (
                <li key={entry.date}>
                  {weekdayDateWords(entry.date)}: {entry.reason}
                </li>
              ))}
            </Box>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {finished || failure ? (
          <Button variant="contained" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="contained" onClick={() => void save()} disabled={busy}>
              Save leave
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
