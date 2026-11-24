import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { PlannerGap } from '../api/types';
import { colour } from '../theme/tokens';

interface GapStripProps {
  /** The Monday of each week in the quarter. */
  weeks: string[];
  units: { id: string; name: string }[];
  gaps: PlannerGap[];
  /** Opens the roster on that unit and week. */
  onPick: (unitId: string, week: string) => void;
}

/** "4 Jan", the way the rest of the planner writes a date. */
function weekLabel(monday: string): string {
  const date = new Date(`${monday}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(date);
  return `${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** The cell's colour says how many; the number is always written too. */
function tone(count: number) {
  if (count === 0) return { bg: colour.bg.subtle, text: colour.text.muted };
  if (count <= 2) return colour.status.warn;
  return colour.status.block;
}

/**
 * A7: the quarter at a glance, weeks across and units down, each cell the
 * unit's short block-days that week. A cell with gaps opens that week.
 */
export function GapStrip({ weeks, units, gaps, onPick }: GapStripProps) {
  // Every unit, plus any unit a gap names that the unit list lacks.
  const rows = [...units];
  for (const gap of gaps) {
    if (!rows.some((unit) => unit.id === gap.unitId)) rows.push({ id: gap.unitId, name: gap.unitName });
  }
  const count = (unitId: string, week: string) => {
    const end = addDays(week, 7);
    return gaps.filter((gap) => gap.unitId === unitId && gap.date >= week && gap.date < end).length;
  };

  return (
    <Box component="section" aria-labelledby="planner-gap-strip" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography id="planner-gap-strip" component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
        Gaps by week and unit
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <table aria-label="Gaps by week and unit" style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 12 }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left', padding: '2px 6px', color: colour.text.secondary, fontWeight: 600 }}>
                Unit
              </th>
              {weeks.map((week, index) => (
                <th
                  key={week}
                  scope="col"
                  title={`Week ${index + 1}, from ${weekLabel(week)}`}
                  style={{ padding: '2px 0', minWidth: 40, color: colour.text.secondary, fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  {weekLabel(week)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((unit) => (
              <tr key={unit.id}>
                <th scope="row" style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {unit.name}
                </th>
                {weeks.map((week) => {
                  const value = count(unit.id, week);
                  const style = tone(value);
                  const cell = {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    minWidth: 40,
                    minHeight: 32,
                    border: 0,
                    borderRadius: '4px',
                    backgroundColor: style.bg,
                    color: style.text,
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: value ? 700 : 400,
                  } as const;
                  return (
                    <td key={week} style={{ padding: 0 }}>
                      {value ? (
                        <Box
                          component="button"
                          type="button"
                          className="num"
                          aria-label={`${unit.name}, week of ${weekLabel(week)}: ${value} gap${value === 1 ? '' : 's'}. Show week`}
                          onClick={() => onPick(unit.id, week)}
                          sx={{ ...cell, cursor: 'pointer', '&:hover, &:focus-visible': { outline: `2px solid ${colour.brand.link}` } }}
                        >
                          {value}
                        </Box>
                      ) : (
                        <Box component="span" className="num" sx={cell}>
                          0
                        </Box>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
        Each cell counts the unit&apos;s short block-days that week. Pick a number to open that week on the Roster
        tab.
      </Typography>
    </Box>
  );
}
