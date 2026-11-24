import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import type { BlockCoverage } from '../api/types';
import { theme } from '../theme/theme';
import { CoverageCell } from './CoverageCell';

const TODAY = '2026-11-19';

function block(overrides: Partial<BlockCoverage> = {}): BlockCoverage {
  return {
    block: 'DAY',
    date: TODAY,
    required: 5,
    scheduled: { lowestHourly: 5, shortHours: [], maxHourly: 5 },
    actual: { lowestHourly: 0, shortHours: [{ from: '07:00', to: '15:00', count: 0 }], maxHourly: 0 },
    covered: true,
    ...overrides,
  };
}

function renderCell(entry: BlockCoverage) {
  return render(
    <ThemeProvider theme={theme}>
      <CoverageCell block={entry} today={TODAY} />
    </ThemeProvider>,
  );
}

/**
 * V1: today's cells read "0 / 5 short" because the cell used the recorded
 * actuals of a day that is still running, while the wall display showed the
 * five officers who are scheduled on.
 */
describe('a coverage cell', () => {
  it('shows the scheduled coverage for today, not the hours recorded so far', () => {
    renderCell(block());

    expect(screen.getByText('5 / 5')).toBeInTheDocument();
    expect(screen.getByText('on shift')).toBeInTheDocument();
    expect(screen.queryByText('0 / 5')).not.toBeInTheDocument();
  });

  it('shows the scheduled coverage for a future day', () => {
    renderCell(block({ date: '2026-11-21' }));

    expect(screen.getByText('5 / 5')).toBeInTheDocument();
  });

  it('keeps the actuals of a past day, even when they are short', () => {
    renderCell(block({ date: '2026-11-18' }));

    expect(screen.getByText('0 / 5')).toBeInTheDocument();
    expect(screen.getByText(/short 07–15/)).toBeInTheDocument();
  });
});

describe('a compact coverage heat cell (A1)', () => {
  it('shows lowest/required and keeps the short hours in its name', () => {
    render(
      <ThemeProvider theme={theme}>
        <CoverageCell
          block={block({
            date: '2026-11-21',
            scheduled: { lowestHourly: 3, shortHours: [{ from: '07:00', to: '15:00', count: 3 }], maxHourly: 3 },
            covered: false,
          })}
          today={TODAY}
          compact
        />
      </ThemeProvider>,
    );
    const cell = screen.getByText('3/5');
    expect(cell).toHaveAccessibleName(/3 of 5\. Lowest 3 of 5 required · Short 07–15/);
    // Two or more short is the orange heat tone.
    expect(cell).toHaveStyle({ backgroundColor: '#F6B26B' });
  });

  it('A2: a short cell today or later is a button that opens the fill panel', async () => {
    const onFill = vi.fn();
    const short = block({
      date: '2026-11-21',
      scheduled: { lowestHourly: 3, shortHours: [{ from: '07:00', to: '15:00', count: 3 }], maxHourly: 3 },
      actual: undefined,
      covered: false,
    });
    render(
      <ThemeProvider theme={theme}>
        <CoverageCell block={short} today={TODAY} onFill={onFill} />
        <CoverageCell block={short} today={TODAY} compact onFill={onFill} selected />
      </ThemeProvider>,
    );
    const buttons = screen.getAllByRole('button', { name: /^Fill gap: Sat 21 Nov days, 3 ?\/ ?5/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false');
    expect(buttons[0]).not.toHaveAttribute('aria-controls');
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'true');
    expect(buttons[1]).toHaveAttribute('aria-controls', 'gap-fill-panel');
    buttons[0].click();
    expect(onFill).toHaveBeenCalledWith(short);
  });

  it('A2: a met cell, a past cell or a cell without a handler stays plain', () => {
    const onFill = vi.fn();
    const shortPast = block({
      date: '2026-11-18',
      scheduled: { lowestHourly: 3, shortHours: [{ from: '07:00', to: '15:00', count: 3 }], maxHourly: 3 },
      actual: undefined,
      covered: false,
    });
    render(
      <ThemeProvider theme={theme}>
        <CoverageCell block={block({ date: '2026-11-21' })} today={TODAY} onFill={onFill} />
        <CoverageCell block={shortPast} today={TODAY} onFill={onFill} />
        <CoverageCell block={{ ...shortPast, date: '2026-11-21' }} today={TODAY} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

