import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { CoverageReport } from '../api/types';
import { colour } from '../theme/tokens';
import { axisTicks } from './coverageAxis';

interface CoverageChartProps {
  report: CoverageReport;
}

export function CoverageChart({ report }: CoverageChartProps) {
  const { weeks, axisFrom, axisTo } = report;
  const span = axisTo - axisFrom;
  const height = (value: number) => `${Math.max(0, ((value - axisFrom) / span) * 100)}%`;

  const actuals = weeks
    .map((week) => week.actualPercent)
    .filter((value): value is number => value !== undefined && value !== null);

  const summary =
    actuals.length > 0
      ? `Weekly coverage, scheduled and actual as a percentage of required. Actual ranges from ${Math.min(...actuals).toFixed(1)}% to ${Math.max(...actuals).toFixed(1)}%.`
      : 'Weekly coverage, scheduled as a percentage of required. No week has been worked yet.';

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
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
          Coverage: share of required staff-hours
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, fontSize: 12 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '3px', backgroundColor: colour.support.flax }} />
            Scheduled
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '3px', backgroundColor: colour.brand.link }} />
            Actual
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 14, borderTop: '2px dashed #333333' }} />
            Required (100%)
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Box
          aria-hidden="true"
          className="num"
          sx={{
            position: 'relative',
            height: 200,
            fontSize: 11,
            color: colour.text.secondary,
            textAlign: 'right',
            minWidth: 40,
          }}
        >
          {/* The labels sit where their value is: an axis from 94 to 116 puts
              100 % near the bottom, and saying 100 % anywhere else is a lie. */}
          {axisTicks(axisFrom, axisTo).map((tick) => (
            <span
              key={tick.value}
              style={{ position: 'absolute', right: 0, top: `${tick.top}%`, transform: 'translateY(-50%)' }}
            >
              {tick.value}%
            </span>
          ))}
        </Box>

        <Box
          role="img"
          aria-label={summary}
          sx={{
            position: 'relative',
            flex: 1,
            height: 200,
            borderLeft: `1px solid ${colour.border.input}`,
            borderBottom: `1px solid ${colour.border.input}`,
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${((axisTo - 100) / span) * 100}%`,
              borderTop: '2px dashed #333333',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-around',
              p: '0 8px',
            }}
          >
            {weeks.map((week) => (
              <Box key={week.label} sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: '100%' }}>
                <Box
                  title={`Scheduled ${week.scheduledPercent}%`}
                  sx={{
                    width: 16,
                    height: height(week.scheduledPercent),
                    backgroundColor: colour.support.flax,
                    borderRadius: '3px 3px 0 0',
                  }}
                />
                {week.actualPercent !== undefined && week.actualPercent !== null ? (
                  <Box
                    title={`Actual ${week.actualPercent}%`}
                    sx={{
                      width: 16,
                      height: height(week.actualPercent),
                      backgroundColor: colour.brand.link,
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                ) : null}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      <Box
        className="num"
        sx={{ display: 'flex', justifyContent: 'space-around', pl: 6, fontSize: 11, color: colour.text.secondary }}
      >
        {weeks.map((week) => (
          <span key={week.label}>{week.label}</span>
        ))}
      </Box>

      {/* 'Of which overtime or extra': the api separates the scheduled hours
          that came from EXTRA shifts, so a covered block that leans on overtime
          is visible rather than hidden inside a percentage. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12, color: colour.text.secondary }}>
        {weeks.map((week) => (
          <span key={week.label} className="num">
            {week.label}: of which overtime or extra{' '}
            {week.extraHours !== undefined ? `${week.extraHours.toFixed(1)} h` : '—'}
            {week.extraHoursByBlock
              ? ` (Days ${(week.extraHoursByBlock.DAY ?? 0).toFixed(1)} · Evenings ${(week.extraHoursByBlock.EVENING ?? 0).toFixed(1)} · Nights ${(week.extraHoursByBlock.NIGHT ?? 0).toFixed(1)})`
              : ''}
          </span>
        ))}
      </Box>

      <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
        The axis starts at {axisFrom}% so small gaps are visible. The{' '}
        {weeks.find((week) => week.planned)?.label ?? 'last'} week is planned only.
      </Typography>

      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Week', 'Scheduled', 'Actual', 'Planned'].map((heading) => (
                <th
                  key={heading}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: colour.text.secondary,
                    backgroundColor: colour.bg.subtle,
                    borderBottom: `1px solid ${colour.border.default}`,
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.label}>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                  {week.label}
                </td>
                <td
                  className="num"
                  style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}
                >
                  {week.scheduledPercent.toFixed(1)}%
                </td>
                <td
                  className="num"
                  style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}
                >
                  {week.actualPercent !== undefined && week.actualPercent !== null ? `${week.actualPercent.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                  {week.planned ? 'Planned only' : 'Actual'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}
