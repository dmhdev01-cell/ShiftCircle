import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { OvertimeReport } from '../api/types';
import { colour } from '../theme/tokens';

interface OvertimeBarsProps {
  report: OvertimeReport;
  title?: string;
  /** Who the average is per: "person", or the rank chosen in the Position filter (v1.3 S7). */
  per?: string;
}

/**
 * Overtime by person (docs/ui/README.md §5.5). The ranking basis is the
 * overtime hours this quarter (ADR-016), so that is what the bars show.
 */
export function OvertimeBars({ report, title = 'Overtime this quarter · top 8', per = 'person' }: OvertimeBarsProps) {
  const top = report.rows[0]?.hours ?? 1;

  return (
    <Box
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
      <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
        {title}
      </Typography>

      {report.rows.map((row) => (
        <Box
          key={row.employeeId}
          sx={{
            display: 'grid',
            gridTemplateColumns: '130px minmax(0, 1fr) 56px',
            alignItems: 'center',
            gap: 2.5,
            fontSize: 13,
          }}
        >
          <Box
            component="span"
            sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {row.name}
          </Box>
          <Box
            aria-hidden="true"
            sx={{ height: 14, backgroundColor: colour.status.info.bg, borderRadius: '4px' }}
          >
            <Box
              sx={{
                height: 14,
                width: `${Math.round((row.hours / top) * 100)}%`,
                backgroundColor: colour.support.lentils,
                borderRadius: '4px',
              }}
            />
          </Box>
          <Box className="num" sx={{ textAlign: 'right', fontWeight: 600 }}>
            {row.hours.toFixed(1)} h
          </Box>
        </Box>
      ))}

      <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
        Facility average: {report.averageHours.toFixed(1)} h per {per} · fair-distribution order uses
        these totals
      </Typography>
    </Box>
  );
}
