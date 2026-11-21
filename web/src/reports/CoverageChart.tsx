import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { CoverageReport } from '../api/types';
import { colour } from '../theme/tokens';
import { dateWords } from '../planner/unitDates';
import { axisTicks } from './coverageAxis';
import { barSegments, coverageSummary } from './coverageSummary';

interface CoverageChartProps {
  report: CoverageReport;
}

const HATCH = 'repeating-linear-gradient(135deg, #C40000 0 3px, #FFFFFF 3px 5px)';

export function CoverageChart({ report }: CoverageChartProps) {
  const { weeks, axisFrom, axisTo } = report;
  const span = axisTo - axisFrom;
  const height = (value: number) => `${Math.max(0, ((value - axisFrom) / span) * 100)}%`;

  const actuals = weeks
    .map((week) => week.actualPercent)
    .filter((value): value is number => value !== undefined && value !== null);

  const chartWords =
    actuals.length > 0
      ? `Weekly coverage, scheduled and actual as a percentage of required. Actual ranges from ${Math.min(...actuals).toFixed(1)}% to ${Math.max(...actuals).toFixed(1)}%.`
      : 'Weekly coverage, scheduled as a percentage of required. No week has been worked yet.';
  const summary = coverageSummary(weeks);

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
            Regular shifts
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{ width: 12, height: 12, borderRadius: '3px', background: HATCH, backgroundColor: colour.status.block.border }}
            />
            Extra shifts (overtime)
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
          aria-label={`${chartWords} ${summary}`}
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
            {weeks.map((week) => {
              const segments = barSegments(week, axisFrom, axisTo);
              const extraPercent = week.extraPercent ?? 0;
              const regularPercent = week.scheduledPercent - extraPercent;
              return (
                <Box key={week.label} sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: '100%' }}>
                  <Box
                    title={`Scheduled ${week.scheduledPercent.toFixed(1)}% · regular ${regularPercent.toFixed(
                      1,
                    )}% · extra shifts ${extraPercent.toFixed(1)}%`}
                    sx={{
                      width: 16,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {segments.extra > 0 ? (
                      <Box
                        data-testid="coverage-extra"
                        title={`extra shifts ${extraPercent.toFixed(1)}% · regular ${regularPercent.toFixed(1)}%`}
                        sx={{
                          height: `${segments.extra}%`,
                          width: '100%',
                          background: HATCH,
                          backgroundColor: colour.status.block.border,
                          borderRadius: '3px 3px 0 0',
                        }}
                      />
                    ) : null}
                    <Box
                      data-testid="coverage-regular"
                      sx={{
                        // A 1 px white gap keeps the two segments readable.
                        borderTop: segments.extra > 0 ? `1px solid ${colour.bg.surface}` : 0,
                        height: `${segments.regular}%`,
                        width: '100%',
                        backgroundColor: colour.support.flax,
                        borderRadius: segments.extra > 0 ? 0 : '3px 3px 0 0',
                      }}
                    />
                  </Box>
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
              );
            })}
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

      <Typography sx={{ fontSize: 13, color: colour.text.primary }}>{summary}</Typography>
      <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
        Extra shifts are shifts added on top of the roster, including accepted overtime offers. Payroll
        overtime (hours over the pay-period threshold) is on the Overtime tab and is counted differently.
      </Typography>

      {report.closureNotes?.map((note) => (
        <Typography
          key={note.unitId}
          role="note"
          sx={{ fontSize: 13, color: colour.status.info.text }}
        >
          {note.unitName.split(' · ')[0]} is closed from {dateWords(note.closedFrom)}. From that date
          it needs no staff, so its hours are not counted in required or scheduled.
        </Typography>
      ))}

      <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
        The axis starts at {axisFrom}% so small gaps are visible. The{' '}
        {weeks.find((week) => week.planned)?.label ?? 'last'} week is planned only.
      </Typography>

      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Week', 'Scheduled', 'of which extra shifts', 'Actual', 'Planned'].map((heading) => (
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
            {weeks.map((week) => {
              const extraPercent = week.extraPercent ?? 0;
              const blocks = week.extraHoursByBlock;
              return (
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
                    title={
                      blocks
                        ? `Days ${(blocks.DAY ?? 0).toFixed(1)} h · Evenings ${(blocks.EVENING ?? 0).toFixed(
                            1,
                          )} h · Nights ${(blocks.NIGHT ?? 0).toFixed(1)} h`
                        : undefined
                    }
                    style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}
                  >
                    {extraPercent.toFixed(1)}% · {(week.extraHours ?? 0).toFixed(1)} h
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
              );
            })}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}
