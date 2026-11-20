import { useState } from 'react';
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

import { api } from '../api/client';
import { qualificationLabel } from '../api/qualifications';
import { shiftTemplates } from '../api/shiftTemplates';
import type { RuleCheckChange, RuleCheckOutcome } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import { CalendarGrid } from './CalendarGrid';
import type { CalendarCell } from './CalendarGrid';
import { useMyOffers, useMySchedule } from './useMySchedule';

const REGINA_OFFSET = '-06:00';

function shortDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  return `${dow} ${day} ${month}`;
}

function relativeDay(date: string, asOf?: string): string {
  if (!asOf) return shortDay(date);
  if (date === asOf) return 'Today';
  const tomorrow = new Date(`${asOf}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
  return shortDay(date);
}

function monthGrid(year: number, month: number, weeks = 6): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // The grid starts on the Monday on or before the first of the month.
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - offset);

  const dates: string[] = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** A shift the officer would like to work, with the live rule result. */
interface Draft {
  id: string;
  change: RuleCheckChange;
  what: string;
  outcome: 'CHECKING' | 'PASS' | 'WARN' | 'BLOCK';
  why?: string;
}

const OUTCOME_TONE = {
  CHECKING: 'info',
  PASS: 'pass',
  WARN: 'warn',
  BLOCK: 'block',
} as const;

const OUTCOME_TEXT = {
  CHECKING: 'Checking',
  PASS: 'Passes',
  WARN: 'Warning',
  BLOCK: 'Blocked',
} as const;

/**
 * The employee's My schedule (docs/ui/README.md §5.2). It shows only the
 * officer's own data: no colleague's hours, absences or overtime totals.
 *
 * The officer can answer an overtime offer and draft shifts they would like
 * to work. A draft is a request - only a supervisor authorises an extra shift
 * (S-04) - and nothing is agreed until the supervisor decides.
 */
export function MySchedulePage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  });
  const from = `${month.year}-${String(month.month).padStart(2, '0')}-01`;
  const to = `${month.year}-${String(month.month).padStart(2, '0')}-31`;

  const { state: scheduleState } = useMySchedule(from, to);
  const { state: offersState, reload: reloadOffers } = useMyOffers();
  const [answer, setAnswer] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState('2026-11-26');
  const [newTemplate, setNewTemplate] = useState('A12');

  if (scheduleState.kind === 'loading') {
    return (
      <>
        <Typography variant="h1">My schedule</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
          Loading your schedule…
        </Typography>
      </>
    );
  }

  if (scheduleState.kind === 'error') {
    return (
      <>
        <Typography variant="h1">My schedule</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load your schedule
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              {scheduleState.message}
            </Typography>
          </CardContent>
        </Card>
      </>
    );
  }

  const payload = scheduleState.payload;
  const asOf = payload.asOf;
  const next = payload.nextShift;

  const cells: CalendarCell[] = monthGrid(month.year, month.month).map((date) => {
    const inMonth = date.startsWith(`${month.year}-${String(month.month).padStart(2, '0')}`);
    const shift = payload.shifts.find((entry) => entry.date === date);
    return { date, inMonth, items: shift?.items ?? [] };
  });

  const offer = offersState.kind === 'ready' ? offersState.offers[0] : undefined;

  const respond = async (response: 'ACCEPT' | 'DECLINE') => {
    if (!offer) return;
    try {
      await api.respondToOffer(offer.id, response);
      setAnswer(
        response === 'ACCEPT'
          ? 'Accepted. Your supervisor will confirm the assignment.'
          : 'Declined. Thank you - your supervisor has been told.',
      );
      reloadOffers();
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : 'The answer could not be recorded.');
    }
  };

  const addDraft = async () => {
    const template = shiftTemplates[newTemplate];
    const change: RuleCheckChange = {
      type: 'ASSIGN',
      employeeId: payload.employee.id,
      unitId: payload.employee.unit.id,
      shiftTemplate: newTemplate,
      startAt: `${newDate}T${template.start}:00${REGINA_OFFSET}`,
    };

    const id = `${newDate}-${newTemplate}`;
    setDrafts((current) => [
      ...current.filter((draft) => draft.id !== id),
      {
        id,
        change,
        what: `${shortDay(newDate)}: add ${newTemplate} ${template.start} – ${template.end}${template.endsNextDay ? ' +1' : ''}`,
        outcome: 'CHECKING',
      },
    ]);
    setAdding(false);

    try {
      const result: RuleCheckOutcome = await api.previewRuleCheck({ change });
      const blocked = result.ruleResults.some((entry) => entry.outcome === 'BLOCK');
      const warned = result.ruleResults.some((entry) => entry.outcome === 'WARN');
      const reason = result.ruleResults.find((entry) => entry.outcome !== 'PASS')?.message;
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                outcome: blocked ? 'BLOCK' : warned ? 'WARN' : 'PASS',
                ...(reason ? { why: reason } : {}),
              }
            : draft,
        ),
      );
    } catch (error) {
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                outcome: 'BLOCK',
                why: error instanceof Error ? error.message : 'The rules could not be checked.',
              }
            : draft,
        ),
      );
    }
  };

  const sendToSupervisor = async () => {
    try {
      await api.submitProposals(
        note,
        drafts.map((draft) => draft.change),
      );
      setSent(
        `Sent. Your supervisor decides - ${drafts.length} shift${drafts.length === 1 ? '' : 's'} proposed.`,
      );
      setDrafts([]);
      setNote('');
    } catch (error) {
      setSent(error instanceof Error ? error.message : 'The proposal could not be sent.');
    }
  };

  const payPeriod = payload.payPeriod;
  const progress = Math.min(
    100,
    Math.round((payPeriod.totalHours / Math.max(1, payPeriod.thresholdHours)) * 100),
  );

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">My schedule</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          {[
            payload.employee.name,
            payload.employee.role,
            payload.employee.unit.name,
            payload.employee.rotation,
            ...payload.employee.qualifications.map(qualificationLabel),
          ].join(' · ')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        <Box
          sx={{
            flex: '2 1 280px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            p: 4,
            backgroundColor: colour.brand.link,
            color: colour.text.onDark,
            borderRadius: '10px',
          }}
        >
          <Box
            component="span"
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: colour.text.onDarkMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Next shift
          </Box>
          {next ? (
            <>
              <Box component="span" sx={{ fontSize: 24, fontWeight: 700 }}>
                {relativeDay(next.date, asOf)} ·{' '}
                {shiftTemplates[next.shiftTemplate]?.start} –{' '}
                {shiftTemplates[next.shiftTemplate]?.end}
                {shiftTemplates[next.shiftTemplate]?.endsNextDay ? ' +1' : ''}
              </Box>
              <Box component="span" sx={{ fontSize: 14 }}>
                {shiftTemplates[next.shiftTemplate]?.label} · {next.unit.name}
              </Box>
            </>
          ) : (
            <Box component="span" sx={{ fontSize: 24, fontWeight: 700 }}>
              No shift scheduled
            </Box>
          )}
        </Box>

        <Box
          sx={{
            flex: '1 1 200px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            p: 4,
            backgroundColor: colour.bg.surface,
            border: `1px solid ${colour.border.default}`,
            borderRadius: '10px',
          }}
        >
          <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
            This pay period ({payPeriod.label})
          </Box>
          <Box className="num" sx={{ fontSize: 24, fontWeight: 700 }}>
            {payPeriod.totalHours}{' '}
            <Box component="span" sx={{ fontSize: 15, fontWeight: 600, color: colour.text.secondary }}>
              of {payPeriod.thresholdHours} h
            </Box>
          </Box>
          <Box
            aria-hidden="true"
            sx={{
              height: 8,
              borderRadius: '4px',
              backgroundColor: colour.border.default,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ width: `${progress}%`, height: 8, backgroundColor: colour.brand.link }} />
          </Box>
          <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
            {payPeriod.workedHours} h worked · {payPeriod.scheduledHours} h still scheduled
          </Box>
        </Box>

        <Box
          sx={{
            flex: '1 1 200px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            p: 4,
            backgroundColor: colour.bg.surface,
            border: `1px solid ${colour.border.default}`,
            borderRadius: '10px',
          }}
        >
          <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
            Overtime this quarter
          </Box>
          <Box className="num" sx={{ fontSize: 24, fontWeight: 700 }}>
            {payload.overtimeThisQuarter.hours.toFixed(1)} h
          </Box>
          <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
            Rank {payload.overtimeThisQuarter.rank} of {payload.overtimeThisQuarter.of} on the overtime
            list
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
        <Box sx={{ flex: '999 1 600px', minWidth: 0 }}>
          <CalendarGrid
            cells={cells}
            today={asOf ?? ''}
            monthLabel={monthLabel(month.year, month.month)}
            onPreviousMonth={() =>
              setMonth((current) =>
                current.month === 1
                  ? { year: current.year - 1, month: 12 }
                  : { year: current.year, month: current.month - 1 },
              )
            }
            onNextMonth={() =>
              setMonth((current) =>
                current.month === 12
                  ? { year: current.year + 1, month: 1 }
                  : { year: current.year, month: current.month + 1 },
              )
            }
          />
        </Box>

        <Box sx={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Box
            component="section"
            aria-label="Overtime offer"
            sx={{
              backgroundColor: colour.bg.surface,
              border: `2px solid ${colour.support.lentils}`,
              borderRadius: '10px',
              p: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
            }}
          >
            <Box
              component="span"
              sx={{
                fontSize: 12,
                fontWeight: 600,
                color: '#2F5206',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Overtime offered to you
            </Box>

            {offer ? (
              <>
                <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
                  {shortDay(offer.openShift.date)} · {shiftTemplates[offer.openShift.shiftTemplate]?.label}{' '}
                  {shiftTemplates[offer.openShift.shiftTemplate]?.start} –{' '}
                  {shiftTemplates[offer.openShift.shiftTemplate]?.end}
                </Typography>
                <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                  {offer.openShift.unit.name} · offered by {offer.offeredBy} at {offer.offeredAt} · paid
                  at overtime rates
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <StatusPill tone="pass">Rules OK for you</StatusPill>
                  {offer.reason ? (
                    <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                      {offer.reason}
                    </Box>
                  ) : null}
                </Box>

                {answer ? (
                  <Box
                    role="status"
                    sx={{
                      p: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: '#E8F1F8',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {answer}
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    <Button variant="contained" color="primary" onClick={() => void respond('ACCEPT')}>
                      Accept
                    </Button>
                    <Button variant="outlined" color="primary" onClick={() => void respond('DECLINE')}>
                      Decline
                    </Button>
                  </Box>
                )}
              </>
            ) : (
              <Box component="span" sx={{ fontSize: 14, color: colour.text.secondary }}>
                No overtime is offered to you right now.
              </Box>
            )}
          </Box>

          <Box
            component="section"
            aria-label="Propose shifts"
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
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
                Propose shifts
              </Typography>
              <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary, lineHeight: 1.45 }}>
                Draft the shifts you would like. The rules are checked as you go, and your supervisor
                decides. A proposal is a request - only a supervisor can authorise an extra shift.
              </Box>
            </Box>

            {drafts.map((draft) => (
              <Box
                key={draft.id}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  p: '10px 12px',
                  border: `1px solid ${colour.border.default}`,
                  borderRadius: '8px',
                }}
              >
                <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>
                  {draft.what}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <StatusPill tone={OUTCOME_TONE[draft.outcome]}>
                    {OUTCOME_TEXT[draft.outcome]}
                  </StatusPill>
                  {draft.why ? (
                    <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                      {draft.why}
                    </Box>
                  ) : null}
                </Box>
              </Box>
            ))}

            <TextField
              label="Note to your supervisor"
              multiline
              minRows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />

            {sent ? (
              <Box
                role="status"
                sx={{
                  p: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#E8F1F8',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {sent}
              </Box>
            ) : null}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button
                variant="contained"
                color="primary"
                disabled={drafts.length === 0 || note.trim().length === 0}
                onClick={() => void sendToSupervisor()}
              >
                Send to supervisor
              </Button>
              <Button variant="outlined" color="primary" onClick={() => setAdding(true)}>
                Add a shift
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Add a shift</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
            The rules are checked as soon as you add the shift, so you can see before you send it.
          </Typography>
          <TextField
            label="Date"
            type="date"
            fullWidth
            value={newDate}
            onChange={(event) => setNewDate(event.target.value)}
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { min: '2026-10-01', max: '2026-12-29' } }}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {Object.values(shiftTemplates).map((option) => (
              <Button
                key={option.code}
                variant={option.code === newTemplate ? 'contained' : 'outlined'}
                color="primary"
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
          <Button variant="contained" color="primary" onClick={() => void addDraft()}>
            Add and check the rules
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
