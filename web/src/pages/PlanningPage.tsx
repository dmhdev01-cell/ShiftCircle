import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { ShiftChip } from '../components/ShiftChip';
import { colour } from '../theme/tokens';

const key: { code: Parameters<typeof ShiftChip>[0]['code']; label: string; extra?: boolean }[] = [
  { code: 'D', label: 'Day 07-15' },
  { code: 'E', label: 'Evening 15-23' },
  { code: 'N', label: 'Night 23-07' },
  { code: 'A12', label: '12 h 00-12' },
  { code: 'P12', label: '12 h 12-24' },
  { code: 'L16', label: '16 h 20:00-12:00 (regular)' },
  { code: 'E', label: 'Extra shift picked up beyond the roster', extra: true },
  { code: 'Sick', label: 'Sick' },
  { code: 'Vac', label: 'Vacation' },
  { code: 'Off', label: 'Off' },
];

/**
 * The planning board (docs/ui/README.md §5.1). The roster grid, rule-check
 * panel and activity feed are not built in this scaffold; the shift key is,
 * so the shift codes are pinned to ADR-015 (A12 / P12, not the mockups'
 * D12 / N12).
 */
export function PlanningPage() {
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">Planning board</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          Supervisor · Unit B · Living unit · Week of 16 - 22 Nov 2026 · Published, 3 unpublished
          changes
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Shift key</Typography>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '10px 16px',
              fontSize: 12,
              color: colour.text.secondary,
            }}
          >
            <Typography sx={{ fontWeight: 600, color: colour.text.primary, fontSize: 12 }}>Key</Typography>
            {key.map((entry, index) => (
              <Box key={`${entry.code}-${index}`} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <ShiftChip code={entry.code} extra={entry.extra} />
                <span>{entry.label}</span>
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 12, color: colour.text.muted }}>
            Shift times follow ADR-015: 8 h 07-15 / 15-23 / 23-07, 12 h 00-12 / 12-24, and a regular
            16 h 20:00-12:00 shift. Overtime is a pay-period status, not a shift type (ADR-016).
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Not built yet</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            The roster grid, the rule-check panel with its override dialog, and the recent-activity
            feed are described in docs/ui/README.md §5.1 and are not part of this scaffold.
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
