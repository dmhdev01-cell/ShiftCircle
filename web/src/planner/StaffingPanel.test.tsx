import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import type { StaffingPeriod, StaffingReport, StaffingUnitRow } from '../api/types';
import { theme } from '../theme/theme';
import { StaffingPanel } from './StaffingPanel';
import { staffingTile } from './staffingWords';

function unit(overrides: Partial<StaffingUnitRow> & { unitId: string }): StaffingUnitRow {
  return {
    unitCode: overrides.unitId === 'unit-c' ? 'C' : 'A',
    unitName: overrides.unitId === 'unit-c' ? 'Unit C · Living unit' : 'Unit A · Living unit',
    closed: false,
    allocated: 25,
    filled: 25,
    needed: 25,
    shortfall: 0,
    breakdown: { posts12Day: 5, posts12Night: 4, posts8: 1, rawNeeded: 19.4, leaveAllowance: 0.2, needed: 25 },
    ...overrides,
  };
}

function period(units: StaffingUnitRow[], from = '2027-01-04', to = '2027-04-11'): StaffingPeriod {
  const totals = units.reduce(
    (sum, row) => ({
      allocated: sum.allocated + row.allocated,
      filled: sum.filled + row.filled,
      needed: sum.needed + row.needed,
      shortfall: sum.shortfall + row.shortfall,
    }),
    { allocated: 0, filled: 0, needed: 0, shortfall: 0 },
  );
  return { from, to, units, totals };
}

function report(periods: StaffingPeriod[], leaveAllowance = 0.2): StaffingReport {
  return { leaveAllowance, periods, note: 'Officers are unit-specific.', truncated: false };
}

function renderPanel(value: StaffingReport, draftGaps: number | null) {
  return render(
    <ThemeProvider theme={theme}>
      <StaffingPanel report={value} draftGaps={draftGaps} onChanged={() => undefined} />
    </ThemeProvider>,
  );
}

describe('the staffing floor wording', () => {
  it('calls the figure a floor and never shows meeting it as a pass', () => {
    const met = report([period([unit({ unitId: 'unit-a' }), unit({ unitId: 'unit-c' })])]);
    const tile = staffingTile(met);
    expect(tile.label).toBe('Needed (at least)');
    expect(tile.value).toBe('50');
    expect(tile.note).toBe('50 on staff');
    expect(tile.tone).toBe('info');
    expect(tile.pill).toEqual({ tone: 'info', text: 'Meets the floor' });

    const short = report([period([unit({ unitId: 'unit-c', shortfall: 2, needed: 27 })])]);
    expect(staffingTile(short).pill).toEqual({ tone: 'warn', text: 'Short' });
    expect(staffingTile(short).note).toBe('25 on staff · short 2');
    expect(staffingTile(short).tone).toBe('warn');
  });

  it("renders the floor line, the column heading and the people note from the api's leave", () => {
    renderPanel(report([period([unit({ unitId: 'unit-a' })])], 0.15), null);
    expect(
      screen.getByText(/"Needed \(at least\)" is the least staff the unit minimums need with 15% leave/),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Needed \(at least\)/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'On staff*' })).toBeInTheDocument();
    expect(
      screen.getByText('* On staff counts people, full-time and part-time alike, not hours.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This is a floor: it counts every officer as full-time/),
    ).toBeInTheDocument();
  });

  it('uses the four sentences, and only a covered plan earns Covered', () => {
    const met = report([period([unit({ unitId: 'unit-a' })])]);

    const noDraft = renderPanel(met, null);
    expect(screen.getByText('Meets the floor')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Every unit meets the floor. Generate a draft to see whether the plan still has gaps.',
      ),
    ).toBeInTheDocument();
    noDraft.unmount();

    renderPanel(met, 5);
    expect(screen.getByText('Meets the floor')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Do we need more staff? Probably: every unit meets the floor, but this draft still has 5 block-days short. See the Gaps tab.',
      ),
    ).toBeInTheDocument();
  });

  it('earns Covered only when the draft has no gaps', () => {
    renderPanel(report([period([unit({ unitId: 'unit-a' })])]), 0);
    expect(screen.getByText('Covered')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Do we need more staff? Not for this plan: every unit meets the floor and the draft has no coverage gaps.',
      ),
    ).toBeInTheDocument();
  });

  it('says at least how many more, per unit, and adds the draft gaps', () => {
    const short = report([
      period([
        unit({ unitId: 'unit-c', shortfall: 2, needed: 27 }),
        unit({ unitId: 'unit-a', shortfall: 1, needed: 26, unitName: 'Escort & transport', unitCode: 'ESC' }),
      ]),
    ]);
    renderPanel(short, 9);
    expect(screen.getAllByText('Short').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Do we need more staff? Yes, at least 3 more: Unit C (2), Escort & transport (1). The draft also has 9 block-days short.',
      ),
    ).toBeInTheDocument();
  });

  it('prefixes a later period with its start date', () => {
    const split = report([
      period(
        [unit({ unitId: 'unit-a' }), unit({ unitId: 'unit-c', closed: false })],
        '2027-01-04',
        '2027-02-14',
      ),
      period(
        [unit({ unitId: 'unit-a' }), unit({ unitId: 'unit-c', closed: true, needed: 0 })],
        '2027-02-15',
        '2027-04-11',
      ),
    ]);
    renderPanel(split, 4);
    expect(
      screen.getByText(/^From 15 Feb 2027: Do we need more staff\? Probably/),
    ).toBeInTheDocument();
    // A closed unit's needed cell reads 0 with 'closed' under it.
    const row = screen.getByRole('row', { name: /Unit C/ });
    expect(within(row).getByText('closed')).toBeInTheDocument();
  });
});
