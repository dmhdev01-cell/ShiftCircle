import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import type { OfficerRow, SchedulePayload, ShiftItem } from '../api/types';
import { theme } from '../theme/theme';
import { RosterGrid } from './RosterGrid';

function shift(id: string, startAt: string, endAt: string, template = 'D8'): ShiftItem {
  return { type: 'SHIFT', assignmentId: id, shiftTemplate: template, startAt, endAt, kind: 'ROSTERED', worked: false, version: 0 };
}

function officer(id: string, name: string, cells: OfficerRow['cells'], qualifications: string[] = []): OfficerRow {
  return { employeeId: id, name, rotation: '', qualifications, payPeriodHours: 40, payPeriodThreshold: 80, overtimeStatus: 'UNDER', cells };
}

const days = ['2026-11-30', '2026-12-01'];
const payload = {
  unit: { id: 'unit-b', name: 'Unit B · Living unit' },
  from: days[0],
  to: days[1],
  days,
  asOf: '2026-11-19',
  coverage: [],
  officers: [
    officer('a', 'Ann', [
      { date: days[0], items: [shift('1', '2026-11-30T07:00:00-06:00', '2026-11-30T15:15:00-06:00')] },
      { date: days[1], items: [shift('2', '2026-12-01T19:00:00-06:00', '2026-12-02T07:00:00-06:00', 'N12')] },
    ], ['FIRST_AID']),
    officer('b', 'Ben', [
      { date: days[0], items: [] },
      { date: days[1], items: [shift('3', '2026-12-01T07:00:00-06:00', '2026-12-01T15:00:00-06:00')] },
    ]),
  ],
  warnings: 0,
  overridesThisPeriod: 0,
  publishedState: { published: false, unpublishedChanges: null },
  period: null,
} as unknown as SchedulePayload;

describe('the roster grid totals (A1)', () => {
  it('sums each officer and each day from the cells, to the quarter hour', () => {
    render(
      <ThemeProvider theme={theme}>
        <RosterGrid payload={payload} today="2026-11-19" density="compact" />
      </ThemeProvider>,
    );
    const roster = screen.getByRole('region', { name: 'Roster, scrolls sideways' });
    expect(within(roster).getByText('2 · 20.25 h')).toBeInTheDocument();
    expect(within(roster).getByText('1 · 8 h')).toBeInTheDocument();
    expect(within(roster).getByLabelText('1 on duty, 8.25 h')).toBeInTheDocument();
    expect(within(roster).getByLabelText('2 on duty, 20 h')).toBeInTheDocument();
    // A span that crosses a month names the month on its first day and on the 1st.
    expect(within(roster).getByRole('columnheader', { name: /Mon\s*30 Nov/ })).toBeInTheDocument();
    expect(within(roster).getByRole('columnheader', { name: /Tue\s*1 Dec/ })).toBeInTheDocument();
    expect(within(roster).getByRole('img', { name: 'Qualified: First aid' })).toBeInTheDocument();
    expect(screen.getByText('Ctl = Control · Esc = Escort · FA = First aid')).toBeInTheDocument();
  });

  it('sums only the rows it is given (PR-B filters)', () => {
    render(
      <ThemeProvider theme={theme}>
        <RosterGrid payload={payload} today="2026-11-19" officers={[payload.officers[1]]} />
      </ThemeProvider>,
    );
    expect(screen.queryByText('Ann')).not.toBeInTheDocument();
    expect(screen.getByLabelText('1 on duty, 8 h')).toBeInTheDocument();
    expect(screen.getByLabelText('0 on duty, 0 h')).toBeInTheDocument();
  });
});

describe('an officer placed from another unit (v1.2 cross-unit fill)', () => {
  it('marks the row "From" the home unit, and only that row', () => {
    const away = {
      ...payload,
      officers: [{ ...payload.officers[0], homeUnit: 'Unit A · Living unit' }, payload.officers[1]],
    } as SchedulePayload;
    render(
      <ThemeProvider theme={theme}>
        <RosterGrid payload={away} today="2026-11-19" />
      </ThemeProvider>,
    );
    const markers = screen.getAllByTestId('from-unit');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveTextContent('From Unit A');
    expect(markers[0].closest('tr')).toHaveAttribute('data-officer-name', 'Ann');
  });
});
