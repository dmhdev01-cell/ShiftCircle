import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

import { AbsenceChip, OffChip, ShiftChip } from '../components/ShiftChip';
import { ScrollShadows } from '../components/ScrollShadows';
import { StatusPill } from '../components/StatusPill';
import type { Block, CellItem, OfficerRow, SchedulePayload, ShiftItem } from '../api/types';
import { colour } from '../theme/tokens';
import { CoverageCell } from './CoverageCell';

/** A chip and its words stay together when the key wraps. */
function LegendItem({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

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

interface RosterGridProps {
  payload: SchedulePayload;
  /** The demo "today". */
  today: string;
  /** Called when an empty cell is picked. */
  onEmptyCell?: (officer: OfficerRow, date: string) => void;
  /** Called when a shift chip is picked. */
  onPickChip?: (officer: OfficerRow, item: ShiftItem) => void;
}

function CellChips({
  items,
  officerName,
  date,
  onPick,
}: {
  items: CellItem[];
  officerName: string;
  date: string;
  onPick?: (item: ShiftItem) => void;
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
          <ShiftChip
            key={item.assignmentId}
            template={item.shiftTemplate}
            extra={item.kind === 'EXTRA'}
            worked={item.worked}
            offer={item.offer ?? false}
            proposed={item.proposed ?? false}
            onClick={onPick ? () => onPick(item) : undefined}
            context={`for ${officerName} on ${date}`}
          />
        ),
      )}
    </>
  );
}

/**
 * The roster grid (docs/ui/README.md §5.1): coverage per block above the
 * officer rows, seven day columns, and the shift key below.
 */
export function RosterGrid({ payload, today, onEmptyCell, onPickChip }: RosterGridProps) {
  const threshold = payload.officers[0]?.payPeriodThreshold ?? 80;

  return (
    <Box sx={{ backgroundColor: colour.bg.surface, border: `1px solid ${colour.border.default}`, borderRadius: '10px' }}>
      <ScrollShadows
        label="Roster, scrolls sideways"
        hint="Scroll sideways to see the rest of the week."
      >
        <table
          style={{
            width: '100%',
            minWidth: 860,
            borderCollapse: 'collapse',
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th style={{ width: 165, minWidth: 165, textAlign: 'left', padding: 6, fontSize: 12, fontWeight: 600, color: colour.text.secondary, backgroundColor: colour.bg.subtle, position: 'sticky', left: 0, zIndex: 2, boxShadow: 'inset -1px 0 0 #E1E3E6' }}>
                Officer
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: colour.text.secondary,
                  backgroundColor: colour.bg.subtle,
                  whiteSpace: 'nowrap',
                }}
              >
                Pay period
                <br />
                <span style={{ fontWeight: 500 }}>
                  of {threshold} h
                </span>
              </th>
              {payload.days.map((date) => {
                const label = dayLabel(date, today);
                const isToday = date === today;
                return (
                  <th
                    key={date}
                    style={{
                      textAlign: 'left',
                      padding: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: colour.text.secondary,
                      backgroundColor: isToday ? '#EAF3F9' : colour.bg.subtle,
                    }}
                  >
                    <span style={{ display: 'block', color: colour.text.primary }}>
                      {label.dow} {label.day}
                    </span>
                    <span style={{ fontWeight: 500 }}>{label.tag}</span>
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
                      width: 165,
                      minWidth: 165,
                      fontWeight: 600,
                      padding: 8,
                      backgroundColor: colour.bg.subtle,
                      borderBottom: `1px solid ${colour.border.default}`,
                      position: 'sticky',
                      left: 0,
                      zIndex: 1,
                      boxShadow: 'inset -1px 0 0 #E1E3E6',
                    }}
                  >
                    {label}
                    <br />
                    <span style={{ fontWeight: 500, fontSize: 12, color: colour.text.secondary }}>
                      needs {requirement}
                    </span>
                  </td>
                  <td
                    style={{
                      backgroundColor: colour.bg.subtle,
                      borderBottom: `1px solid ${colour.border.default}`,
                    }}
                  />
                  {payload.days.map((date) => {
                    const entry = payload.coverage.find(
                      (item) => item.block === block && item.date === date,
                    );
                    return (
                      <td
                        key={date}
                        style={{
                          padding: 8,
                          borderBottom: `1px solid ${colour.border.default}`,
                          backgroundColor: date === today ? '#EAF3F9' : undefined,
                        }}
                      >
                        {entry ? <CoverageCell block={entry} today={today} /> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {payload.officers.map((officer) => (
              <tr key={officer.employeeId}>
                <td
                  style={{
                    padding: 8,
                    borderBottom: `1px solid ${colour.border.default}`,
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    backgroundColor: colour.bg.surface,
                    boxShadow: 'inset -1px 0 0 #E1E3E6',
                  }}
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {officer.name}
                    </Box>
                    <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                      {officer.rotation}
                    </Box>
                  </Box>
                </td>
                <td style={{ padding: 8, borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                    <Box className="num" sx={{ fontWeight: 600 }}>
                      {officer.payPeriodHours} h
                    </Box>
                    <StatusPill tone={overtimeTone(officer.overtimeStatus)}>
                      {overtimeText(officer.overtimeStatus)}
                    </StatusPill>
                  </Box>
                </td>
                {payload.days.map((date) => {
                  const cell = officer.cells.find((entry) => entry.date === date);
                  const items = cell?.items ?? [];
                  const isToday = date === today;
                  // A shift cannot be added to a day that has happened.
                  const canAssign = date >= today && onEmptyCell !== undefined;
                  return (
                    <td
                      key={date}
                      data-officer-id={officer.employeeId}
                      data-date={date}
                      style={{
                        padding: 8,
                        borderBottom: `1px solid ${colour.border.default}`,
                        backgroundColor: isToday ? '#EAF3F9' : undefined,
                      }}
                    >
                      {items.length === 0 ? (
                        // A day with nothing on it reads 'Off', and only a day
                        // that has not happened yet can be assigned.
                        <Box
                          component="button"
                          type="button"
                          disabled={!canAssign}
                          onClick={() => onEmptyCell?.(officer, date)}
                          aria-label={`Off - assign a shift to ${officer.name} on ${date}`}
                          title={
                            canAssign
                              ? 'Assign a shift'
                              : 'This day has already happened'
                          }
                          sx={{
                            minHeight: 30,
                            px: 2,
                            border: `1px dashed ${
                              canAssign ? colour.border.input : 'transparent'
                            }`,
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
                                  color: colour.text.secondary,
                                }
                              : {},
                          }}
                        >
                          Off
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          <CellChips
                            items={items}
                            officerName={officer.name}
                            date={date}
                            onPick={onPickChip ? (item) => onPickChip(officer, item) : undefined}
                          />
                        </Box>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
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
          <ShiftChip template="E8" extra /> <span>extra shift beyond the roster</span>
        </LegendItem>
        <LegendItem>
          <AbsenceChip absenceType="SICK" /> <span>Sick</span>
        </LegendItem>
        <LegendItem>
          <AbsenceChip absenceType="VACATION" /> <span>Vacation</span>
        </LegendItem>
        <span>✓ = worked (actual recorded)</span>
        <span>Overtime = pay-period hours over {threshold} h (status pill)</span>
      </Box>
    </Box>
  );
}
