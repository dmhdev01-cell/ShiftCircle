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
      'Unit A · Living unit · 1 gap',
      'Unit B · Living unit · no gaps',
      'Control · 2 gaps',
    ]);
  });

  it('counts the week it is showing, not another one', async () => {
    renderTab('unit-b', '2027-01-11');

    expect(await screen.findByRole('heading', { name: 'Unit B · Living unit' })).toBeInTheDocument();
    expect(options()).toEqual([
      'Unit A · Living unit · no gaps',
      'Unit B · Living unit · 1 gap',
      'Control · no gaps',
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
    await user.click(within(strip).getByRole('button', { name: 'Unit A · Living unit' }));
    expect(changes).toContainEqual({ unit: 'unit-a' });
  });
});
