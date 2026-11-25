import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import GlobalStyles from '@mui/material/GlobalStyles';
import Typography from '@mui/material/Typography';

import { qualificationLabel } from '../api/qualifications';
import { assignableTemplates, shiftTemplates } from '../api/shiftTemplates';
import type { Block, BlockCoverage, OfficerRow, ShiftItem, Unit } from '../api/types';
import { useUnits } from '../api/useUnits';
import { useVersion } from '../api/useVersion';
import { useRole } from '../shell/nav';
import { boardPrintStyles } from '../theme/print';
import { colour, focusRing } from '../theme/tokens';
import { addDays, weekdayDateWords } from '../planner/unitDates';
import { GAP_PANEL_HEADING_ID, GapFillPanel } from './GapFillPanel';
import { BLOCK_TEMPLATES, dayWords, isFillable } from './gapFill';
import { KpiTile } from './KpiTile';
import {
  BOARD_VIEWS,
  mondayOf,
  parseDensity,
  parseView,
  rangeFor,
  isIsoDate,
  payPeriodOf,
  rangeWords,
  stepFocus,
} from './rosterView';
import type { BoardView, RosterDensity } from './rosterView';
import { OverrideDialog } from './OverrideDialog';
import { PublishPeriodButton } from './PublishPeriodButton';
import { copyText, downloadCsv, exportFileName, rosterRows, toCsv, toTsv } from './exportRoster';
import { RosterFilters } from './RosterFilters';
import {
  applyRosterFilters,
  effectiveFilters,
  filterWords,
  isFiltered,
  parseFilters,
  qualificationOptions,
  rotationOptions,
  writeFilters,
} from './filterRoster';
import type { RosterFilterState } from './filterRoster';
import { RosterGrid } from './RosterGrid';
import { RuleCheckPanel } from './RuleCheckPanel';
import { isSupervisorPost, nameWithPosition, unitGroups } from './supervisorPosts';
import { RulesHelpDialog } from './RulesHelpDialog';
import { ShiftActionsDialog } from './ShiftActionsDialog';
import { boardNow } from './shiftWords';
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

/** Segmented toggle buttons: the board's view and its density. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{ display: 'inline-flex', border: `1px solid ${colour.brand.link}`, borderRadius: '2px', overflow: 'hidden' }}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            sx={{
              minHeight: 44,
              px: 3,
              border: 0,
              borderLeft: index > 0 ? `1px solid ${colour.brand.link}` : 0,
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              color: selected ? colour.text.onDark : colour.brand.link,
              backgroundColor: selected ? colour.brand.link : colour.bg.surface,
              '&:hover': selected ? {} : { backgroundColor: colour.bg.linkHover },
              // The ring sits inside the group (which clips), so it needs 3:1
              // against both the white and the selected blue (WCAG 1.4.11).
              '&:focus-visible': {
                outline: `3px solid ${selected ? focusRing.onDark : focusRing.onLight}`,
                outlineOffset: '-5px',
              },
            }}
          >
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}

const DENSITIES: { id: RosterDensity; label: string }[] = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
];

/** The words the navigation uses for each view: "Previous week", "Next period", … */
const STEP_NOUN: Record<BoardView, string> = { week: 'week', period: 'period', month: 'month' };
const GROUP_LABEL: Record<BoardView, string> = { week: 'Week', period: 'Pay period', month: 'Month' };

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [unitId, setUnitId] = useState<string | null>(null);
  const activeUnitId = unitId ?? searchParams.get('unit') ?? units[0]?.id;
  // The address is the source of truth: ?unit= and ?week= (a Monday) let the
  // planner's links open the board on a chosen week, and a reload or Back keeps
  // the week the person was looking at (observation #3 follow-up). A1 adds
  // ?view= (period or month; a week has none) and ?density=; the week stays
  // the focus, so switching views keeps the same place in time.
  const view = parseView(searchParams.get('view'));
  const density = parseDensity(searchParams.get('density'), view);
  // A malformed ?week= (a hand-edited or truncated link) falls back to the
  // demo week instead of throwing on an Invalid Date.
  const rawWeek = searchParams.get('week');
  const weekParam = rawWeek && isIsoDate(rawWeek) ? rawWeek : null;
  const asOf = version.state.status === 'ready' ? version.state.info.asOf : undefined;
  const demoMonday = asOf ? mondayOf(asOf) : undefined;
  const focus = weekParam ? mondayOf(weekParam) : demoMonday;
  const range: { from?: string; to?: string } = focus ? rangeFor(view, focus) : {};
  const showsToday =
    asOf !== undefined && range.from !== undefined && range.to !== undefined
      ? asOf >= range.from && asOf <= range.to
      : true;
  const { state, reload } = useSchedule(activeUnitId, range.from, range.to);
  const mutation = useRuleCheckedMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [shiftActions, setShiftActions] = useState<{ officer: OfficerRow; item: ShiftItem } | null>(
    null,
  );
  const [proposal, setProposal] = useState<{ officer: OfficerRow; item: ShiftItem } | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const lastFocus = useRef<HTMLElement | null>(null);
  // A2: the gap the fill panel shows, its template and what opened it.
  const [gap, setGap] = useState<{ date: string; block: Block } | null>(null);
  const [gapTemplate, setGapTemplate] = useState('D8');
  const gapTrigger = useRef<HTMLElement | null>(null);
  // A2: the API's pay-period hours are for the period of the board's first
  // day. A gap in another period (a month view) reads that period's own
  // schedule, so the ranking and the OT hints use the right hours.
  const boardFirstDay = state.kind === 'ready' ? state.payload.days[0] : undefined;
  const gapPeriod =
    gap && boardFirstDay && payPeriodOf(gap.date).from !== payPeriodOf(boardFirstDay).from
      ? payPeriodOf(gap.date)
      : null;
  const gapPeriodSchedule = useSchedule(
    gapPeriod ? activeUnitId : undefined,
    gapPeriod?.from,
    gapPeriod?.to,
  );
  /** A saved change moves the board and, in a month, the gap's own period. */
  const reloadAll = () => {
    reload();
    if (gapPeriod) gapPeriodSchedule.reload();
  };

  // Only a supervisor publishes a roster; the api refuses everyone else.
  const canPublish = role.id === 'SUPERVISOR';
  // The facility planner reads the board (the commit links land here); every
  // write stays with the supervisors who own the units (docs/ui/planner.md §11 Q1).
  const readOnly = role.id === 'PLANNER';

  /** Put focus back on the cell or chip that opened the dock. */
  const restoreFocus = () => {
    const target = lastFocus.current;
    lastFocus.current = null;
    window.setTimeout(() => {
      // A2: a "Check & assign" button is gone once its officer is assigned;
      // the gap panel's heading takes the focus instead.
      if (target && !target.isConnected) {
        document.getElementById(GAP_PANEL_HEADING_ID)?.focus({ preventScroll: true });
        return;
      }
      target?.focus?.({ preventScroll: true });
    }, 0);
  };

  /** A2: close the gap panel and put focus back on the gap that opened it. */
  const closeGap = useCallback(() => {
    setGap(null);
    const target = gapTrigger.current;
    gapTrigger.current = null;
    window.setTimeout(() => target?.focus?.({ preventScroll: true }), 0);
  }, []);

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

  // A2: Escape closes the gap panel when nothing sits above it.
  const gapPanelShown = gap !== null && !ruleCheckOpen && pending === null;
  useEffect(() => {
    if (!gapPanelShown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      closeGap();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [gapPanelShown, closeGap]);

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
  const unitPickerGroups = unitGroups(units);
  const onPost = isSupervisorPost(payload.unit);

  const gapBlocks = payload.coverage.filter((block) => !block.covered);
  // A week names the weekday; a longer span adds the date so "Sat" is not two days.
  const gapWords = gapBlocks.map((block) =>
    payload.days.length > 7
      ? `${weekday(block.date)} ${Number(block.date.slice(8, 10))} ${BLOCK_LABEL[block.block]}`
      : `${weekday(block.date)} ${BLOCK_LABEL[block.block]}`,
  );
  // A long span can have dozens of gaps: name the first three and count the rest.
  const gapNote =
    payload.days.length > 7 && gapWords.length > 3
      ? `${gapWords.slice(0, 3).join(', ')} and ${gapWords.length - 3} more`
      : gapWords.join(', ');
  // A2: the gap words become buttons that open the fill panel (a supervisor,
  // today or later); past gaps stay words.
  const canFill = (block: BlockCoverage) => !readOnly && isFillable(block, today);
  // A long span names the same first three as the plain note and counts the
  // rest, so no button is clipped out of sight in the compact chip.
  const namedGaps = payload.days.length > 7 && gapWords.length > 3 ? 3 : gapWords.length;
  const gapNoteContent = gapBlocks.slice(0, namedGaps).some(canFill)
    ? [
        ...gapBlocks.slice(0, namedGaps).map((block, index) => {
        const words = gapWords[index];
        return (
          <Fragment key={`${block.date}-${block.block}`}>
            {index > 0 ? ', ' : ''}
            {canFill(block) ? (
              <Box
                component="button"
                type="button"
                onClick={() => openGap(block)}
                aria-label={`Fill gap: ${words}, ${dayWords(block.date)}`}
                sx={{
                  p: 0,
                  border: 0,
                  background: 'none',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  fontWeight: 600,
                  color: colour.brand.link,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  '&:hover': { color: colour.brand.linkHover },
                  '&:focus-visible': { outline: `3px solid ${focusRing.onLight}`, outlineOffset: '1px' },
                }}
              >
                {words}
              </Box>
            ) : (
              words
            )}
          </Fragment>
        );
      }),
        namedGaps < gapWords.length ? ` and ${gapWords.length - namedGaps} more` : null,
      ]
    : undefined;
  const inOvertime = payload.officers.filter((officer) => officer.overtimeStatus === 'IN_OVERTIME');
  const approaching = payload.officers.filter((officer) => officer.overtimeStatus === 'APPROACHING');
  const threshold = payload.officers[0]?.payPeriodThreshold ?? 80;
  // The count is null while the period is not published: there is nothing to
  // compare against yet.
  const changes = payload.publishedState.unpublishedChanges;
  const changesPhrase = changes
    ? changes + ' ' + (changes === 1 ? 'change' : 'changes') + ' since publishing'
    : '';

  // Publication is per roster period (a week in the 2026 demo data, two weeks
  // in a committed 2027 plan). The API names the period only when the range
  // on screen sits inside one; otherwise the board says so instead of
  // claiming "Not published" for weeks that may well be published.
  const onePeriod = payload.period != null || view === 'week';

  const compactKpis = density === 'compact';
  // The API reports overtime for the pay period of the first day on screen,
  // and counts overrides over the days on screen; the notes say exactly that.
  const firstPayPeriod = payload.days.length > 0 ? payPeriodOf(payload.days[0]) : null;
  const overtimeNote =
    view === 'month' && firstPayPeriod
      ? `pay period ${rangeWords(firstPayPeriod.from, firstPayPeriod.to)}`
      : 'this pay period';
  const kpis: {
    label: string;
    value: number;
    note: string;
    highlight?: boolean;
    noteContent?: ReactNode;
  }[] = [
    {
      label: 'Coverage gaps',
      value: gapBlocks.length,
      note: gapNote,
      highlight: gapBlocks.length > 0,
      noteContent: gapNoteContent,
    },
    { label: 'In overtime', value: inOvertime.length, note: overtimeNote },
    { label: 'Approaching overtime', value: approaching.length, note: `within 8 h of ${threshold} h` },
    {
      label: 'Rule warnings',
      value: payload.warnings,
      note: view === 'week' ? 'on the published week' : 'on published weeks',
    },
    view === 'week'
      ? { label: 'Overrides this period', value: payload.overridesThisPeriod, note: 'emergency, with reason' }
      : { label: 'Overrides in view', value: payload.overridesThisPeriod, note: 'emergency, with reason' },
  ];

  const warnCodes =
    mutation.state.outcome?.ruleResults
      .filter(
        (result) =>
          result.outcome === 'WARN' && !mutation.state.acknowledged.includes(result.ruleCode),
      )
      .map((result) => result.ruleCode) ?? [];

  // A3: find, filter and sort the rows already loaded. The address keeps the
  // choice (q, ot, rot, works, qual, sort); with none, the board is unchanged.
  // A rotation or qualification no row here has (a bookmark, another unit)
  // reads as All rather than an empty select and an empty board.
  const filters = effectiveFilters(parseFilters(searchParams), payload.officers);
  const filtered = isFiltered(filters);
  const shownOfficers = applyRosterFilters(payload.officers, filters);
  const qualificationCodes = qualificationOptions(payload.officers);
  const rotationChoices = rotationOptions(payload.officers);
  // A month is too wide for one landscape page; a week or a pay period fits.
  const printable = payload.days.length <= 14;

  const changeFilters = (next: RosterFilterState) => {
    setExportStatus('');
    setSearchParams(writeFilters(searchParams, next), { replace: true });
  };

  const officersWord = (count: number) => `${count} ${count === 1 ? 'officer' : 'officers'}`;

  const exportView = () => {
    downloadCsv(exportFileName(payload, filtered), toCsv(rosterRows(payload, shownOfficers, filtered)));
    setExportStatus(`CSV saved: ${officersWord(shownOfficers.length)}, ${payload.days.length} days`);
  };

  const exportUnit = () => {
    downloadCsv(exportFileName(payload, false), toCsv(rosterRows(payload, payload.officers)));
    setExportStatus(`CSV saved: all ${payload.officers.length} officers, ${payload.days.length} days`);
  };

  const copyView = () => {
    const text = toTsv(rosterRows(payload, shownOfficers, filtered));
    void copyText(text).then((copied) =>
      setExportStatus(
        copied
          ? `Copied ${officersWord(shownOfficers.length)} × ${payload.days.length} days; paste into a spreadsheet`
          : 'Could not copy here; use the CSV instead',
      ),
    );
  };

  /** Write the focus week (a Monday), the unit, the view and the density into the address. */
  const writeParams = (
    weekFrom: string | undefined,
    unit: string | undefined,
    next: { view?: BoardView; density?: RosterDensity } = {},
  ) => {
    setExportStatus('');
    const params = new URLSearchParams(searchParams);
    // Another unit has its own officers: a qualification picked here may
    // match no one there, so it is reset (the other filters still read).
    if (unit !== activeUnitId) params.delete('qual');
    if (weekFrom) params.set('week', weekFrom);
    else params.delete('week');
    if (unit) params.set('unit', unit);
    else params.delete('unit');
    const nextView = next.view ?? view;
    if (nextView === 'week') params.delete('view');
    else params.set('view', nextView);
    if (next.density !== undefined) {
      // Only a choice that differs from the view's default is kept.
      if (next.density === parseDensity(null, nextView)) params.delete('density');
      else params.set('density', next.density);
    } else if (next.view !== undefined) {
      params.delete('density');
    }
    setSearchParams(params, { replace: true });
  };

  /** Drop anything that belonged to the old range. */
  const clearSelection = () => {
    setPending(null);
    setProposal(null);
    setShiftActions(null);
    setHelpOpen(false);
    setGap(null);
    mutation.reset();
  };

  /**
   * Move the board by whole weeks, pay periods or months (a step from the
   * range on screen; 0 is back to the demo day).
   */
  const changeWeek = (steps: number) => {
    const target =
      steps === 0 || focus === undefined ? demoMonday : stepFocus(view, focus, steps);
    writeParams(target, activeUnitId);
    clearSelection();
  };

  const changeView = (next: BoardView) => {
    if (next === view) return;
    writeParams(focus, activeUnitId, { view: next });
    clearSelection();
  };

  const changeDensity = (next: RosterDensity) => {
    writeParams(focus, activeUnitId, { density: next });
  };

  const changeUnit = (value: string) => {
    setUnitId(value);
    setGap(null);
    writeParams(focus, value);
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

  /** A2: a short coverage cell or a gap word opens the fill panel. */
  const openGap = (block: BlockCoverage) => {
    // The latest gap button is where Close and Escape return.
    gapTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mutation.state.kind !== 'idle' || pending || proposal) {
      setPending(null);
      setProposal(null);
      mutation.reset();
    }
    setGap({ date: block.date, block: block.block });
    setGapTemplate(BLOCK_TEMPLATES[block.block][0]);
  };

  /**
   * A2: "Check & assign" from the panel is the empty cell's flow with the
   * officer and template already chosen: the same preview, the same dock.
   */
  const checkFromGap = (officer: OfficerRow, template: string) => {
    if (!gap) return;
    lastFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setProposal(null);
    setPending({ officer, date: gap.date, template });
    void mutation.preview({
      type: 'ASSIGN',
      employeeId: officer.employeeId,
      unitId: payload.unit.id,
      shiftTemplate: template,
      startAt: `${gap.date}T${shiftTemplates[template].start}:00${REGINA_OFFSET}`,
    });
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
  const gapEntry = gap
    ? payload.coverage.find((block) => block.date === gap.date && block.block === gap.block)
    : undefined;
  // "Find eligible officer" takes the slot with it: the unit and the start
  // instant are what the overtime board can match against an open shift.
  const requestedStart = pending && template ? `${pending.date}T${template.start}:00${REGINA_OFFSET}` : proposal?.item.startAt;
  const findEligibleHref =
    requestedStart === undefined
      ? '/overtime'
      : `/overtime?unit=${encodeURIComponent(payload.unit.id)}&startAt=${encodeURIComponent(requestedStart)}`;
  const panelTitle = pending
    ? `Assign ${nameWithPosition(pending.officer, payload.unit)} → ${template?.label ?? pending.template}`
    : proposal
      ? `Assign ${nameWithPosition(proposal.officer, payload.unit)} → ${shiftTemplates[proposal.item.shiftTemplate]?.label ?? proposal.item.shiftTemplate}`
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
        data-print="hide"
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
            {onePeriod ? (
              <>
                <strong style={{ color: colour.text.primary }}>
                  {payload.publishedState.published ? 'Published' : 'Not published'}
                </strong>
                {changesPhrase ? ', ' + changesPhrase : ''}
              </>
            ) : (
              <span data-testid="publish-scope">
                {view === 'month' ? 'Spans several roster periods' : 'Spans two roster weeks'}: open the
                Week view to see and publish each one
              </span>
            )}
          </Typography>
          <Typography data-print="only" sx={{ display: 'none', fontSize: 12, color: colour.text.secondary }}>
            {filtered
              ? `Printed: ${shownOfficers.length} of ${payload.officers.length} officers (${filterWords(filters, qualificationLabel)})`
              : `Printed: all ${payload.officers.length} officers`}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2.5 }}>
          {/* Observation #3: the board was pinned to the week of the demo day.
              The api takes any range (up to 31 days), so the arrows walk whole
              weeks, pay periods or months from it (A1). */}
          <Box
            role="group"
            aria-label={GROUP_LABEL[view]}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
          >
            <Button variant="outlined" color="primary" data-print="hide" onClick={() => changeWeek(-1)}>
              Previous {STEP_NOUN[view]}
            </Button>
            <Box component="span" className="num" sx={{ fontSize: 13, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>
              {rangeWords(range.from, range.to)}
            </Box>
            <Button variant="outlined" color="primary" data-print="hide" onClick={() => changeWeek(1)}>
              Next {STEP_NOUN[view]}
            </Button>
            <Button
              variant="outlined"
              color="primary"
              disabled={showsToday}
              data-print="hide"
              onClick={() => changeWeek(0)}
            >
              Today
            </Button>
          </Box>
          <Button variant="outlined" color="primary" data-print="hide" onClick={() => setHelpOpen(true)}>
            Rules help
          </Button>
          {canPublish && payload.period ? (
            <Box data-print="hide">
              <PublishPeriodButton period={payload.period} onPublished={reload} />
            </Box>
          ) : null}
          <Box
            data-print="hide"
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
              onChange={(event) => changeUnit(event.target.value)}
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
              {unitPickerGroups.posts.length > 0 ? (
                // v1.3 S6: the supervisor posts are grouped after the line units.
                <>
                  <optgroup label="Units">
                    {unitPickerGroups.line.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Supervisor posts">
                    {unitPickerGroups.posts.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                (units.length > 0
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
                ))
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <GlobalStyles styles={boardPrintStyles} />

      <Box
        data-print="hide"
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}
      >
        <Segmented label="View" options={BOARD_VIEWS} value={view} onChange={changeView} />
        <Segmented label="Density" options={DENSITIES} value={density} onChange={changeDensity} />
      </Box>

      {/* A1: the compact board shows the same figures as a one-line strip of
          chips, so a pay period of officers fits above the fold. */}
      <Box
        data-print="hide"
        role={compactKpis ? 'list' : undefined}
        aria-label={compactKpis ? 'Board figures' : undefined}
        sx={
          compactKpis
            ? { display: 'flex', flexWrap: 'wrap', gap: 1.5 }
            : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 3 }
        }
      >
        {kpis.map((kpi) =>
          compactKpis ? (
            <Box key={kpi.label} role="listitem" sx={{ display: 'flex', minWidth: 0, maxWidth: '100%' }}>
              <KpiTile {...kpi} variant="chip" />
            </Box>
          ) : (
            <KpiTile key={kpi.label} {...kpi} />
          ),
        )}
      </Box>

      {/* Observation 29: the help is a real legend, read from the live rule
          tables, and never opens on top of the rule-check panel. */}
      <RulesHelpDialog
        open={helpOpen && !ruleCheckOpen}
        onClose={() => setHelpOpen(false)}
        roleId={role.id}
      />

      {readOnly ? (
        <Typography role="note" sx={{ fontSize: 13, color: colour.text.secondary }}>
          Read-only: the facility planner sees every unit's roster. Supervisors change their own.
        </Typography>
      ) : null}

      {payload.unit.closedFrom ? (
        <Typography
          role="note"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.info.bg,
            color: colour.status.info.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {payload.unit.name.split(' · ')[0]} is closed from {weekdayDateWords(payload.unit.closedFrom)}
          {payload.unit.closedReason ? ` ("${payload.unit.closedReason}")` : ''}
          {payload.unit.closedTo
            ? ` until it reopens on ${weekdayDateWords(addDays(payload.unit.closedTo, 1))}`
            : ''}
          . It has no roster and needs no staff from that date. Its officers work as relief in other
          units, shown under those units.
        </Typography>
      ) : null}

      {payload.officers.every((officer) => officer.cells.every((cell) => cell.items.length === 0)) ? (
        <Typography role="note" sx={{ fontSize: 13, color: colour.text.secondary }}>
          {view === 'week' ? 'No shifts on this week yet.' : `No shifts in this ${STEP_NOUN[view]} yet.`}
          {canPublish
            ? ` Assign a shift from an empty cell, or commit a quarter plan for this ${STEP_NOUN[view]}.`
            : ''}
        </Typography>
      ) : null}

      <RosterFilters
        filters={filters}
        onChange={changeFilters}
        qualificationCodes={qualificationCodes}
        rotationOptions={rotationChoices}
        printable={printable}
        shown={shownOfficers.length}
        total={payload.officers.length}
        onExportView={exportView}
        onExportUnit={exportUnit}
        onPrint={() => window.print()}
        onCopy={copyView}
        exportStatus={exportStatus}
      />

      {filtered && shownOfficers.length === 0 ? (
        <Typography role="note" sx={{ fontSize: 13, color: colour.text.secondary }}>
          No officer on this board matches these filters. Clear the filters to see everyone.
        </Typography>
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
          density={density}
          officers={shownOfficers}
          filtered={filtered}
          {...(readOnly
            ? {}
            : { onEmptyCell: startChoose, onPickChip: pickChip, onFillGap: openGap, selectedGap: gap })}
        />
      </Box>

      {ruleCheckOpen ? <Box aria-hidden="true" sx={{ height: '52vh', flexShrink: 0 }} /> : null}

      {ruleCheckOpen ? (
        <Box
          role="region"
          aria-label="Rule check"
          data-print="hide"
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
            findEligibleLabel={onPost ? 'Find eligible supervisor' : undefined}
            onSave={() => {
              // A saved change moves the board: read it again (D9).
              if (mutation.state.change) {
                void mutation.save(mutation.state.change).then((saved) => {
                  if (saved) reloadAll();
                });
              }
            }}
            onAcknowledge={(codes) => {
              if (mutation.state.change) {
                void mutation.save(mutation.state.change, { acknowledgeWarnings: codes }).then((saved) => {
                  if (saved) reloadAll();
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
          {pending ? `Assign a shift to ${nameWithPosition(pending.officer, payload.unit)}` : 'Assign a shift'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
            {pending
              ? `${payload.unit.name} · ${longDay(pending.date)}. The rules are checked before the shift is saved.`
              : ''}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {assignableTemplates.map((option) => (
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

      {gapEntry ? (
        <GapFillPanel
          payload={payload}
          gap={gapEntry}
          template={gapTemplate}
          onTemplate={setGapTemplate}
          onCheck={checkFromGap}
          onClose={closeGap}
          findEligibleHref={`/overtime?unit=${encodeURIComponent(payload.unit.id)}&startAt=${encodeURIComponent(
            `${gapEntry.date}T${shiftTemplates[gapTemplate].start}:00${REGINA_OFFSET}`,
          )}`}
          hidden={!gapPanelShown}
          {...(gapPeriod
            ? {
                period: {
                  label: rangeWords(gapPeriod.from, gapPeriod.to),
                  state: gapPeriodSchedule.state.kind,
                  ...(gapPeriodSchedule.state.kind === 'ready'
                    ? {
                        hours: new Map(
                          gapPeriodSchedule.state.payload.officers.map((officer) => [
                            officer.employeeId,
                            officer,
                          ]),
                        ),
                      }
                    : {}),
                },
              }
            : {})}
        />
      ) : null}

      {shiftActions ? (
        <ShiftActionsDialog
          officer={shiftActions.officer}
          item={shiftActions.item}
          unitId={payload.unit.id}
          {...(payload.unit.kind ? { unitKind: payload.unit.kind } : {})}
          now={boardNow(payload)}
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
                if (saved) reloadAll();
              });
          }
        }}
      />
    </>
  );
}
