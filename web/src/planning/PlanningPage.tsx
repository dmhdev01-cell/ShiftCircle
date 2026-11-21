import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

import { shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow, ShiftItem, Unit } from '../api/types';
import { useUnits } from '../api/useUnits';
import { useVersion } from '../api/useVersion';
import { useRole } from '../shell/nav';
import { colour } from '../theme/tokens';
import { KpiTile } from './KpiTile';
import { OverrideDialog } from './OverrideDialog';
import { PublishPeriodButton } from './PublishPeriodButton';
import { RosterGrid } from './RosterGrid';
import { RuleCheckPanel } from './RuleCheckPanel';
import { ShiftActionsDialog } from './ShiftActionsDialog';
import { useRuleCheckedMutation } from './useRuleCheckedMutation';
import { useSchedule } from './useSchedule';

/** Saskatchewan does not observe daylight saving, so the offset is always -06:00. */
const REGINA_OFFSET = '-06:00';

const BLOCK_LABEL = { DAY: 'days', EVENING: 'evenings', NIGHT: 'nights' } as const;

function weekday(date: string): string {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The Monday-to-Sunday week the demo "today" falls in, moved by whole weeks.
 * The board opens on that week and the arrows walk from it, so "Today" is a
 * known place rather than whatever week happens to be on screen (obs. #3).
 */
function weekOf(asOf: string | undefined, offsetWeeks = 0): { from?: string; to?: string } {
  if (!asOf) return {};
  const date = new Date(`${asOf}T00:00:00Z`);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/** "16 – 22 Nov 2026", the range a week picker shows. */
function weekRange(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return '';
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const startDay = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(start);
  const endDay = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(end);
  const endMonth = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(end);
  const endYear = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'UTC' }).format(end);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${startDay} – ${endDay} ${endMonth} ${endYear}`
    : `${startDay} ${new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(start)} – ${endDay} ${endMonth} ${endYear}`;
}

function longDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  return `${dow} ${day} ${month}`;
}

interface Pending {
  officer: OfficerRow;
  date: string;
  template: string;
}

/**
 * The planning board (docs/ui/README.md §5.1). It reads the schedule through
 * the api client, so the same screen works against the real api once
 * `GET /schedule` exists.
 */
export function PlanningPage() {
  const unitsState = useUnits();
  const version = useVersion();
  const { role } = useRole();
  const units: Unit[] = unitsState.kind === 'ready' ? unitsState.units : [];
  const [unitId, setUnitId] = useState<string | null>(null);
  const activeUnitId = unitId ?? units[0]?.id;
  const [weekOffset, setWeekOffset] = useState(0);
  const week = weekOf(
    version.state.status === 'ready' ? version.state.info.asOf : undefined,
    weekOffset,
  );
  const { state, reload } = useSchedule(activeUnitId, week.from, week.to);
  const mutation = useRuleCheckedMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [shiftActions, setShiftActions] = useState<{ officer: OfficerRow; item: ShiftItem } | null>(
    null,
  );
  const [proposal, setProposal] = useState<{ officer: OfficerRow; item: ShiftItem } | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const lastFocus = useRef<HTMLElement | null>(null);

  // Only a supervisor publishes a roster; the api refuses everyone else.
  const canPublish = role.id === 'SUPERVISOR';

  /** Put focus back on the cell or chip that opened the dock. */
  const restoreFocus = () => {
    const target = lastFocus.current;
    lastFocus.current = null;
    window.setTimeout(() => target?.focus?.({ preventScroll: true }), 0);
  };

  // Keep the evidence beside the verdict: a non-modal bottom sheet, and the
  // selected cell scrolled above it.
  const ruleCheckOpen = mutation.state.kind !== 'idle';
  useEffect(() => {
    if (!ruleCheckOpen) return;
    const timer = window.setTimeout(() => {
      const officerId = pending?.officer.employeeId ?? proposal?.officer.employeeId;
      const date = pending?.date ?? proposal?.item.startAt.slice(0, 10);
      if (!officerId || !date) return;
      const cell = document.querySelector<HTMLElement>(
        `[data-officer-id="${officerId}"][data-date="${date}"]`,
      );
      if (!cell) return;
    // Bring the cell into the roster's own horizontal view on a tablet without
    // letting scrollIntoView move the page; then put the row in the part of the
    // page still visible above the fixed verdict sheet (bottom 52vh).
    const region = cell.closest<HTMLElement>('[role="region"]');
    if (region) {
      const cellRect = cell.getBoundingClientRect();
      const regionRect = region.getBoundingClientRect();
      if (cellRect.right > regionRect.right) {
        region.scrollLeft += cellRect.right - regionRect.right + 16;
      } else if (cellRect.left < regionRect.left) {
        region.scrollLeft -= regionRect.left - cellRect.left + 16;
      }
    }
    const top = cell.getBoundingClientRect().top;
      if (top < 80 || top > window.innerHeight * 0.35) {
        try {
          window.scrollTo(0, Math.max(0, window.scrollY + top - 140));
        } catch {
          // jsdom has no layout to scroll.
        }
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [ruleCheckOpen, pending, proposal]);

  useEffect(() => {
    if (!ruleCheckOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // An override dialog above the dock owns Escape first.
      if (document.querySelector('[role="dialog"]')) return;
      setPending(null);
      mutation.reset();
      restoreFocus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ruleCheckOpen, mutation]);

  if (state.kind === 'loading') {
    return (
      <>
        <Typography variant="h1">Planning board</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
              Loading the schedule…
            </Typography>
            <Box sx={{ height: 240, backgroundColor: colour.bg.subtle, borderRadius: '4px' }} />
          </CardContent>
        </Card>
      </>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <Typography variant="h1">Planning board</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the schedule
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>{state.message}</Typography>
            <Box>
              <Button variant="outlined" color="primary" onClick={reload}>
                Try again
              </Button>
            </Box>
          </CardContent>
        </Card>
      </>
    );
  }

  const payload = state.payload;
  const today = payload.asOf;

  const gapBlocks = payload.coverage.filter((block) => !block.covered);
  const gapNote = gapBlocks
    .map((block) => `${weekday(block.date)} ${BLOCK_LABEL[block.block]}`)
    .join(', ');
  const inOvertime = payload.officers.filter((officer) => officer.overtimeStatus === 'IN_OVERTIME');
  const approaching = payload.officers.filter((officer) => officer.overtimeStatus === 'APPROACHING');
  const threshold = payload.officers[0]?.payPeriodThreshold ?? 80;
  // The count is null while the period is not published: there is nothing to
  // compare against yet.
  const changes = payload.publishedState.unpublishedChanges;
  const changesPhrase = changes
    ? changes + ' ' + (changes === 1 ? 'change' : 'changes') + ' since publishing'
    : '';

  const warnCodes =
    mutation.state.outcome?.ruleResults
      .filter(
        (result) =>
          result.outcome === 'WARN' && !mutation.state.acknowledged.includes(result.ruleCode),
      )
      .map((result) => result.ruleCode) ?? [];

  /** Move the board by whole weeks, dropping anything that belonged to the old one. */
  const changeWeek = (next: number) => {
    setWeekOffset(next);
    setPending(null);
    setProposal(null);
    setShiftActions(null);
    setHelpOpen(false);
    mutation.reset();
  };

  const startChoose = (officer: OfficerRow, date: string) => {
    lastFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending({ officer, date, template: 'D8' });
  };

  /**
   * A chip is picked: a proposed shift opens the rule check for the proposal,
   * and a rostered shift can be moved or cancelled.
   */
  const pickChip = (officer: OfficerRow, item: ShiftItem) => {
    setPending(null);
    if (item.proposed) {
      lastFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setProposal({ officer, item });
      void mutation.preview({
        type: 'ASSIGN',
        employeeId: officer.employeeId,
        unitId: payload.unit.id,
        shiftTemplate: item.shiftTemplate,
        startAt: item.startAt,
      });
      return;
    }
    setShiftActions({ officer, item });
  };

  const chooseTemplate = (template: string) => {
    if (!pending) return;
    const chosen = { ...pending, template };
    setPending(chosen);
    mutation.preview({
      type: 'ASSIGN',
      employeeId: chosen.officer.employeeId,
      unitId: payload.unit.id,
      shiftTemplate: chosen.template,
      startAt: `${chosen.date}T${shiftTemplates[chosen.template].start}:00${REGINA_OFFSET}`,
    });
  };

  const cancelChange = () => {
    setPending(null);
    mutation.reset();
    restoreFocus();
  };

  const template = pending ? shiftTemplates[pending.template] : undefined;
  // "Find eligible officer" takes the slot with it: the unit and the start
  // instant are what the overtime board can match against an open shift.
  const requestedStart = pending && template ? `${pending.date}T${template.start}:00${REGINA_OFFSET}` : proposal?.item.startAt;
  const findEligibleHref =
    requestedStart === undefined
      ? '/overtime'
      : `/overtime?unit=${encodeURIComponent(payload.unit.id)}&startAt=${encodeURIComponent(requestedStart)}`;
  const panelTitle = pending
    ? `Assign ${pending.officer.name} → ${template?.label ?? pending.template}`
    : proposal
      ? `Assign ${proposal.officer.name} → ${shiftTemplates[proposal.item.shiftTemplate]?.label ?? proposal.item.shiftTemplate}`
      : shiftActions
        ? `${shiftActions.officer.name} · ${shiftTemplates[shiftActions.item.shiftTemplate]?.label ?? shiftActions.item.shiftTemplate}`
        : '';
  const panelDetail =
    pending && template
      ? `${payload.unit.name} · ${longDay(pending.date)} · ${template.start} – ${template.end}${template.endsNextDay ? ' +1' : ''}`
      : proposal
        ? `${payload.unit.name} · ${longDay(proposal.item.startAt.slice(0, 10))} · ${shiftTemplates[proposal.item.shiftTemplate]?.start ?? ''} – ${shiftTemplates[proposal.item.shiftTemplate]?.end ?? ''}`
        : shiftActions
          ? `${shiftActions.officer.name} · ${shiftActions.item.startAt.slice(0, 10)}`
          : '';

  return (
    <>
      <Box
        component="a"
        href="#roster"
        sx={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 44,
          px: 2,
          fontSize: 14,
          fontWeight: 600,
          color: colour.brand.link,
        }}
      >
        Skip to roster
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h1">Planning board</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            {payload.unit.name} ·{' '}
            <strong style={{ color: colour.text.primary }}>
              {payload.publishedState.published ? 'Published' : 'Not published'}
            </strong>
            {changesPhrase ? ', ' + changesPhrase : ''}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2.5 }}>
          {/* Observation #3: the board was pinned to the week of the demo day.
              The api takes any range, so the arrows walk whole weeks from it. */}
          <Box
            role="group"
            aria-label="Week"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
          >
            <Button variant="outlined" color="primary" onClick={() => changeWeek(weekOffset - 1)}>
              Previous week
            </Button>
            <Box component="span" className="num" sx={{ fontSize: 13, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>
              {weekRange(week.from, week.to)}
            </Box>
            <Button variant="outlined" color="primary" onClick={() => changeWeek(weekOffset + 1)}>
              Next week
            </Button>
            <Button
              variant="outlined"
              color="primary"
              disabled={weekOffset === 0}
              onClick={() => changeWeek(0)}
            >
              Today
            </Button>
          </Box>
          <Button variant="outlined" color="primary" onClick={() => setHelpOpen(true)}>
            Rules help
          </Button>
          {canPublish && payload.period ? (
            <PublishPeriodButton period={payload.period} onPublished={reload} />
          ) : null}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              fontSize: 12,
              fontWeight: 600,
              color: colour.text.secondary,
            }}
          >
            Unit
            <Box
              component="select"
              aria-label="Unit"
              value={payload.unit.id}
              onChange={(event) => setUnitId(event.target.value)}
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
              {(units.length > 0
                ? units
                : [
                    {
                      id: payload.unit.id,
                      name: payload.unit.name,
                    } as Unit,
                  ]
              ).map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 3,
        }}
      >
        <KpiTile label="Coverage gaps" value={gapBlocks.length} note={gapNote} />
        <KpiTile label="In overtime" value={inOvertime.length} note="this pay period" />
        <KpiTile
          label="Approaching overtime"
          value={approaching.length}
          note={`within 8 h of ${threshold} h`}
        />
        <KpiTile label="Rule warnings" value={payload.warnings} note="on the published week" />
        <KpiTile
          label="Overrides this period"
          value={payload.overridesThisPeriod}
          note="emergency, with reason"
        />
      </Box>

      {helpOpen && !ruleCheckOpen ? (
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Rule check</Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Pick an empty cell to propose a shift. The rules are checked before anything is
              saved, and a rule that blocks the change has to be overridden with a written reason.
            </Typography>
            <Box>
              <Button variant="outlined" color="primary" onClick={() => setHelpOpen(false)}>
                Close
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : null}

      <Box
        component="section"
        id="roster"
        aria-label="Roster"
        tabIndex={-1}
        sx={{ minWidth: 0, outline: 'none' }}
      >
        <RosterGrid
          payload={payload}
          today={today}
          onEmptyCell={startChoose}
          onPickChip={pickChip}
        />
      </Box>

      {ruleCheckOpen ? <Box aria-hidden="true" sx={{ height: '52vh', flexShrink: 0 }} /> : null}

      {ruleCheckOpen ? (
        <Box
          role="region"
          aria-label="Rule check"
          sx={{
            position: 'fixed',
            left: { xs: 0, md: '220px' },
            right: 0,
            bottom: 0,
            zIndex: (theme) => theme.zIndex.drawer - 1,
            maxHeight: '52vh',
            overflowY: 'auto',
            p: 3,
            backgroundColor: colour.bg.surface,
            borderTop: `3px solid ${colour.brand.primary}`,
            boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.18)',
          }}
        >
          <RuleCheckPanel
            state={mutation.state}
            title={panelTitle}
            detail={panelDetail}
            findEligibleHref={findEligibleHref}
            onSave={() => {
              // A saved change moves the board: read it again (D9).
              if (mutation.state.change) {
                void mutation.save(mutation.state.change).then((saved) => {
                  if (saved) reload();
                });
              }
            }}
            onAcknowledge={(codes) => {
              if (mutation.state.change) {
                void mutation.save(mutation.state.change, { acknowledgeWarnings: codes }).then((saved) => {
                  if (saved) reload();
                });
              }
            }}
            onOverride={() => setOverrideOpen(true)}
            onCancel={cancelChange}
          />
        </Box>
      ) : null}

      <Dialog
        open={pending !== null && mutation.state.kind === 'idle'}
        onClose={cancelChange}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
          {pending ? `Assign a shift to ${pending.officer.name}` : 'Assign a shift'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
            {pending
              ? `${payload.unit.name} · ${longDay(pending.date)}. The rules are checked before the shift is saved.`
              : ''}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {Object.values(shiftTemplates).map((option) => (
              <Button
                key={option.code}
                variant="outlined"
                color="primary"
                onClick={() => chooseTemplate(option.code)}
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
          <Button variant="outlined" color="primary" onClick={cancelChange}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {shiftActions ? (
        <ShiftActionsDialog
          officer={shiftActions.officer}
          item={shiftActions.item}
          unitId={payload.unit.id}
          onClose={() => setShiftActions(null)}
          onChanged={reload}
        />
      ) : null}

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
          if (mutation.state.change) {
            // The warnings are acknowledged with the override, or the api
            // refuses the change.
            void mutation
              .save(mutation.state.change, {
                override: { reason },
                ...(warnCodes.length > 0 ? { acknowledgeWarnings: warnCodes } : {}),
              })
              .then((saved) => {
                if (saved) reload();
              });
          }
        }}
      />
    </>
  );
}
