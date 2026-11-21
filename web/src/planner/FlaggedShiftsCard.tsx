import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { FlaggedShift } from '../api/types';
import { colour } from '../theme/tokens';
import { dateWords, weekdayDateWords } from './unitDates';

/** The first Monday of the shift's week, for the board's existing week param. */
function mondayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const monday = new Date(parsed);
  monday.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/**
 * Shifts in closed units (release 3): published before their unit was closed,
 * on or after the closing date. Nothing is deleted; the list tells the planner
 * and points to the board, where a supervisor moves or cancels each shift.
 */
export function FlaggedShiftsCard({ shifts }: { shifts: FlaggedShift[] }) {
  const [showAll, setShowAll] = useState(false);
  if (shifts.length === 0) return null;
  const sorted = [...shifts].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.unitName.localeCompare(b.unitName) ||
      a.officerName.localeCompare(b.officerName),
  );
  const shown = showAll ? sorted : sorted.slice(0, 10);

  return (
    <Card sx={{ borderLeft: `4px solid ${colour.status.warn.text}` }}>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
          Shifts in closed units ({shifts.length})
        </Typography>
        <Typography sx={{ fontSize: 14 }}>
          These shifts were published before their unit was closed, and they fall on or after the
          closing date. They are still on the planning board and the officers still see them.
          Nothing has been deleted. A supervisor moves each officer to another unit or cancels the
          shift on the planning board.
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Unit', 'Date', 'Shift', 'Officer', 'Closed from', ''].map((heading, index) => (
                  <th
                    key={heading || index}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: colour.text.secondary,
                      borderBottom: `1px solid ${colour.border.default}`,
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((shift) => {
                const unitShort = shift.unitName.split(' · ')[0];
                return (
                  <tr key={shift.shiftId}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{unitShort}</td>
                    <td style={{ padding: '6px 8px' }}>{weekdayDateWords(shift.date)}</td>
                    <td style={{ padding: '6px 8px' }}>{shift.shiftLabel}</td>
                    <td style={{ padding: '6px 8px' }}>{shift.officerName}</td>
                    <td style={{ padding: '6px 8px' }}>{dateWords(shift.closedFrom)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <Button
                        component={RouterLink}
                        to={`/planning?unit=${encodeURIComponent(shift.unitId)}&week=${mondayOf(shift.date)}`}
                        variant="text"
                        size="small"
                        aria-label={`Show ${unitShort}, week of ${dateWords(mondayOf(shift.date))}, on the planning board`}
                      >
                        Show on board
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
        {sorted.length > 10 && !showAll ? (
          <Box>
            <Button variant="text" color="primary" onClick={() => setShowAll(true)}>
              Show all {sorted.length}
            </Button>
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
