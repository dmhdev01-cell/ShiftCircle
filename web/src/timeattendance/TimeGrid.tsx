import Box from '@mui/material/Box';

import type { TimeEntry } from '../api/types';
import { chipTextFor } from '../api/shiftTemplates';
import { ScrollShadows } from '../components/ScrollShadows';
import { colour } from '../theme/tokens';

export interface OfficerTimeRow {
  employeeId: string;
  name: string;
  /** The hours worked in the pay period. */
  hours: number;
  threshold: number;
  status: 'UNDER' | 'APPROACHING' | 'IN_OVERTIME';
  cells: { date: string; entry?: TimeEntry }[];
}

function clock(instant: string): string {
  return instant.slice(11, 16);
}

function differenceHours(entry: TimeEntry): number {
  const scheduled =
    (new Date(entry.endAt).getTime() - new Date(entry.startAt).getTime()) / 3_600_000;
  const actual =
    (new Date(entry.actualEnd ?? entry.endAt).getTime() -
      new Date(entry.actualStart ?? entry.startAt).getTime()) /
    3_600_000;
  return Math.round((actual - scheduled) * 2) / 2;
}

interface TimeCellProps {
  entry?: TimeEntry;
  /** The period is locked, so nothing can be recorded. */
  locked: boolean;
  onPick?: (entry: TimeEntry) => void;
}

/**
 * One cell of the time grid (docs/ui/build-notes.md §2.2). The state is always
 * in words - "needs actual", the actual times, the absence - never colour
 * alone.
 */
export function TimeCell({ entry, locked, onPick }: TimeCellProps) {
  if (!entry) {
    return <Box component="span" sx={{ fontSize: 12, color: colour.text.muted }}>—</Box>;
  }

  const chip = chipTextFor(entry.shiftTemplate);

  if (entry.needsActual) {
    return (
      <Box
        component="button"
        type="button"
        disabled={locked}
        aria-label={`${chip} · needs actual`}
        title={`${chip} ${clock(entry.startAt)}–${clock(entry.endAt)} · needs actual`}
        onClick={() => onPick?.(entry)}
        sx={{
          display: 'inline-flex',
          flexDirection: 'column',
          gap: 0.25,
          alignItems: 'flex-start',
          padding: 0,
          border: 0,
          background: 'transparent',
          fontFamily: 'inherit',
          cursor: locked ? 'default' : 'pointer',
          textAlign: 'left',
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 24,
            px: 1,
            borderRadius: '6px',
            backgroundColor: colour.status.warn.bg,
            color: colour.status.warn.text,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {chip}
        </Box>
        <Box component="span" sx={{ fontSize: 10, color: colour.status.warn.text, lineHeight: 1.2 }}>
          no actual
        </Box>
      </Box>
    );
  }

  if (entry.absence) {
    const label =
      entry.absence === 'VACATION' ? 'Vac' : entry.absence === 'OTHER' ? 'Other' : 'Sick';
    // An absence used to be a plain span, so a Sick or Vac record could not be
    // reopened or corrected (observation #11). It is a button like the others;
    // the drawer opens on the current choice.
    return (
      <Box
        component="button"
        type="button"
        disabled={locked}
        aria-label={`${label} · ${entry.employeeName} on ${entry.date} · change`}
        title={`${label} · ${chip} ${clock(entry.startAt)}–${clock(entry.endAt)} · click to change`}
        onClick={() => onPick?.(entry)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 24,
          px: 1,
          padding: '0 8px',
          borderRadius: '6px',
          backgroundColor: entry.absence === 'VACATION' ? '#E3F0E8' : '#FFFFFF',
          color: entry.absence === 'VACATION' ? colour.brand.primary : '#9A3412',
          border: entry.absence === 'VACATION' ? 'none' : '1px dashed #C2410C',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          cursor: locked ? 'default' : 'pointer',
        }}
      >
        {label}
      </Box>
    );
  }

  if (!entry.worked) {
    // A shift that has not happened yet: read-only.
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 24,
          px: 1,
          borderRadius: '6px',
          backgroundColor: '#D5E8F3',
          color: colour.brand.link,
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {chip}
      </Box>
    );
  }

  const difference = differenceHours(entry);
  const adjusted = entry.actualStart !== entry.startAt || entry.actualEnd !== entry.endAt;

  return (
    <Box
      component="button"
      type="button"
      disabled={locked}
      onClick={() => onPick?.(entry)}
      title={
        adjusted
          ? `Worked ${clock(entry.actualStart ?? entry.startAt)}–${clock(entry.actualEnd ?? entry.endAt)} (${difference > 0 ? '+' : ''}${difference} h)`
          : `Worked as scheduled (${clock(entry.startAt)}–${clock(entry.endAt)})`
      }
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 0.5,
        alignItems: 'flex-start',
        padding: 0,
        border: 0,
        background: 'transparent',
        fontFamily: 'inherit',
        cursor: locked ? 'default' : 'pointer',
        textAlign: 'left',
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 24,
          px: 1,
          borderRadius: '6px',
          backgroundColor: '#00558C',
          color: colour.text.onDark,
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        ✓ {chip}
      </Box>
      {difference !== 0 ? (
        <Box component="span" sx={{ fontSize: 11, color: colour.text.secondary }}>
          {difference > 0 ? '+' : ''}
          {difference} h
        </Box>
      ) : null}
    </Box>
  );
}

interface TimeGridProps {
  rows: OfficerTimeRow[];
  days: string[];
  locked: boolean;
  onPick: (entry: TimeEntry) => void;
}

/** The time grid (docs/ui/build-notes.md §2.2): 14 day columns per officer. */
export function TimeGrid({ rows, days, locked, onPick }: TimeGridProps) {
  return (
    <Box
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
      }}
    >
      <ScrollShadows
        label="Time entries, scrolls sideways"
        hint="Scroll sideways for more days."
      >
        <table
          style={{
            width: '100%',
            minWidth: 900,
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            fontSize: 13,
          }}
        >
          <colgroup>
            <col style={{ width: '17%' }} />
            <col style={{ width: '9%' }} />
            {days.map((date) => (
              <col key={date} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: colour.text.secondary,
                  backgroundColor: colour.bg.subtle,
                  position: 'sticky',
                  left: 0,
                  zIndex: 2,
                  boxShadow: 'inset -1px 0 0 #E1E3E6',
                }}
              >
                Officer
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: colour.text.secondary,
                  backgroundColor: colour.bg.subtle,
                  whiteSpace: 'nowrap',
                }}
              >
                Pay period
              </th>
              {days.map((date, index) => {
                const weekday = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][
                  new Date(`${date}T00:00:00Z`).getUTCDay()
                ];
                const weekend = weekday === 'Su' || weekday === 'Sa';
                const showMonth = index === 0 || date.endsWith('-01');
                const month = new Intl.DateTimeFormat('en-CA', {
                  month: 'short',
                  timeZone: 'UTC',
                }).format(new Date(`${date}T00:00:00Z`));
                return (
                  <th
                    key={date}
                    style={{
                      textAlign: 'left',
                      padding: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      color: colour.text.secondary,
                      backgroundColor: weekend ? '#F1F2F4' : colour.bg.subtle,
                    }}
                  >
                    {weekday} {date.slice(8, 10)}
                    {showMonth ? (
                      <>
                        <br />
                        <span style={{ fontWeight: 500 }}>{month}</span>
                      </>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeId}>
                <td
                  style={{
                    padding: 4,
                    borderBottom: `1px solid ${colour.border.default}`,
                    fontWeight: 600,
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    backgroundColor: colour.bg.surface,
                    boxShadow: 'inset -1px 0 0 #E1E3E6',
                  }}
                >
                  {row.name}
                </td>
                <td
                  style={{
                    padding: 4,
                    borderBottom: `1px solid ${colour.border.default}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Box className="num" sx={{ fontWeight: 600 }}>
                    {row.hours} h
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                    {row.status === 'IN_OVERTIME'
                      ? 'In overtime'
                      : row.status === 'APPROACHING'
                        ? 'Approaching'
                        : 'Under'}
                  </Box>
                </td>
                {days.map((date) => {
                  const cell = row.cells.find((entry) => entry.date === date);
                  const weekday = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][
                    new Date(`${date}T00:00:00Z`).getUTCDay()
                  ];
                  const weekend = weekday === 'Su' || weekday === 'Sa';
                  return (
                    <td
                      key={date}
                      data-assignment-id={cell?.entry?.assignmentId}
                      style={{
                        padding: 4,
                        borderBottom: `1px solid ${colour.border.default}`,
                        backgroundColor: weekend ? '#F7F8FA' : undefined,
                      }}
                    >
                      <TimeCell entry={cell?.entry} locked={locked} onPick={onPick} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollShadows>
    </Box>
  );
}
