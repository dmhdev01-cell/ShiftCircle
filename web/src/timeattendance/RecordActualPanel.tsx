import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { chipTextFor } from '../api/shiftTemplates';
import { dayWords } from '../planning/gapFill';
import type { AbsenceType, PayCode, RecordActualInput, TimeEntry } from '../api/types';
import { colour } from '../theme/tokens';

/** The panel's heading id, so the drawer around it is a named dialog (axe aria-dialog-name). */
export const RECORD_ACTUAL_HEADING_ID = 'record-actual-heading';

type Choice = 'AS_SCHEDULED' | 'ADJUSTED' | 'ABSENT';

interface RecordActualPanelProps {
  entry: TimeEntry;
  /** The recalculated pay codes, after a save. */
  result?: { periodHours: number; payCodes: PayCode[] | undefined };
  onSave: (input: RecordActualInput) => void;
  onCancel: () => void;
  /** Back to "needs actual"; only for a cell that already holds a record. */
  onClear?: () => void;
}

function clock(instant: string): string {
  return instant.slice(11, 16);
}

/** "Tue 17 Nov 2026" for the subtitle, not "2026-11-17" (v1.2 walk D6). */
function dateWords(date: string): string {
  return `${dayWords(date)} ${date.slice(0, 4)}`;
}

/** The day after an ISO date: a night shift's end belongs to it. */
function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The record-actual panel (docs/ui/build-notes.md §2.2): worked as scheduled,
 * adjusted times, or absent.
 */
export function RecordActualPanel({
  entry,
  result,
  onSave,
  onCancel,
  onClear,
}: RecordActualPanelProps) {
  // No default: one hasty click must not record a full day of payroll hours.
  // A cell that already holds an absence opens on it, so the supervisor sees
  // what is recorded and can correct it (observation #11).
  const [choice, setChoice] = useState<Choice | null>(entry.absence ? 'ABSENT' : null);
  const [start, setStart] = useState(clock(entry.startAt));
  const [end, setEnd] = useState(clock(entry.endAt));
  const [absence, setAbsence] = useState<AbsenceType>(entry.absence ?? 'SICK');

  const save = () => {
    if (choice === null) return;
    if (choice === 'AS_SCHEDULED') {
      onSave({ workedAsScheduled: true });
      return;
    }
    if (choice === 'ABSENT') {
      onSave({ workedAsScheduled: false, absence });
      return;
    }
    // A night shift ends on the next day (23:00-07:00, 20:00-12:00): writing
    // both clocks on the entry's own date sent an end before its start.
    const endDate = end <= start ? nextDay(entry.date) : entry.date;
    onSave({
      workedAsScheduled: false,
      actualStart: `${entry.date}T${start}:00-06:00`,
      actualEnd: `${endDate}T${end}:00-06:00`,
    });
  };

  return (
    <Box
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography
            component="h2"
            id={RECORD_ACTUAL_HEADING_ID}
            sx={{ m: 0, fontSize: 17, fontWeight: 700 }}
          >
            Record actual · {entry.employeeName}
          </Typography>
          <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
            {dateWords(entry.date)} · {chipTextFor(entry.shiftTemplate)} · scheduled{' '}
            {clock(entry.startAt)} – {clock(entry.endAt)}
          </Box>
        </Box>
        {/* Observation #10: Esc and the outside click worked, but nothing on the
            panel said how to close it. */}
        <Button
          variant="text"
          color="primary"
          aria-label="Close the record actual panel"
          onClick={onCancel}
          sx={{ minWidth: 44, minHeight: 44, fontSize: 18, lineHeight: 1, p: 0 }}
        >
          <span aria-hidden="true">×</span>
        </Button>
      </Box>

      <FormControl>
        <FormLabel sx={{ fontSize: 13, fontWeight: 600 }}>What happened?</FormLabel>
        <RadioGroup
          value={choice ?? ''}
          onChange={(event) => setChoice(event.target.value as Choice)}
        >
          <FormControlLabel
            value="AS_SCHEDULED"
            control={<Radio />}
            label="Worked as scheduled"
            slotProps={{ typography: { sx: { fontSize: 14 } } }}
          />
          <FormControlLabel
            value="ADJUSTED"
            control={<Radio />}
            label="Adjusted times"
            slotProps={{ typography: { sx: { fontSize: 14 } } }}
          />
          <FormControlLabel
            value="ABSENT"
            control={<Radio />}
            label="Absent"
            slotProps={{ typography: { sx: { fontSize: 14 } } }}
          />
        </RadioGroup>
      </FormControl>

      {choice === 'ADJUSTED' ? (
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <TextField
            label="Start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            slotProps={{ htmlInput: { step: 900 } }}
            sx={{ width: 160 }}
          />
          <TextField
            label="End"
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            slotProps={{ htmlInput: { step: 900 } }}
            sx={{ width: 160 }}
          />
        </Box>
      ) : null}

      {choice === 'ABSENT' ? (
        // A native select, like the unit and pay-period pickers: the value is a
        // plain string and a keyboard or screen reader can change it.
        <Box
          component="label"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            width: 220,
            fontSize: 12,
            fontWeight: 600,
            color: colour.text.secondary,
          }}
        >
          Absence type
          <Box
            component="select"
            aria-label="Absence type"
            value={absence}
            onChange={(event: { target: { value: string } }) =>
              setAbsence(event.target.value as AbsenceType)
            }
            sx={{
              minHeight: 44,
              px: 3,
              border: `1px solid ${colour.border.input}`,
              borderRadius: '2px',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 500,
              color: colour.text.primary,
              backgroundColor: colour.bg.surface,
            }}
          >
            <option value="SICK">Sick</option>
            <option value="VACATION">Vacation</option>
            <option value="OTHER">Other</option>
          </Box>
        </Box>
      ) : null}

      <Box
        role="status"
        sx={{
          p: '10px 12px',
          borderRadius: '8px',
          backgroundColor: colour.bg.subtle,
          fontSize: 13,
          color: colour.text.secondary,
        }}
      >
        {choice === null
          ? 'Choose what happened. Nothing is recorded until you do.'
          : choice === 'AS_SCHEDULED'
            ? `Will record: worked as scheduled, ${clock(entry.startAt)} – ${clock(entry.endAt)}.`
            : choice === 'ABSENT'
              ? `Will record: absent (${absence.toLowerCase()}), no hours.`
              : `Will record: worked ${start} – ${end}.`}
      </Box>

      {result ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.pass.bg,
            color: colour.status.pass.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Now {result.periodHours} h:{' '}
          {result.payCodes && result.payCodes.length > 0
            ? result.payCodes
                .map((code) => `${code.hours} h at ${code.multiplier}×`)
                .join(' · ')
            : 'no pay code'}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" color="primary" disabled={choice === null} onClick={save}>
          Save
        </Button>
        {/* After a save there is nothing to cancel: the record is in. The
            button says so and closes the panel (observation #10). */}
        <Button variant="text" color="primary" onClick={onCancel}>
          {result ? 'Done' : 'Cancel'}
        </Button>
        {onClear ? (
          <Button variant="text" color="primary" onClick={onClear}>
            Clear (back to needs actual)
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}
