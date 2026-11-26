import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Fragment } from 'react';
import type { ReactNode } from 'react';

import { AbsenceChip, OffChip, ShiftChip } from '../components/ShiftChip';
import { ScrollShadows } from '../components/ScrollShadows';
import { StatusPill } from '../components/StatusPill';
import { qualificationLabel, qualificationShortLabel } from '../api/qualifications';
import type { Block, BlockCoverage, CellItem, OfficerRow, SchedulePayload, ShiftItem } from '../api/types';
import { colour, grid } from '../theme/tokens';
import { CoverageCell } from './CoverageCell';
import { dayTotals, isWeekend, officerTotals, payPeriodOf, rangeWords } from './rosterView';
import { isActingOfficer, isSupervisor, isSupervisorPost, onDuty, shortName } from './supervisorPosts';
import type { RosterDensity } from './rosterView';

/** A chip and its words stay together when the key wraps. */
function LegendItem({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

const VISUALLY_HIDDEN_TEXT = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

const BLOCKS: { block: Block; label: string }[] = [
  { block: 'DAY', label: 'Days' },
  { block: 'EVENING', label: 'Evenings' },
  { block: 'NIGHT', label: 'Nights' },
];

function dayLabel(date: string, today: string): { dow: string; day: string; tag: string } {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const day = new Intl.DateTimeFormat('en-CA', { day: '2-digit', timeZone: 'UTC' }).format(parsed);
  const tag = date < today ? 'Actual' : date === today ? 'Today' : 'Planned';
  return { dow, day, tag };
}

function monthShort(date: string): string {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function overtimeTone(status: OfficerRow['overtimeStatus']) {
  if (status === 'IN_OVERTIME') return 'ot' as const;
  if (status === 'APPROACHING') return 'warn' as const;
  return 'under' as const;
}

function overtimeText(status: OfficerRow['overtimeStatus']): string {
  if (status === 'IN_OVERTIME') return 'In overtime';
  if (status === 'APPROACHING') return 'Approaching';
  return 'Under';
}

/**
 * The roster grid's props. PR-B (filters, sort, export) builds on `officers`
 * and the totals helpers in `rosterView.ts`; everything else is optional and
 * defaults to the original week board.
 */
export interface RosterGridProps {
  /** The schedule for the days on screen (a week, a pay period or a month, up to 31 days). */
  payload: SchedulePayload;
  /** The demo "today". */
  today: string;
  /** Called when an empty cell is picked. */
  onEmptyCell?: (officer: OfficerRow, date: string) => void;
  /** Called when a shift chip is picked. */
  onPickChip?: (officer: OfficerRow, item: ShiftItem) => void;
  /**
   * 'comfortable' (default) is the original board. 'compact' fits a pay period
   * of officers on a laptop: smaller chips, coverage as heat cells, one-line
   * officer cells and short qualification badges.
   */
  density?: RosterDensity;
  /**
   * The officer rows to show, in order (a filtered or sorted subset of
   * `payload.officers`). Defaults to every officer in the payload's order. The
   * day-totals footer sums the rows shown.
   */
  officers?: OfficerRow[];
  /** A2: a short coverage cell (today or later) is picked; opens the gap-fill panel. */
  onFillGap?: (block: BlockCoverage) => void;
  /** A2: the gap the fill panel shows, outlined in the grid. */
  selectedGap?: { date: string; block: Block } | null;
  /**
   * True when `officers` is a filtered subset (A3): the footer then says it
   * sums the officers shown, and the coverage rows say they are the whole unit.
   */
  filtered?: boolean;
  /** A rule warning for a chip, shown as a ⚠ beside it (planner draft, A8; PR-C). */
  chipWarning?: (officer: OfficerRow, item: ShiftItem, date: string) => string | null;
  /**
   * The signed-in supervisor's own officer record (v1.3 S4). The api refuses
   * any change to it, so that row offers none: its days are not buttons, its
   * chips cannot be picked, and the row says why (as the gap panel's "This is
   * you" does).
   */
  selfEmployeeId?: string;
}

/** Why a supervisor's own row offers no changes; the api's 403 says the same. */
export const SELF_ROW_REASON = "This is you: you can't change your own schedule; ask another supervisor.";

function CellChips({
  items,
  officerName,
  date,
  onPick,
  compact = false,
  warningFor,
}: {
  items: CellItem[];
  officerName: string;
  date: string;
  onPick?: (item: ShiftItem) => void;
  compact?: boolean;
  warningFor?: (item: ShiftItem) => string | null;
}) {
  if (items.length === 0) {
    return <OffChip />;
  }
  return (
    <>
      {items.map((item) =>
        item.type === 'ABSENCE' ? (
          <AbsenceChip key={`absence-${item.absenceType}`} absenceType={item.absenceType} />
        ) : (
          <Fragment key={item.assignmentId}>
            <ShiftChip
              template={item.shiftTemplate}
              extra={item.kind === 'EXTRA'}
              worked={item.worked}
              offer={item.offer ?? false}
              proposed={item.proposed ?? false}
              edited={item.edited ?? false}
              fromProposal={item.fromProposal ?? false}
              compact={compact}
              onClick={onPick ? () => onPick(item) : undefined}
              context={`for ${officerName} on ${date}`}
            />
            <ChipWarning message={warningFor?.(item) ?? null} compact={compact} />
          </Fragment>
        ),
      )}
    </>
  );
}

/**
 * A rule warning beside a chip: a ⚠ named by its message. It takes focus, and
 * its tooltip opens on focus as well as hover, so a keyboard user can read it.
 */
function ChipWarning({ message, compact = false }: { message: string | null; compact?: boolean }) {
  if (!message) return null;
  return (
    <Tooltip title={message} describeChild>
      <Box
        component="span"
        role="img"
        tabIndex={0}
        aria-label={`Rule warning: ${message}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: compact ? 24 : 30,
          px: 0.5,
          fontSize: 14,
          lineHeight: 1,
          color: colour.status.warn.text,
          cursor: 'help',
          borderRadius: '4px',
          '&:focus-visible': { outline: `2px solid ${colour.brand.link}`, outlineOffset: 1 },
        }}
      >
        ⚠
      </Box>
    </Tooltip>
  );
}

/** "10 · 100 h": shifts and hours, with up to two decimals only when needed. */
function hoursWords(hours: number): string {
  // Up to two decimals, so a quarter hour reads 7.25 h, not 7.3 h.
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))} h`;
}

/** The officer's qualifications as badges (A5), from `OfficerRow.qualifications`. */
function QualificationBadges({ codes, compact }: { codes: string[]; compact: boolean }) {
  if (codes.length === 0) return null;
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5 }}
      aria-label={`Qualified: ${codes.map(qualificationLabel).join(', ')}`}
      role="img"
    >
      {codes.map((code) => (
        <Box
          key={code}
          component="span"
          title={qualificationLabel(code)}
          aria-hidden="true"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            height: compact ? 16 : 18,
            px: compact ? 0.75 : 1,
            border: `1px solid ${colour.border.input}`,
            borderRadius: '4px',
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            color: colour.text.secondary,
            backgroundColor: colour.bg.surface,
            whiteSpace: 'nowrap',
          }}
        >
          {compact ? qualificationShortLabel(code) : qualificationLabel(code)}
        </Box>
      ))}
    </Box>
  );
}

/**
 * The roster grid (docs/ui/README.md §5.1): coverage per block above the
 * officer rows, one column per day on screen, a day-totals footer, and the
 * shift key below. A1 additions: the density, the per-officer "shifts · h in
 * this view" column, week separators, weekend shading and qualification
 * badges. The planner's draft roster uses the same grid.
 */
export function RosterGrid({
  payload,
  today,
  onEmptyCell,
  onPickChip,
  density = 'comfortable',
  officers: shownOfficers,
  onFillGap,
  selectedGap = null,
  filtered = false,
  chipWarning,
  selfEmployeeId,
}: RosterGridProps) {
  const officers = shownOfficers ?? payload.officers;
  const onPost = isSupervisorPost(payload.unit);
  const threshold = payload.officers[0]?.payPeriodThreshold ?? 80;
  const compact = density === 'compact';
  const days = payload.days;
  // The API reports the pay period that holds the first day. When the span
  // runs past it (a month), the header names that period.
  const firstPeriod = days.length > 0 ? payPeriodOf(days[0]) : null;
  const spansPeriods = firstPeriod !== null && days[days.length - 1] > firstPeriod.to;

  const cellPad = compact ? '2px 3px' : '8px';
  const border = `1px solid ${colour.border.default}`;
  const nameWidth = compact ? 150 : 165;

  /** Today's tint, else the weekend shade; and the heavier line before a Monday. */
  const dayStyle = (date: string, index: number) => ({
    backgroundColor: date === today ? grid.today : isWeekend(date) ? grid.weekend : undefined,
    borderLeft:
      index > 0 && new Date(`${date}T00:00:00Z`).getUTCDay() === 1
        ? `2px solid ${grid.weekSeparator}`
        : undefined,
  });

  const stickyName = {
    width: nameWidth,
    minWidth: nameWidth,
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
    boxShadow: 'inset -1px 0 0 #E1E3E6',
  };
  const headStyle = {
    padding: compact ? '4px 3px' : 8,
    fontSize: compact ? 11 : 12,
    fontWeight: 600,
    color: colour.text.secondary,
    backgroundColor: colour.bg.subtle,
  };

  return (
    <Box sx={{ backgroundColor: colour.bg.surface, border: `1px solid ${colour.border.default}`, borderRadius: '10px' }}>
      <ScrollShadows
        label="Roster, scrolls sideways"
        hint={
          days.length <= 7
            ? 'Scroll sideways to see the rest of the week.'
            : 'Scroll sideways to see the rest of the days.'
        }
      >
        <table
          data-density={density}
          style={{
            width: '100%',
            minWidth: compact ? nameWidth + 150 + days.length * 40 : 860,
            borderCollapse: 'collapse',
            fontSize: compact ? 12 : 13,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...headStyle, ...stickyName, textAlign: 'left', padding: 6, zIndex: 2 }}>
                {onPost ? 'Supervisor' : 'Officer'}
              </th>
              <th style={{ ...headStyle, textAlign: 'left', whiteSpace: 'nowrap' }}>
                Shifts · h
                <br />
                <span style={{ fontWeight: 500 }}>this view</span>
              </th>
              <th style={{ ...headStyle, textAlign: 'left', whiteSpace: 'nowrap' }}>
                Pay period
                <br />
                <span style={{ fontWeight: 500 }}>
                  {spansPeriods && firstPeriod
                    ? `${rangeWords(firstPeriod.from, firstPeriod.to)} · of ${threshold} h`
                    : `of ${threshold} h`}
                </span>
              </th>
              {days.map((date, index) => {
                const label = dayLabel(date, today);
                return (
                  <th
                    key={date}
                    style={{
                      ...headStyle,
                      textAlign: compact ? 'center' : 'left',
                      ...dayStyle(date, index),
                      backgroundColor: date === today ? grid.today : isWeekend(date) ? grid.weekend : colour.bg.subtle,
                      // A2: the selected gap's day is marked in the header.
                      ...(selectedGap?.date === date
                        ? { boxShadow: `inset 0 -3px 0 ${colour.brand.primary}` }
                        : {}),
                    }}
                  >
                    {compact ? (
                      <>
                        <span style={{ display: 'block', color: colour.text.primary }}>{label.dow}</span>
                        <span>
                          {Number(label.day)}
                          {index === 0 || label.day === '01' ? ` ${monthShort(date)}` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ display: 'block', color: colour.text.primary }}>
                          {label.dow} {label.day}
                          {days.length > 7 && (index === 0 || label.day === '01') ? ` ${monthShort(date)}` : ''}
                        </span>
                        <span style={{ fontWeight: 500 }}>{label.tag}</span>
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {BLOCKS.map(({ block, label }) => {
              const requirement = payload.coverage.find(
                (entry) => entry.block === block && entry.date === payload.days[0],
              )?.required;
              return (
                <tr key={block}>
                  <td
                    style={{
                      ...stickyName,
                      fontWeight: 600,
                      padding: compact ? '3px 6px' : 8,
                      backgroundColor: colour.bg.subtle,
                      borderBottom: border,
                    }}
                  >
                    {label}
                    {compact ? ' ' : <br />}
                    <span style={{ fontWeight: 500, fontSize: compact ? 11 : 12, color: colour.text.secondary }}>
                      needs {requirement}
                      {onPost ? (requirement === 1 ? ' supervisor' : ' supervisors') : ''}
                      {filtered ? (onPost ? ' · whole post' : ' · whole unit') : ''}
                    </span>
                  </td>
                  <td colSpan={2} style={{ backgroundColor: colour.bg.subtle, borderBottom: border }} />
                  {days.map((date, index) => {
                    const entry = payload.coverage.find(
                      (item) => item.block === block && item.date === date,
                    );
                    return (
                      <td
                        key={date}
                        style={{
                          padding: cellPad,
                          borderBottom: border,
                          textAlign: compact ? 'center' : undefined,
                          ...dayStyle(date, index),
                        }}
                      >
                        {entry ? (
                          <CoverageCell
                            block={entry}
                            today={today}
                            compact={compact}
                            onFill={onFillGap}
                            selected={selectedGap?.date === date && selectedGap.block === block}
                            {...(onPost ? { noun: 'Supervisor' } : {})}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {payload.supervisorsOnDuty ? (
              // v1.3 S6: who supervises this unit in each block, from the
              // supervisor post that covers it. Read-only; names are fine on
              // the signed-in board (never on the wall display).
              <tr data-testid="supervisor-on-duty">
                <td
                  data-testid="supervisor-on-duty-label"
                  style={{
                    ...stickyName,
                    fontWeight: 600,
                    padding: compact ? '3px 6px' : 8,
                    backgroundColor: colour.bg.subtle,
                    borderBottom: border,
                  }}
                >
                  Supervisor on duty
                  {compact ? ' ' : <br />}
                  <span style={{ fontWeight: 500, fontSize: compact ? 11 : 12, color: colour.text.secondary }}>
                    from the supervisor post
                  </span>
                </td>
                <td colSpan={2} style={{ backgroundColor: colour.bg.subtle, borderBottom: border }} />
                {days.map((date, index) => {
                  const blocks = BLOCKS.map(({ block, label }) => ({
                    block,
                    label,
                    names: onDuty(payload, date, block) ?? [],
                  }));
                  const words = blocks
                    .map(({ label, names }) => `${label}: ${names.length > 0 ? names.join(', ') : 'none'}`)
                    .join(' · ');
                  const allCovered = blocks.every(({ names }) => names.length > 0);
                  return (
                    <td
                      key={date}
                      style={{
                        padding: cellPad,
                        borderBottom: border,
                        textAlign: compact ? 'center' : undefined,
                        ...dayStyle(date, index),
                      }}
                    >
                      {compact ? (
                        <Box
                          component="span"
                          role="img"
                          title={words}
                          aria-label={`Supervisor on duty. ${words}`}
                          sx={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: allCovered ? colour.text.secondary : colour.status.warn.text,
                          }}
                        >
                          {allCovered ? '✓' : '!'}
                        </Box>
                      ) : (
                        <Box
                          component="ul"
                          aria-label={`Supervisor on duty, ${date}`}
                          sx={{ listStyle: 'none', m: 0, p: 0, fontSize: 11, lineHeight: 1.45 }}
                        >
                          {blocks.map(({ block, label, names }) => (
                            <Box
                              component="li"
                              key={block}
                              title={`${label}: ${names.length > 0 ? names.join(', ') : 'none'}`}
                              sx={{
                                // Anchors the hidden label inside the scroll box.
                                position: 'relative',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 120,
                                color: names.length > 0 ? colour.text.primary : colour.status.warn.text,
                              }}
                            >
                              <Box component="span" aria-hidden="true" sx={{ fontWeight: 700, color: colour.text.secondary }}>
                                {label.charAt(0)}{' '}
                              </Box>
                              <Box component="span" sx={VISUALLY_HIDDEN_TEXT}>
                                {label}:{' '}
                              </Box>
                              {names.length > 0 ? names.map(shortName).join(', ') : 'none'}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </td>
                  );
                })}
              </tr>
            ) : null}

            {officers.map((officer) => {
              const totals = officerTotals(officer);
              // v1.3 S6: a supervisor on an officer post (R-02 cross-cover)
              // reads "Sup"; an officer on a supervisor post reads "Acting"
              // (holds Acting supervisor) or "Officer".
              const positionBadge = onPost
                ? isSupervisor(officer) || officer.position === undefined
                  ? null
                  : isActingOfficer(officer)
                    ? { text: 'Acting', title: 'Officer acting as supervisor (R-01 warning)' }
                    : { text: 'Officer', title: 'Officer on a supervisor post (R-01)' }
                : isSupervisor(officer)
                  ? { text: 'Sup', title: 'Supervisor working an officer post (R-02)' }
                  : null;
              const self = Boolean(selfEmployeeId) && officer.employeeId === selfEmployeeId;
              return (
                <tr key={officer.employeeId} data-officer-name={officer.name} data-self={self ? 'true' : undefined}>
                  <td
                    style={{
                      ...stickyName,
                      padding: compact ? '2px 6px' : 8,
                      borderBottom: border,
                      backgroundColor: colour.bg.surface,
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: compact ? 'row' : 'column',
                        flexWrap: 'wrap',
                        alignItems: compact ? 'center' : 'flex-start',
                        columnGap: 1,
                        rowGap: 0.5,
                      }}
                    >
                      <Box component="span" sx={{ fontWeight: 600, whiteSpace: compact ? 'nowrap' : undefined }}>
                        {officer.name}
                      </Box>
                      {positionBadge ? (
                        <Box
                          component="span"
                          data-testid="position-badge"
                          title={positionBadge.title}
                          sx={{
                            position: 'relative',
                            fontSize: compact ? 11 : 12,
                            fontWeight: 700,
                            px: 0.75,
                            borderRadius: '4px',
                            backgroundColor: colour.status.warn.bg,
                            color: colour.status.warn.text,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {positionBadge.text}
                          <Box component="span" sx={VISUALLY_HIDDEN_TEXT}>
                            {`: ${positionBadge.title}`}
                          </Box>
                        </Box>
                      ) : null}
                      {officer.homeUnit ? (
                        <Box
                          component="span"
                          data-testid="from-unit"
                          sx={{
                            fontSize: compact ? 11 : 12,
                            fontWeight: 600,
                            px: 0.75,
                            borderRadius: '4px',
                            backgroundColor: colour.status.info.bg,
                            color: colour.status.info.text,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          From {officer.homeUnit.split(' · ')[0]}
                        </Box>
                      ) : null}
                      {officer.rotation ? (
                        <Box
                          component="span"
                          sx={{
                            fontSize: compact ? 11 : 12,
                            color: colour.text.secondary,
                            ...(compact
                              ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }
                              : {}),
                          }}
                          title={compact ? officer.rotation : undefined}
                        >
                          {officer.rotation}
                        </Box>
                      ) : null}
                      <QualificationBadges codes={officer.qualifications ?? []} compact={compact} />
                      {self && onEmptyCell ? (
                        <Box
                          component="span"
                          data-testid="self-row-reason"
                          sx={{ flexBasis: '100%', fontSize: compact ? 11 : 12, color: colour.text.secondary }}
                        >
                          {SELF_ROW_REASON}
                        </Box>
                      ) : null}
                    </Box>
                  </td>
                  <td
                    className="num"
                    style={{ padding: compact ? '2px 6px' : 8, borderBottom: border, whiteSpace: 'nowrap', fontWeight: 600 }}
                    aria-label={`${totals.shifts} ${totals.shifts === 1 ? 'shift' : 'shifts'}, ${hoursWords(totals.hours)} in this view`}
                  >
                    {totals.shifts} · {hoursWords(totals.hours)}
                  </td>
                  <td style={{ padding: compact ? '2px 6px' : 8, borderBottom: border }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: compact ? 'row' : 'column',
                        gap: 1,
                        alignItems: compact ? 'center' : 'flex-start',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Box className="num" sx={{ fontWeight: 600 }}>
                        {officer.payPeriodHours} h
                      </Box>
                      <StatusPill tone={overtimeTone(officer.overtimeStatus)} small={compact}>
                        {overtimeText(officer.overtimeStatus)}
                      </StatusPill>
                    </Box>
                  </td>
                  {days.map((date, index) => {
                    const cell = officer.cells.find((entry) => entry.date === date);
                    const items = cell?.items ?? [];
                    // A shift cannot be added to a day that has happened.
                    const canAssign = date >= today && onEmptyCell !== undefined && !self;
                    return (
                      <td
                        key={date}
                        data-officer-id={officer.employeeId}
                        data-date={date}
                        style={{
                          padding: cellPad,
                          borderBottom: border,
                          textAlign: compact ? 'center' : undefined,
                          ...dayStyle(date, index),
                          // A2: who is free on the selected gap's day stands out.
                          ...(selectedGap?.date === date && items.length === 0
                            ? { backgroundColor: grid.free }
                            : {}),
                        }}
                      >
                        {items.length === 0 ? (
                          // One Off style (A4): muted "Off" (a dot when compact)
                          // on every empty day, past or future. A day that has
                          // not happened yet is a button and shows its outline
                          // on hover and focus.
                          <Box
                            component="button"
                            type="button"
                            disabled={!canAssign}
                            onClick={() => onEmptyCell?.(officer, date)}
                            aria-label={`Off - assign a shift to ${officer.name} on ${date}`}
                            title={
                              canAssign
                                ? 'Assign a shift'
                                : self && onEmptyCell && date >= today
                                  ? SELF_ROW_REASON
                                  : onEmptyCell
                                  ? 'This day has already happened'
                                  : 'Off'
                            }
                            sx={{
                              // At least 24 × 24 px, the WCAG 2.2 target size.
                              minHeight: compact ? 24 : 30,
                              minWidth: compact ? 28 : undefined,
                              px: compact ? 0.5 : 2,
                              border: '1px solid transparent',
                              borderRadius: '6px',
                              backgroundColor: 'transparent',
                              color: colour.text.muted,
                              fontFamily: 'inherit',
                              fontSize: 12,
                              cursor: canAssign ? 'pointer' : 'default',
                              '&:hover, &:focus-visible': canAssign
                                ? {
                                    backgroundColor: colour.bg.linkHover,
                                    borderColor: colour.brand.link,
                                    borderStyle: 'dashed',
                                    color: colour.text.secondary,
                                  }
                                : {},
                            }}
                          >
                            {compact ? '·' : 'Off'}
                          </Box>
                        ) : (
                          <Box
                            sx={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 0.5,
                              justifyContent: compact ? 'center' : undefined,
                              // A one-letter compact chip stays a readable block.
                              ...(compact ? { '& > :not([role="img"])': { minWidth: 28 } } : {}),
                            }}
                          >
                            <CellChips
                              items={items}
                              officerName={officer.name}
                              date={date}
                              compact={compact}
                              onPick={onPickChip && !self ? (item) => onPickChip(officer, item) : undefined}
                              warningFor={chipWarning ? (item) => chipWarning(officer, item, date) : undefined}
                            />
                          </Box>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <th
                scope="row"
                style={{
                  ...headStyle,
                  ...stickyName,
                  textAlign: 'left',
                  padding: compact ? '3px 6px' : 8,
                  color: colour.text.primary,
                  borderTop: `2px solid ${colour.border.default}`,
                }}
              >
                On duty · hours
                {filtered ? (
                  <span style={{ display: 'block', fontWeight: 500, color: colour.text.secondary }}>
                    officers shown
                  </span>
                ) : null}
              </th>
              <td
                colSpan={2}
                style={{ ...headStyle, borderTop: `2px solid ${colour.border.default}` }}
              />
              {days.map((date, index) => {
                const totals = dayTotals(officers, date);
                return (
                  <td
                    key={date}
                    className="num"
                    aria-label={`${totals.onDuty} on duty, ${hoursWords(totals.hours)}`}
                    style={{
                      ...headStyle,
                      textAlign: compact ? 'center' : 'left',
                      borderTop: `2px solid ${colour.border.default}`,
                      ...dayStyle(date, index),
                      backgroundColor: date === today ? grid.today : isWeekend(date) ? grid.weekend : colour.bg.subtle,
                    }}
                  >
                    <span style={{ display: 'block', color: colour.text.primary, fontWeight: 700 }}>
                      {totals.onDuty}
                    </span>
                    <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{hoursWords(totals.hours)}</span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </ScrollShadows>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px 16px',
          p: '12px 16px',
          borderTop: `1px solid ${colour.border.default}`,
          fontSize: 12,
          color: colour.text.secondary,
        }}
      >
        <Box component="span" sx={{ fontWeight: 600, color: colour.text.primary }}>
          Key
        </Box>
        <LegendItem>
          <ShiftChip template="D8" /> <span>Day 07:00 – 15:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="E8" /> <span>Evening 15:00 – 23:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="N8" /> <span>Night 23:00 – 07:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="A12" /> <span>12 h 00:00 – 12:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="P12" /> <span>12 h 12:00 – 24:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="L16" /> <span>16 h 20:00 – 12:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="D12" /> <span>Day 12 h 07:00 – 19:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="N12" /> <span>Night 12 h 19:00 – 07:00</span>
        </LegendItem>
        <LegendItem>
          <ShiftChip template="E8" extra /> <span>extra shift beyond the roster</span>
        </LegendItem>
        <LegendItem>
          <AbsenceChip absenceType="SICK" /> <span>Sick</span>
        </LegendItem>
        <LegendItem>
          <AbsenceChip absenceType="VACATION" /> <span>Vacation</span>
        </LegendItem>
        <span>{compact ? '· = off' : 'Off = no shift'}</span>
        {compact ? <span>Ctl = Control · Esc = Escort · FA = First aid</span> : null}
        <span>✓ = worked (actual recorded)</span>
        <span>Coverage: blue met · yellow 1 short · orange 2+ under · grey over</span>
        <span>Overtime = pay-period hours over {threshold} h (status pill)</span>
      </Box>
    </Box>
  );
}
