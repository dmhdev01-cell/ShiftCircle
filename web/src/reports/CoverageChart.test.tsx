import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import type { CoverageReport, CoverageWeek } from '../api/types';
import { theme } from '../theme/theme';
import { CoverageChart } from './CoverageChart';
import { barSegments, coverageSummary } from './coverageSummary';

function week(overrides: Partial<CoverageWeek> & { label: string }): CoverageWeek {
  return {
    scheduledPercent: 100,
    actualPercent: null,
    planned: false,
    extraHours: 0,
    extraPercent: 0,
    requiredHours: 3920,
    ...overrides,
  };
}

function report(weeks: CoverageWeek[], axisFrom = 94, axisTo = 102): CoverageReport {
  return {
    weeks,
    axisFrom,
    axisTo,
    requiredHours: 3920,
    scheduledHours: 3891,
    actualHours: 3848,
  };
}

function renderChart(value: CoverageReport) {
  return render(
    <ThemeProvider theme={theme}>
      <CoverageChart report={value} />
    </ThemeProvider>,
  );
}

describe('the coverage chart overtime share', () => {
  it('splits the scheduled bar into regular and extra-shift segments on the axis', () => {
    // scheduled 102, extra 5 -> regular 97; axis 94..102 -> 100% height span of 8.
    expect(barSegments(week({ label: 'w', scheduledPercent: 102, extraPercent: 5 }), 94, 102)).toEqual({
      regular: (97 - 94) / 8 * 100,
      extra: 5 / 8 * 100,
    });
    // No extra shifts: one segment, no red.
    expect(barSegments(week({ label: 'w', scheduledPercent: 101, extraPercent: 0 }), 94, 102)).toEqual({
      regular: (101 - 94) / 8 * 100,
      extra: 0,
    });
  });

  it('draws the red segment only for a week that used extra shifts, with a non-colour cue', () => {
    renderChart(
      report([
        week({ label: '2 – 8 Nov', scheduledPercent: 101.2, extraPercent: 3.2, extraHours: 125.4 }),
        week({ label: '9 – 15 Nov', scheduledPercent: 100.4, extraPercent: 0 }),
      ]),
    );
    expect(screen.getAllByTestId('coverage-extra')).toHaveLength(1);
    // The hatch is the cue, so the red is not the only signal.
    expect(screen.getAllByTestId('coverage-extra')[0].getAttribute('title')).toContain('extra shifts 3.2%');
    expect(screen.getAllByTestId('coverage-extra')[0].getAttribute('title')).toContain('regular 98.0%');
  });

  it('summarises the weeks in the exact template, one decimal', () => {
    const none = [week({ label: 'a', extraPercent: 0 })];
    expect(coverageSummary(none)).toBe("No week's coverage came from extra shifts.");

    const one = [
      week({ label: '2 – 8 Nov', scheduledPercent: 100.0, extraPercent: 0.2 }),
      week({ label: '9 – 15 Nov', scheduledPercent: 101, extraPercent: 0.6 }),
    ];
    expect(coverageSummary(one)).toBe(
      'In 2 of 2 weeks, part of the coverage came from extra shifts (overtime), up to 0.6% of the required hours in the week of 9 – 15 Nov. Without them, 1 week would have been under 100%.',
    );

    const several = [
      week({ label: '2 – 8 Nov', scheduledPercent: 99, extraPercent: 1 }),
      week({ label: '9 – 15 Nov', scheduledPercent: 98, extraPercent: 2 }),
      week({ label: '16 – 22 Nov', scheduledPercent: 102, extraPercent: 0.5 }),
    ];
    expect(coverageSummary(several)).toBe(
      'In 3 of 3 weeks, part of the coverage came from extra shifts (overtime), up to 2.0% of the required hours in the week of 9 – 15 Nov. Without them, 2 weeks would have been under 100%.',
    );

    const covered = [week({ label: '2 – 8 Nov', scheduledPercent: 103, extraPercent: 1 })];
    expect(coverageSummary(covered)).toBe(
      "In 1 of 1 weeks, part of the coverage came from extra shifts (overtime), up to 1.0% of the required hours in the week of 2 – 8 Nov. Without them, every week would still have met 100%.",
    );
  });

  it('ties the top week to the earliest one', () => {
    const weeks = [
      week({ label: '2 – 8 Nov', scheduledPercent: 100, extraPercent: 2 }),
      week({ label: '9 – 15 Nov', scheduledPercent: 100, extraPercent: 2 }),
    ];
    expect(coverageSummary(weeks)).toContain('up to 2.0% of the required hours in the week of 2 – 8 Nov');
  });

  it('shows the new table column and puts the sentence in the chart aria label', () => {
    renderChart(
      report([
        week({
          label: '2 – 8 Nov',
          scheduledPercent: 101.2,
          actualPercent: 100.1,
          extraPercent: 3.2,
          extraHours: 125.4,
          extraHoursByBlock: { DAY: 40, EVENING: 40, NIGHT: 45.4 },
        }),
      ]),
    );
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'of which extra shifts' })).toBeInTheDocument();
    expect(within(table).getByText('3.2% · 125.4 h')).toBeInTheDocument();
    expect(within(table).getByText('3.2% · 125.4 h').getAttribute('title')).toBe(
      'Days 40.0 h · Evenings 40.0 h · Nights 45.4 h',
    );
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
      'part of the coverage came from extra shifts (overtime)',
    );
    // The old per-week sentence is gone; the data is in the table once.
    expect(screen.queryByText(/of which overtime or extra/)).not.toBeInTheDocument();
  });
});
