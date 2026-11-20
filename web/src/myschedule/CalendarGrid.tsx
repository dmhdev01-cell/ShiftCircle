import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import type { CellItem } from '../api/types';
import { AbsenceChip, ShiftChip } from '../components/ShiftChip';
import { colour } from '../theme/tokens';

export interface CalendarCell {
  date: string;
  /** False for the days of the neighbouring months. */
  inMonth: boolean;
  items: CellItem[];
}

interface CalendarGridProps {
  cells: CalendarCell[];
  today: string;
  monthLabel: string;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

function dayNumber(date: string): string {
  return new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/**
 * The month calendar (docs/ui/README.md §5.2). A chip sits on the start date
 * of a shift and its tooltip gives the full times; days of the neighbouring
 * months are dimmed and today is outlined.
 */
export function CalendarGrid({
  cells,
  today,
  monthLabel,
  onPreviousMonth,
  onNextMonth,
}: CalendarGridProps) {
  return (
    <Box
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
      <Box
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 3 }}
      >
        <Typography component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 700 }}>
          {monthLabel}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" color="primary" aria-label="Previous month" onClick={onPreviousMonth}>
            ‹
          </Button>
          <Button variant="outlined" color="primary" aria-label="Next month" onClick={onNextMonth}>
            ›
          </Button>
        </Box>
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 640, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 1.5,
              fontSize: 12,
              fontWeight: 600,
              color: colour.text.secondary,
            }}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <Box key={day} component="span">
                {day}
              </Box>
            ))}
          </Box>

          <Box
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1.5 }}
          >
            {cells.map((cell) => {
              const isToday = cell.date === today;
              return (
                <Box
                  key={cell.date}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    minHeight: 84,
                    p: 2,
                    boxSizing: 'border-box',
                    backgroundColor: cell.inMonth ? colour.bg.surface : colour.bg.subtle,
                    border: isToday
                      ? `2px solid ${colour.brand.link}`
                      : `1px solid ${colour.border.default}`,
                    borderRadius: '8px',
                  }}
                >
                  <Box
                    className="num"
                    component="span"
                    sx={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: cell.inMonth ? colour.text.primary : colour.text.muted,
                    }}
                  >
                    {dayNumber(cell.date)}
                  </Box>
                  {cell.items.map((item) =>
                    item.type === 'ABSENCE' ? (
                      <AbsenceChip key={item.absenceType} absenceType={item.absenceType} />
                    ) : (
                      <ShiftChip
                        key={item.assignmentId}
                        template={item.shiftTemplate}
                        extra={item.kind === 'EXTRA'}
                        worked={item.worked}
                        offer={item.offer ?? false}
                        proposed={item.proposed ?? false}
                        compact
                      />
                    ),
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
        ✓ = worked (recorded by your supervisor) · dashed green = overtime offered to you
      </Box>
    </Box>
  );
}
