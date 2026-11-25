import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import { useUnits } from '../api/useUnits';
import { shiftTemplates } from '../api/shiftTemplates';
import type { OpenShift, RuleCheckChange } from '../api/types';
import { useVersion } from '../api/useVersion';
import { StatusPill } from '../components/StatusPill';
import { OverrideDialog } from '../planning/OverrideDialog';
import { RuleCheckPanel } from '../planning/RuleCheckPanel';
import { useRuleCheckedMutation } from '../planning/useRuleCheckedMutation';
import { colour } from '../theme/tokens';
import { CandidateTable } from './CandidateTable';
import { orderOpenShifts } from './openShiftOrder';
import { useOpenShiftCandidates, useOpenShifts } from './useOvertime';

const BLOCK_LABEL: Record<string, string> = {
  D8: 'Days',
  E8: 'Evenings',
  N8: 'Nights',
};

function shortDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  return `${dow} ${day} ${month}`;
}

function openShiftTitle(openShift: OpenShift): string {
  const template = shiftTemplates[openShift.shiftTemplate];
  const block = BLOCK_LABEL[openShift.shiftTemplate] ?? template?.label ?? openShift.shiftTemplate;
  const times = template
    ? `${template.start} – ${template.end}${template.endsNextDay ? ' +1' : ''}`
    : '';
  return `${shortDay(openShift.date)} · ${block} ${times}`;
}

function statusPill(openShift: OpenShift) {
  if (openShift.status === 'FILLED') {
    return { text: 'Filled', tone: 'pass' as const };
  }
  if (openShift.status === 'CANCELLED') {
    return { text: 'Cancelled', tone: 'block' as const };
  }
  if (openShift.status === 'OFFERS_SENT') {
    return { text: 'Offers sent', tone: 'ot' as const };
  }
  return { text: 'Open', tone: 'warn' as const };
}

const OFFER_TONE = {
  OFFERED: 'warn',
  ACCEPTED: 'info',
  DECLINED: 'info',
  CONFIRMED: 'pass',
} as const;

const OFFER_TEXT = {
  OFFERED: 'Waiting for reply',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CONFIRMED: 'Confirmed',
} as const;

/**
 * The slot the planning board asked about has no open shift (M3). Creating an
 * open shift from here is not built, so the next step is the planning board.
 */
function MissingSlot({ unitId, startAt }: { unitId: string | null; startAt: string | null }) {
  // Units are read only here, so the normal board keeps its request count.
  const units = useUnits();
  const unitName =
    units.kind === 'ready' ? units.units.find((unit) => unit.id === unitId)?.name : undefined;
  // The planning board writes a local time with an offset, so the date and
  // the clock time are read straight from the string.
  const local = startAt?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const slot = [unitName, local ? `${shortDay(local[1])} ${local[2]}` : null]
    .filter(Boolean)
    .join(' · ');
  const params = new URLSearchParams();
  if (unitId) params.set('unit', unitId);
  if (local) params.set('week', local[1]);
  const query = params.toString();
  return (
    <Box
      role="note"
      aria-label="No open shift for this slot"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <Typography component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 700 }}>
        No open shift for this slot yet
      </Typography>
      {slot ? (
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{slot}</Typography>
      ) : null}
      <Typography sx={{ fontSize: 14, color: colour.text.secondary, lineHeight: 1.5 }}>
        This slot is not on the overtime board, so there is no ranked list of officers for it.
        Posting a new open shift from here is not available in this prototype. Next step: go back
        to the planning board and assign another officer to the slot, or pick an open shift on
        this board.
      </Typography>
      <Box>
        <Button
          variant="contained"
          color="primary"
          component={Link}
          to={query ? `/planning?${query}` : '/planning'}
        >
          Back to the planning board
        </Button>
      </Box>
    </Box>
  );
}

/**
 * The overtime board (docs/ui/README.md §5.3). The open shifts come from the
 * api and the ranked list comes from the overtime-ranking rule table, so the
 * screen never makes up an order or a reason.
 *
 * Only a supervisor may offer overtime or confirm an extra shift (S-04), and
 * this is the supervisor's screen.
 */
export function OvertimePage() {
  const { state: shiftsState, reload: reloadShifts } = useOpenShifts();
  const [searchParams] = useSearchParams();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const { state: version } = useVersion();
  const asOf = version.status === 'ready' ? version.info.asOf : undefined;
  const shifts = shiftsState.kind === 'ready' ? shiftsState.shifts : [];
  const { current, others } = orderOpenShifts(shifts, asOf, confirmedId);
  // "Find eligible officer" names the shift it came from, so the board opens
  // on that shift rather than whatever happens to be first.
  const requestedId = searchParams.get('shift');
  const requestedUnit = searchParams.get('unit');
  const requestedStart = searchParams.get('startAt');
  const requested =
    shifts.find((shift) => shift.id === requestedId) ??
    shifts.find(
      (shift) =>
        requestedUnit !== null &&
        requestedStart !== null &&
        shift.unit.id === requestedUnit &&
        // The api writes instants as Z while the planning board writes an
        // offset; compare the instant, not the string.
        new Date(shift.startAt).getTime() === new Date(requestedStart).getTime(),
    ) ??
    null;
  // M3: a slot the planning board sent that has no open shift must not open
  // some other shift's ranked list as if it were the answer. Say so instead.
  const slotMissing =
    shiftsState.kind === 'ready' &&
    requested === null &&
    (requestedId !== null || (requestedUnit !== null && requestedStart !== null));
  // The requested shift is selected until the supervisor picks another; with
  // no request the board opens on the nearest current need, not on the oldest
  // filled shift in the data (V7).
  const activeId =
    pickedId ??
    requested?.id ??
    (slotMissing ? null : (current[0]?.id ?? others[0]?.id ?? null));
  const { state: candidatesState, reload: reloadCandidates } = useOpenShiftCandidates(activeId);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const mutation = useRuleCheckedMutation();

  if (shiftsState.kind === 'loading') {
    return (
      <>
        <Typography variant="h1">Overtime board</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
          Loading the open shifts…
        </Typography>
      </>
    );
  }

  if (shiftsState.kind === 'error') {
    return (
      <>
        <Typography variant="h1">Overtime board</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the open shifts
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              {shiftsState.message}
            </Typography>
          </CardContent>
        </Card>
      </>
    );
  }

  const activeShift = shifts.find((shift) => shift.id === activeId);
  const payload = candidatesState.kind === 'ready' ? candidatesState.payload : undefined;
  // A filled or cancelled shift takes no offers and no direct assignment.
  const offersClosed =
    activeShift?.status === 'FILLED' || activeShift?.status === 'CANCELLED';

  const confirmOffer = async (offerId: string) => {
    try {
      await api.confirmOffer(offerId);
      setMessage('The accepted offer is confirmed and the shift is assigned.');
      reloadCandidates();
      // The open shift is FILLED now: refetch the cards so this one stops
      // saying "Offers sent" (v1.2 walk D5). It stays selected and in its
      // place among the current needs, now reading "Filled".
      if (activeId) {
        setPickedId(activeId);
        setConfirmedId(activeId);
      }
      reloadShifts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The offer could not be confirmed.');
    }
  };

  const toggleOfficer = (employeeId: string) => {
    setSelected((current) =>
      current.includes(employeeId)
        ? current.filter((entry) => entry !== employeeId)
        : [...current, employeeId],
    );
  };

  const offerToSelected = async () => {
    if (!activeShift || selected.length === 0) return;
    try {
      await api.createOffers(activeShift.id, selected);
      setMessage(
        `${selected.length} offer${selected.length === 1 ? '' : 's'} recorded. The officers answer in ShiftCircle; email and text alerts are future work.`,
      );
      setSelected([]);
      reloadCandidates();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The offers could not be recorded.');
    }
  };

  const directAssignChange: RuleCheckChange | undefined =
    activeShift && selected.length === 1
      ? {
          type: 'ASSIGN',
          employeeId: selected[0],
          unitId: activeShift.unit.id,
          shiftTemplate: activeShift.shiftTemplate,
          startAt: activeShift.startAt,
        }
      : undefined;

  const startDirectAssign = () => {
    if (!directAssignChange) return;
    setMessage(null);
    void mutation.preview(directAssignChange);
  };

  const warnCodes =
    mutation.state.outcome?.ruleResults
      .filter(
        (result) =>
          result.outcome === 'WARN' && !mutation.state.acknowledged.includes(result.ruleCode),
      )
      .map((result) => result.ruleCode) ?? [];

  const directAssignTitle =
    activeShift && selected.length === 1
      ? `Assign ${payload?.candidates.find((c) => c.employeeId === selected[0])?.name ?? 'this officer'}`
      : '';

  const renderCard = (openShift: OpenShift) => {
    const pill = statusPill(openShift);
    const isActive = openShift.id === activeId;
    return (
      <Box
        key={openShift.id}
        component="button"
        type="button"
        aria-pressed={isActive}
        onClick={() => {
          setPickedId(openShift.id);
          // Only the card just confirmed keeps its place among the current needs,
          // until the supervisor picks another.
          if (openShift.id !== confirmedId) setConfirmedId(null);
          setSelected([]);
          setMessage(null);
          mutation.reset();
        }}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          width: '100%',
          minHeight: 44,
          p: '12px 14px',
          textAlign: 'left',
          backgroundColor: isActive ? '#EAF3F9' : colour.bg.surface,
          border: isActive ? `2px solid ${colour.brand.link}` : `1px solid #D5DDE7`,
          borderRadius: '10px',
          fontFamily: 'inherit',
          color: colour.text.primary,
          cursor: 'pointer',
          '&:hover': { borderColor: colour.brand.link },
        }}
      >
        <Box component="span" sx={{ fontSize: 15, fontWeight: 700 }}>
          {openShiftTitle(openShift)}
        </Box>
        <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
          {openShift.unit.name}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
          {openShift.reason ? (
            <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
              {openShift.reason}
            </Box>
          ) : null}
        </Box>
      </Box>
    );
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">Overtime board</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          Current needs first · filled and past shifts are kept below · offers are recorded in
          ShiftCircle (email and text alerts are future work)
        </Typography>
      </Box>

      {message ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.info.bg,
            color: colour.status.info.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {message}
        </Box>
      ) : null}

      <Box
        sx={{
          display: 'flex',
          // Below md the ranked table would sit under a stack of cards, so the
          // selected shift's table comes first on a tablet (V7).
          flexDirection: { xs: 'column-reverse', md: 'row' },
          flexWrap: { md: 'wrap' },
          gap: 5,
          alignItems: 'flex-start',
        }}
      >
        <Box
          component="section"
          aria-label="Open shifts"
          sx={{
            flex: { xs: '1 1 auto', md: '1 1 300px' },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          <Typography component="h2" sx={{ m: 0, fontSize: 15, fontWeight: 700 }}>
            Open shifts{' '}
            <Box component="span" className="num" sx={{ color: colour.text.secondary, fontWeight: 600 }}>
              ({current.length})
            </Box>
          </Typography>

          {current.map(renderCard)}

          {current.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
              No shift is short of officers right now.
            </Typography>
          ) : null}

          {/* Filled, cancelled and past shifts stay on the page for the record,
              behind one button, so they cannot bury the current need (V7). */}
          {others.length > 0 ? (
            <Button
              variant="text"
              color="primary"
              aria-expanded={showOthers}
              onClick={() => setShowOthers((value) => !value)}
              sx={{ justifyContent: 'flex-start', px: 1, minHeight: 44 }}
            >
              {showOthers ? 'Hide' : 'Show'} filled and past shifts ({others.length})
            </Button>
          ) : null}

          {showOthers ? others.map(renderCard) : null}
        </Box>

        <Box
          component="section"
          aria-label="Eligible officers"
          sx={{
            flex: { xs: '1 1 auto', md: '999 1 640px' },
            minWidth: 0,
            backgroundColor: colour.bg.surface,
            border: `1px solid ${colour.border.default}`,
            borderRadius: '10px',
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {!activeShift && slotMissing ? (
            <MissingSlot unitId={requestedUnit} startAt={requestedStart} />
          ) : null}

          {!activeShift && !slotMissing ? (
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              No open shift is selected.
            </Typography>
          ) : null}

          {activeShift ? (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 3,
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 700 }}>
                  {openShiftTitle(activeShift)}
                </Typography>
                <Typography component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                  {activeShift.unit.name} · needs {activeShift.needs} officer
                  {activeShift.needs === 1 ? '' : 's'}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  maxWidth: 360,
                  p: '10px 12px',
                  backgroundColor: colour.bg.subtle,
                  border: `1px solid ${colour.border.default}`,
                  borderRadius: '8px',
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                <Box component="strong" sx={{ color: colour.text.primary }}>
                  Fair-distribution order (O-02, rule tables v{payload?.ruleSetVersion ?? '—'})
                </Box>
                {payload?.rankingNote ??
                  'Fewest overtime hours this quarter first, then seniority. Officers who would break a Block rule are skipped without losing their place.'}
              </Box>
            </Box>
          ) : null}

          {candidatesState.kind === 'loading' ? (
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
              Loading the ranked list…
            </Typography>
          ) : null}

          {candidatesState.kind === 'error' ? (
            <Typography sx={{ fontSize: 14, color: colour.status.block.text }}>
              {candidatesState.message}
            </Typography>
          ) : null}

          {payload ? (
            <>
              <CandidateTable
                candidates={payload.candidates}
                selected={selected}
                onToggle={toggleOfficer}
                offersClosed={offersClosed}
              />

              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 3,
                }}
              >
                <Typography
                  component="span"
                  sx={{ fontSize: 12, color: colour.text.secondary, maxWidth: 520, lineHeight: 1.45 }}
                >
                  Ordered (mandatory) overtime is only offered once the voluntary list is used up, in
                  reverse order, at most once per officer every 14 days (O-04).
                </Typography>
                {offersClosed ? (
                  <Box
                    role="status"
                    sx={{
                      p: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor:
                        activeShift?.status === 'CANCELLED'
                          ? colour.status.block.bg
                          : colour.status.info.bg,
                      color:
                        activeShift?.status === 'CANCELLED'
                          ? colour.status.block.text
                          : colour.status.info.text,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {activeShift?.status === 'CANCELLED'
                      ? 'This shift was cancelled. No offers can be made.'
                      : 'This shift is filled. No offers can be made.'}
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    <Button
                      variant="outlined"
                      color="primary"
                      disabled={selected.length !== 1}
                      onClick={startDirectAssign}
                    >
                      Assign directly…
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      disabled={selected.length === 0}
                      onClick={() => void offerToSelected()}
                    >
                      Offer to selected ({selected.length})
                    </Button>
                  </Box>
                )}
              </Box>
            </>
          ) : null}

          {mutation.state.kind !== 'idle' ? (
            <RuleCheckPanel
              state={mutation.state}
              title={directAssignTitle}
              findEligibleHref={
                activeShift ? `/overtime?shift=${activeShift.id}` : '/overtime'
              }
              detail={
                activeShift
                  ? `${activeShift.unit.name} · ${shortDay(activeShift.date)}`
                  : ''
              }
              onSave={() => {
                if (!directAssignChange || !activeShift) return;
                void mutation.save(directAssignChange, undefined, () =>
                  api.assignOpenShift(activeShift.id, selected[0]),
                );
              }}
              onAcknowledge={(codes) => {
                if (!directAssignChange || !activeShift) return;
                // The same saver as the save: the open shift is assigned, not
                // a new assignment.
                void mutation.save(
                  directAssignChange,
                  { acknowledgeWarnings: codes },
                  () => api.assignOpenShift(activeShift.id, selected[0]),
                );
              }}
              onOverride={() => setOverrideOpen(true)}
              onCancel={() => mutation.reset()}
            />
          ) : null}

          {payload && payload.history.length > 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                pt: 3,
                borderTop: `1px solid ${colour.border.default}`,
              }}
            >
              <Typography component="h3" sx={{ m: 0, fontSize: 14, fontWeight: 700 }}>
                Offer history
              </Typography>
              {payload.history.map((entry, index) => (
                <Box
                  key={`${entry.at}-${entry.employeeId}-${index}`}
                  role="group"
                  aria-label={`${entry.employeeName} · ${OFFER_TEXT[entry.status]}`}
                  sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', fontSize: 13 }}
                >
                  <Box component="span" className="num" sx={{ color: colour.text.secondary, minWidth: 42 }}>
                    {entry.at}
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {entry.employeeName}
                  </Box>
                  <StatusPill tone={OFFER_TONE[entry.status]}>{OFFER_TEXT[entry.status]}</StatusPill>
                  {entry.status === 'ACCEPTED' && !offersClosed ? (
                    <Button
                      variant="outlined"
                      color="primary"
                      onClick={() => void confirmOffer(entry.id)}
                    >
                      Confirm
                    </Button>
                  ) : null}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      </Box>

      <OverrideDialog
        open={overrideOpen}
        ruleCodes={
          mutation.state.outcome?.ruleResults
            .filter((result) => result.outcome === 'BLOCK')
            .map((result) => result.ruleCode) ?? []
        }
        warningCodes={warnCodes}
        onClose={() => setOverrideOpen(false)}
        onConfirm={(reason) => {
          setOverrideOpen(false);
          if (!directAssignChange || !activeShift) return;
          // The warnings are acknowledged with the override, or the api
          // refuses the change.
          void mutation.save(
            directAssignChange,
            {
              override: { reason },
              ...(warnCodes.length > 0 ? { acknowledgeWarnings: warnCodes } : {}),
            },
            () => api.assignOpenShift(activeShift.id, selected[0]),
          );
        }}
      />
    </>
  );
}
