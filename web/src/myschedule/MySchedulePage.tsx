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
import { AbsenceChip, ShiftChip } from '../components/ShiftChip';
import { Legend, LegendItem } from '../components/Legend';
import { qualificationLabel } from '../api/qualifications';
import { shiftTemplates } from '../api/shiftTemplates';
import type { MyOffer, RuleCheckChange, RuleCheckOutcome } from '../api/types';
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

interface MonthRange {
  from: string;
  to: string;
}

/** The first and last day of a month, for the api's range. */
function monthRange(month: { year: number; month: number }): MonthRange {
  const last = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const prefix = `${month.year}-${String(month.month).padStart(2, '0')}`;
  return { from: `${prefix}-01`, to: `${prefix}-${last}` };
}

/** The month a day is in. */
function monthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/**
 * When an offer was made. The api writes an instant ("2026-11-20T08:45:47Z"),
 * the seeded demo data writes a time ("14:20"); the card shows the day and the
 * time in the centre's zone either way, never the raw ISO text (V11).
 */
function offeredWhen(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  const zone = 'America/Regina';
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: zone }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: zone }).format(parsed);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(parsed);
  return `${day} ${month} ${time}`;
}

/** "Unit B · Living unit · offered by M. Ellis at 14:20": no empty clause. */
function offerSource(company: string, offeredBy: string, offeredAt: string): string {
  const when = offeredWhen(offeredAt);
  return offeredBy ? `${company} · offered by ${offeredBy} at ${when}` : `${company} · offered ${when}`;
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
 * What the api said about this offer. The screen never claims a check it was
 * not given: with no rule results there is nothing to claim.
 */
/** The answer line for an offer, from this visit or from the api's status. */
function answerFor(offer: MyOffer, answers: Record<string, string>): string | null {
  if (answers[offer.id]) return answers[offer.id];
  switch (offer.status) {
    case 'ACCEPTED':
      return 'Accepted. Your supervisor will confirm the assignment.';
    case 'DECLINED':
      return 'Declined. Thank you - your supervisor has been told.';
    case 'CONFIRMED':
      return 'Confirmed by your supervisor. The shift is on your schedule.';
    default:
      return null;
  }
}

function offerCheck(offer: MyOffer) {
  const results = offer.ruleResults;
  if (!results || results.length === 0) {
    return (
      <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
        No rule result from the api
      </Typography>
    );
  }
  if (results.some((result) => result.outcome === 'BLOCK')) {
    return <StatusPill tone="block">A rule blocks this for you</StatusPill>;
  }
  if (results.some((result) => result.outcome === 'WARN')) {
    return <StatusPill tone="warn">Rules OK, with a warning</StatusPill>;
  }
  return <StatusPill tone="pass">Rules OK for you</StatusPill>;
}

/**
 * The employee's My schedule (docs/ui/README.md §5.2). It shows only the
 * officer's own data: no colleague's hours, absences or overtime totals.
 *
 * The officer can answer an overtime offer and draft shifts they would like
 * to work. A draft is a request - only a supervisor authorises an extra shift
 * (S-04) - and nothing is agreed until the supervisor decides.
 */
export function MySchedulePage() {
  // The month starts at the api's day, not at the browser's, so the demo shows
  // the demo month whatever day the build runs on. The first request has no
  // range, because the client does not know the day yet.
  const [pickedMonth, setPickedMonth] = useState<{ year: number; month: number } | null>(null);

  const range = pickedMonth ? monthRange(pickedMonth) : undefined;
  const { state: scheduleState } = useMySchedule(range?.from, range?.to);
  const { state: offersState, reload: reloadOffers } = useMyOffers();
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
  const month = pickedMonth ?? monthOf(asOf ?? '2026-11-19');
  const next = payload.nextShift;

  const cells: CalendarCell[] = monthGrid(month.year, month.month).map((date) => {
    const inMonth = date.startsWith(`${month.year}-${String(month.month).padStart(2, '0')}`);
    const shift = payload.shifts.find((entry) => entry.date === date);
    return { date, inMonth, items: shift?.items ?? [] };
  });

  // Every pending offer is shown: an officer must not miss one.
  const offers = offersState.kind === 'ready' ? offersState.offers : [];

  const respond = async (offer: MyOffer, response: 'ACCEPT' | 'DECLINE') => {
    try {
      await api.respondToOffer(offer.id, response);
      setAnswers((current) => ({
        ...current,
        [offer.id]:
          response === 'ACCEPT'
            ? 'Accepted. Your supervisor will confirm the assignment.'
            : 'Declined. Thank you - your supervisor has been told.',
      }));
      reloadOffers();
    } catch (error) {
      setAnswers((current) => ({
        ...current,
        [offer.id]:
          error instanceof Error ? error.message : 'The answer could not be recorded.',
      }));
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

      {/* Observation #1: the calendar's chips and the offer states had no key. */}
      <Card>
        <Legend title="Key">
          <LegendItem>
            <ShiftChip template="D8" /> <span>rostered shift, with its times</span>
          </LegendItem>
          <LegendItem>
            <ShiftChip template="D8" worked /> <span>worked (actual recorded)</span>
          </LegendItem>
          <LegendItem>
            <AbsenceChip absenceType="SICK" /> <span>Sick</span>
          </LegendItem>
          <LegendItem>
            <AbsenceChip absenceType="VACATION" /> <span>Vacation</span>
          </LegendItem>
          <span>Offers: waiting for reply · accepted · declined · confirmed</span>
          <span>Overtime = pay-period hours over {payload.payPeriod.thresholdHours} h (status pill)</span>
        </Legend>
      </Card>

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
              setPickedMonth(
                month.month === 1
                  ? { year: month.year - 1, month: 12 }
                  : { year: month.year, month: month.month - 1 },
              )
            }
            onNextMonth={() =>
              setPickedMonth(
                month.month === 12
                  ? { year: month.year + 1, month: 1 }
                  : { year: month.year, month: month.month + 1 },
              )
            }
          />
        </Box>

        <Box sx={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {offers.length === 0 ? (
            <Box
              component="section"
              aria-label="Overtime offer"
              sx={{
                backgroundColor: colour.bg.surface,
                border: `1px solid ${colour.border.default}`,
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
                  color: colour.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Overtime offered to you
              </Box>
              <Box component="span" sx={{ fontSize: 14, color: colour.text.secondary }}>
                No overtime is offered to you right now.
              </Box>
            </Box>
          ) : null}

          {offers.map((offer) => (
            <Box
              key={offer.id}
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

              <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
                {shortDay(offer.openShift.date)} · {shiftTemplates[offer.openShift.shiftTemplate]?.label}{' '}
                {shiftTemplates[offer.openShift.shiftTemplate]?.start} –{' '}
                {shiftTemplates[offer.openShift.shiftTemplate]?.end}
                {shiftTemplates[offer.openShift.shiftTemplate]?.endsNextDay ? ' +1' : ''}
              </Typography>
              <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                {offerSource(offer.openShift.unit.name, offer.offeredBy, offer.offeredAt)} · these
                hours count toward your pay-period hours
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                {offerCheck(offer)}
                {offer.reason ? (
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                    {offer.reason}
                  </Box>
                ) : null}
              </Box>

              {answerFor(offer, answers) ? (
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
                  {answerFor(offer, answers)}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => void respond(offer, 'ACCEPT')}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={() => void respond(offer, 'DECLINE')}
                  >
                    Decline
                  </Button>
                </Box>
              )}
            </Box>
          ))}

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
                disabled={drafts.length === 0}
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
