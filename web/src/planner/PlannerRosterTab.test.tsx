import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api } from '../api/client';
import { plannerSchedule } from '../api/fixtures/planner';
import type { PlannerGap } from '../api/types';
import { theme } from '../theme/theme';
import { PlannerRosterTab } from './PlannerRosterTab';

/**
 * Observation 32: the selected unit's name is the grid's heading, and the
 * picker says how many gaps the visible week has per unit ("no gaps", "1 gap",
 * "2 gaps"). The page test covers the wiring; this covers the counts.
 */

const UNITS = [
  { id: 'unit-a', name: 'Unit A · Living unit' },
  { id: 'unit-b', name: 'Unit B · Living unit' },
  { id: 'control', name: 'Control' },
];

function gap(unitId: string, unitName: string, date: string, index: number): PlannerGap {
  return {
    unitId,
    unitCode: unitId === 'control' ? 'CTL' : unitId.slice(-1).toUpperCase(),
    unitName,
    date,
    block: index % 2 === 0 ? 'DAY' : 'NIGHT',
    required: 3,
    placed: 2,
    reason: null,
  };
}

const GAPS = [
  gap('unit-a', 'Unit A · Living unit', '2027-01-09', 0),
  gap('unit-b', 'Unit B · Living unit', '2027-01-13', 1),
  gap('control', 'Control', '2027-01-04', 2),
  gap('control', 'Control', '2027-01-05', 3),
];

function renderTab(unitParam: string, weekParam: string | null) {
  vi.spyOn(api, 'getPlannerSchedule').mockImplementation(async (_draftId, query) => {
    const name = UNITS.find((unit) => unit.id === query.unitId)?.name ?? 'Unit';
    const base = plannerSchedule({ unitId: query.unitId, from: query.from, to: query.to });
    return { ...base, unit: { ...base.unit, id: query.unitId, name } };
  });
  vi.spyOn(api, 'getPlannerCoverage').mockResolvedValue([]);
  return render(
    <ThemeProvider theme={theme}>
      <PlannerRosterTab
        draftId="draft-1"
        window={{ from: '2027-01-04', to: '2027-04-11' }}
        gaps={GAPS}
        units={UNITS}
        unitParam={unitParam}
        weekParam={weekParam}
        onChange={() => undefined}
      />
    </ThemeProvider>,
  );
}

function options(): string[] {
  return within(screen.getByLabelText('Unit'))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
}

describe('the roster tab unit picker', () => {
  it("heads the grid with the unit and counts the visible week's gaps", async () => {
    renderTab('unit-a', null);

    expect(await screen.findByRole('heading', { name: 'Unit A · Living unit' })).toBeInTheDocument();
    expect(options()).toEqual([
      'Unit A · Living unit · 1 gap this week, 1 in the quarter',
      'Unit B · Living unit · no gaps this week, 1 in the quarter',
      'Control · 2 gaps this week, 2 in the quarter',
    ]);
  });

  it('counts the week it is showing, not another one', async () => {
    renderTab('unit-b', '2027-01-11');

    expect(await screen.findByRole('heading', { name: 'Unit B · Living unit' })).toBeInTheDocument();
    expect(options()).toEqual([
      'Unit A · Living unit · no gaps this week, 1 in the quarter',
      'Unit B · Living unit · 1 gap this week, 1 in the quarter',
      'Control · no gaps this week, 2 in the quarter',
    ]);
  });

  it('keeps the All-units strip clickable', async () => {
    const user = userEvent.setup();
    const changes: { unit?: string; week?: string }[] = [];
    vi.spyOn(api, 'getPlannerSchedule').mockImplementation(async (_draftId, query) => {
      const base = plannerSchedule(query);
      return { ...base, unit: { ...base.unit, id: query.unitId } };
    });
    vi.spyOn(api, 'getPlannerCoverage').mockResolvedValue([
      {
        unitId: 'unit-a',
        unitName: 'Unit A · Living unit',
        coverage: [],
      },
    ]);
    render(
      <ThemeProvider theme={theme}>
        <PlannerRosterTab
          draftId="draft-1"
          window={{ from: '2027-01-04', to: '2027-04-11' }}
          gaps={GAPS}
          units={UNITS}
          unitParam="unit-a"
          weekParam={null}
          onChange={(next) => changes.push(next)}
        />
      </ThemeProvider>,
    );

    const strip = await screen.findByRole('region', { name: /All units · 4 – 10 Jan 2027/ });
    // Q3: the all-units table starts collapsed under its heading.
    expect(within(strip).queryByRole('table')).toBeNull();
    await user.click(within(strip).getByRole('button', { name: 'Show all units' }));
    await user.click(within(strip).getByRole('button', { name: 'Unit A · Living unit' }));
    expect(changes).toContainEqual({ unit: 'unit-a' });
  });

  it('says a unit is closed in the picker, the note and the cells', async () => {
    vi.spyOn(api, 'getPlannerSchedule').mockImplementation(async (_draftId, query) => {
      const base = plannerSchedule(query);
      return {
        ...base,
        unit: {
          ...base.unit,
          id: 'unit-c',
          name: 'Unit C · Living unit',
          closedFrom: '2027-02-15',
          closedTo: null,
          closedLabel: 'Closed from 15 Feb 2027',
          closedReason: 'Renovation (demo)',
        },
      };
    });
    vi.spyOn(api, 'getPlannerCoverage').mockResolvedValue([
      {
        unitId: 'unit-c',
        unitName: 'Unit C · Living unit',
        coverage: [],
        closedFrom: '2027-02-15',
        closedTo: null,
        closedLabel: 'Closed from 15 Feb 2027',
        closedReason: 'Renovation (demo)',
      },
    ]);
    render(
      <ThemeProvider theme={theme}>
        <PlannerRosterTab
          draftId="draft-1"
          window={{ from: '2027-01-04', to: '2027-04-11' }}
          gaps={[]}
          units={[{ id: 'unit-c', name: 'Unit C · Living unit' }]}
          unitParam="unit-c"
          weekParam="2027-02-15"
          onChange={() => undefined}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Unit C · Living unit' })).toBeInTheDocument();
    expect(options()[0]).toContain('(closed from 15 Feb 2027)');
    expect(screen.getByText(/Unit C is closed from Mon 15 Feb 2027/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show all units' }));
    expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(7);
  });
});

describe('draft editing on the roster tab', () => {
  function mockSchedule(editFirst = false) {
    vi.spyOn(api, 'getPlannerSchedule').mockImplementation(async (_draftId, query) => {
      const base = plannerSchedule(query);
      const officer = base.officers[0];
      if (officer) {
        officer.cells = base.days.map((date, index) => ({
          date,
          items:
            index === 0
              ? [
                  {
                    type: 'SHIFT' as const,
                    assignmentId: 'a1',
                    shiftTemplate: 'D8',
                    startAt: `${date}T07:00:00-06:00`,
                    endAt: `${date}T15:00:00-06:00`,
                    kind: 'ROSTERED' as const,
                    worked: false,
                    version: 1,
                    edited: editFirst,
                  },
                ]
              : [],
        }));
      }
      return base;
    });
    vi.spyOn(api, 'getPlannerCoverage').mockResolvedValue([]);
    vi.spyOn(api, 'getPlannerPreferences').mockResolvedValue([
      {
        employeeId: 'e1',
        name: 'Nia Thompson',
        employeeNo: 'E-1',
        unitName: 'Unit A · Living unit',
        seniorityDate: '2020-01-01',
        shiftLength: null,
        timesOfDay: [],
        daysOff: [],
        maxDaysOff: 2,
        pattern: 'ROTATING_5_2',
        patternWords: 'Rotating 5 on, 2 off',
        patternEditable: true,
        inDraft: 'NONE',
        unmet: [],
        updatedAt: null,
      },
    ]);
  }

  function renderEditable(editable: boolean, handEdits = 0) {
    mockSchedule(false);
    return render(
      <ThemeProvider theme={theme}>
        <PlannerRosterTab
          draftId="draft-1"
          version={3}
          handEdits={handEdits}
          editable={editable}
          window={{ from: '2027-01-04', to: '2027-04-11' }}
          gaps={[]}
          units={UNITS}
          unitParam="unit-a"
          weekParam={null}
          onChange={() => undefined}
          onDraftChanged={() => undefined}
        />
      </ThemeProvider>,
    );
  }

  it('counts hand edits and opens the shift and add dialogs', async () => {
    const user = userEvent.setup();
    renderEditable(true, 2);

    expect(
      await screen.findByText(
        "Draft · not on the planning board yet. You can change shifts here until you commit. Officers and supervisors can't see it until it's committed. 2 hand edits so far.",
      ),
    ).toBeInTheDocument();

    const chip = screen.getAllByRole('button', { name: /for .+ on \d{4}-\d{2}-\d{2}/ })[0];
    await user.click(chip);
    expect(
      screen.getByText(
        'Change this shift in the draft. Nothing reaches the planning board until you commit.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    const off = screen
      .getAllByRole('button', { name: /Off - assign a shift/ })
      .find((button) => !button.hasAttribute('disabled'))!;
    await user.click(off);
    expect(screen.getByText(/Add a shift for .+ on /)).toBeInTheDocument();
  });

  it('marks a hand-edited chip in words', async () => {
    mockSchedule(true);
    render(
      <ThemeProvider theme={theme}>
        <PlannerRosterTab
          draftId="draft-1"
          version={4}
          handEdits={1}
          editable
          window={{ from: '2027-01-04', to: '2027-04-11' }}
          gaps={[]}
          units={UNITS}
          unitParam="unit-a"
          weekParam={null}
          onChange={() => undefined}
          onDraftChanged={() => undefined}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText(/· edited/)).toBeInTheDocument();
  });

  it('is read-only once the plan is committed', async () => {
    renderEditable(false);

    expect(
      await screen.findByText(
        'This plan is committed. Shifts are changed on the planning board by a supervisor.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /for .+ on \d{4}-\d{2}-\d{2}/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/hand edits so far/)).not.toBeInTheDocument();
  });
});

describe('the quarter plan navigation and draft warnings (A6, A8)', () => {
  it('lists all 14 weeks with their gaps and jumps to the one picked', async () => {
    const user = userEvent.setup();
    const changes: { unit?: string; week?: string }[] = [];
    vi.spyOn(api, 'getPlannerSchedule').mockImplementation(async (_draftId, query) => plannerSchedule(query));
    vi.spyOn(api, 'getPlannerCoverage').mockResolvedValue([]);
    render(
      <ThemeProvider theme={theme}>
        <PlannerRosterTab
          draftId="draft-1"
          window={{ from: '2027-01-04', to: '2027-04-11' }}
          gaps={GAPS}
          units={UNITS}
          unitParam="unit-a"
          weekParam={null}
          onChange={(next) => changes.push(next)}
        />
      </ThemeProvider>,
    );

    const picker = await screen.findByLabelText('Go to week');
    const weeks = within(picker).getAllByRole('option').map((option) => option.textContent);
    expect(weeks).toHaveLength(14);
    expect(weeks[0]).toBe('Week 1 · 4 – 10 Jan 2027 · 3 gaps in all units');
    expect(weeks[1]).toBe('Week 2 · 11 – 17 Jan 2027 · 1 gap in all units');
    expect(weeks[12]).toBe('Week 13 · 29 Mar – 4 Apr 2027 · no gaps in all units');
    expect(weeks[13]).toBe('Week 14 · 5 – 11 Apr 2027 · no gaps in all units');

    await user.selectOptions(picker, '2027-03-08');
    expect(changes).toContainEqual({ week: '2027-03-08' });
  });

  it('marks a chip named in the draft warnings with a ⚠ and the message as its tooltip', async () => {
    const base = plannerSchedule({ unitId: 'unit-a', from: '2027-01-04', to: '2027-01-10' });
    const officer = base.officers[0];
    officer.cells = base.days.map((date, index) => ({
      date,
      items:
        index === 2
          ? [
              {
                type: 'SHIFT' as const,
                assignmentId: 'w1',
                shiftTemplate: 'D8',
                startAt: `${date}T07:00:00-06:00`,
                endAt: `${date}T15:00:00-06:00`,
                kind: 'ROSTERED' as const,
                worked: false,
                version: 1,
              },
            ]
          : [],
    }));
    const cell = officer.cells[2];
    const template = 'D8 07:00–15:00';
    vi.spyOn(api, 'getPlannerSchedule').mockResolvedValue(base);
    vi.spyOn(api, 'getPlannerCoverage').mockResolvedValue([]);
    render(
      <ThemeProvider theme={theme}>
        <PlannerRosterTab
          draftId="draft-1"
          window={{ from: '2027-01-04', to: '2027-04-11' }}
          gaps={[]}
          units={UNITS}
          unitParam="unit-a"
          weekParam={null}
          onChange={() => undefined}
          warnings={[
            {
              ruleName: 'Week over 48 hours',
              count: 1,
              items: [
                { unitCode: 'A', date: cell.date, employeeName: officer.name, shift: template, message: '56 hours this week' },
                // Another officer's warning on a day nobody here works marks nothing.
                { unitCode: 'A', date: '2027-01-05', employeeName: 'Nobody Here', shift: 'D8', message: 'x' },
              ],
            },
          ]}
        />
      </ThemeProvider>,
    );

    const marker = await screen.findByRole('img', {
      name: 'Rule warning: Week over 48 hours: 56 hours this week',
    });
    // The marker takes focus and its tooltip opens on focus, for keyboard users.
    marker.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Week over 48 hours: 56 hours this week');
    expect(marker.closest('td')).toHaveAttribute('data-date', cell.date);
    expect(marker.closest('td')).toHaveAttribute('data-officer-id', officer.employeeId);
    expect(screen.getAllByRole('img', { name: /^Rule warning/ })).toHaveLength(1);
  });
});
