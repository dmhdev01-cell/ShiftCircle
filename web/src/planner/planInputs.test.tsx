import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import { PLAN_INPUTS_120 } from '../api/fixtures/planInputs';
import type { PlanInputs } from '../api/types';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { PlanInputsCard } from './PlanInputsCard';
import {
  changedSince,
  inputsHeadline,
  optionsLine,
  optionWords,
  peopleWords,
  shiftsWords,
} from './planInputsWords';

function inputs(overrides: Partial<PlanInputs['officers']> = {}): PlanInputs {
  const copy = JSON.parse(JSON.stringify(PLAN_INPUTS_120)) as PlanInputs;
  copy.officers = { ...copy.officers, ...overrides };
  return copy;
}


/**
 * Dataset 120 since release v1.3: the 120 officers plus 10 full-time supervisors on two posts,
 * in the api's shape (byPosition, lineUnits, posts, and a post row per supervisor post).
 */
function withSupervisors(base: PlanInputs = inputs()): PlanInputs {
  const copy = JSON.parse(JSON.stringify(base)) as PlanInputs;
  const officers = copy.officers;
  copy.officers = {
    ...officers,
    total: officers.total + 10,
    fullTime: officers.fullTime + 10,
    fte: officers.fte + 10,
    units: officers.units + 2,
    lineUnits: officers.units,
    posts: 2,
    byPosition: [
      { position: 'CO', supervisory: false, total: officers.total, fullTime: officers.fullTime, partTime: officers.partTime, fte: officers.fte },
      { position: 'CS', supervisory: true, total: 10, fullTime: 10, partTime: 0, fte: 10 },
    ],
  };
  copy.units = copy.units.map((unit) => ({ ...unit, kind: 'LINE', supervision: false, supervisors: 0 }));
  for (const [code, name] of [
    ['SUP-L', 'Supervision · Living units'],
    ['SUP-O', 'Supervision · Operations'],
  ]) {
    copy.units.push({
      code,
      name,
      allows12h: true,
      kind: 'SUPERVISION',
      supervision: true,
      officers: 0,
      supervisors: 5,
      fullTime: 5,
      partTime: 0,
      fte: 5,
      minimums: { NIGHT: 1, DAY: 1, EVENING: 1 },
      closedDays: 0,
      groups: [
        { position: 'CS', employment: 'FULL_TIME', hours: 12, pattern: 'D12', patternWords: '12 h day crew, 4 on, 4 off', officers: 2, fte: 2 },
        { position: 'CS', employment: 'FULL_TIME', hours: 12, pattern: 'N12', patternWords: '12 h night crew, 4 on, 4 off', officers: 2, fte: 2 },
        { position: 'CS', employment: 'FULL_TIME', hours: 12, pattern: 'N12_RELIEF', patternWords: '12 h night relief', officers: 1, fte: 1 },
      ],
    });
  }
  return copy;
}

function renderCard(props: Parameters<typeof PlanInputsCard>[0]) {
  return render(
    <ThemeProvider theme={theme}>
      <PlanInputsCard {...props} />
    </ThemeProvider>,
  );
}

describe('plan inputs words', () => {
  it('says how many officers, which kind, the FTE and the window in one line', () => {
    expect(inputsHeadline(inputs({ total: 150, fullTime: 120, partTime: 30, fte: 138, neededFte: 127 }))).toBe(
      'Planning 150 officers in 6 units · 120 full-time, 30 part-time or casual · 138 FTE against about 127 needed · 4 Jan – 11 Apr 2027',
    );
  });

  it('names the busiest stretch when a closure splits the quarter, never passing it off as the quarter', () => {
    expect(
      inputsHeadline(
        inputs({ neededFte: 123, neededFrom: '2027-01-04', neededTo: '2027-02-14', neededPeriods: 2 }),
      ),
    ).toContain(
      '112 FTE against about 123 needed for the stretch that needs the most (4 Jan – 14 Feb) · 4 Jan – 11 Apr 2027',
    );
  });

  it('drops the part-time words when everyone is full-time, and the estimate when there is none', () => {
    expect(inputsHeadline(inputs({ total: 100, fullTime: 100, partTime: 0, fte: 100, neededFte: null }))).toBe(
      'Planning 100 officers in 6 units · all 100 full-time · 100 FTE · 4 Jan – 11 Apr 2027',
    );
  });

  it('names the seed, the 8 h pattern and the rule set', () => {
    expect(optionsLine(inputs())).toBe('Seed 20261001 · 8 h officers on their own pattern · rule set v3');
    const forced = inputs();
    forced.options = { seed: 7, pattern8h: '7_ON_3_OFF' };
    expect(optionsLine(forced)).toBe('Seed 7 · every 8 h officer on 7 on, 3 off · rule set v3');
    // What Generate will use: the api sends the default seed, and says so.
    expect(optionsLine(inputs(), false)).toMatch(/^Default seed 20261001 · /);
  });

  it('words any option the draft carries, including ones it has never seen', () => {
    const words = optionWords(
      {
        seed: 20261001,
        pattern8h: null,
        staffTypes: ['FULL_TIME'],
        partTimeFill: 'UP_TO_FTE',
        crossUnitFill: 'ON',
        weekendBalance: 'STRICT_EVEN',
      },
      true,
    );
    expect(words.map((option) => `${option.label}: ${option.value}`)).toEqual([
      'Seed: 20261001',
      '8 h pattern: each officer’s own',
      'Staff to include: full-time only',
      'Part-time fill: up to each officer’s FTE',
      'Cover gaps from other units: on',
      'Weekend balance: strict even',
    ]);
  });

  it('names a tailoring option on the summary line only when it is not the default (PR-N)', () => {
    const base = inputs();
    const withDefaults = {
      ...base,
      options: { ...base.options, staffTypes: ['FULL_TIME', 'PART_TIME'], partTimeFill: 'AFTER_FULL_TIME', crossUnitFill: 'OFF' },
    };
    expect(optionsLine(withDefaults)).toBe(optionsLine(base));
    const changed = { ...withDefaults, options: { ...withDefaults.options, crossUnitFill: 'ON', partTimeFill: 'UP_TO_FTE' } };
    expect(optionsLine(changed)).toBe(
      'Seed 20261001 · 8 h officers on their own pattern · part-time fill: up to each officer’s FTE · cover gaps from other units: on · rule set v3',
    );
  });

  it('counts only the staff a full-time-only draft plans with (PR-N)', () => {
    const base = inputs();
    const fullTimeOnly = {
      ...base,
      officers: { ...base.officers, partTimeFte: 12 },
      options: { ...base.options, staffTypes: ['FULL_TIME'] },
    };
    expect(inputsHeadline(fullTimeOnly)).toMatch(
      /^Planning 100 officers in 6 units · full-time only, 20 part-time or casual left out · 100 FTE/,
    );
    expect(inputsHeadline({ ...base, officers: { ...base.officers, partTimeFte: 12 } })).toMatch(
      /^Planning 120 officers in 6 units · 100 full-time, 20 part-time or casual · 112 FTE/,
    );
  });

  it('splits the headline by rank once there are supervisors (release v1.3 S7)', () => {
    expect(inputsHeadline(withSupervisors())).toBe(
      'Planning 120 officers + 10 supervisors in 6 units + 2 supervisor posts · 110 full-time, 20 part-time or casual · 122 FTE against about 127 needed · 4 Jan – 11 Apr 2027',
    );
    // A full-time-only draft counts the full-time people of each rank.
    const fullTimeOnly = withSupervisors();
    fullTimeOnly.options = { ...fullTimeOnly.options, staffTypes: ['FULL_TIME'] };
    expect(inputsHeadline(fullTimeOnly)).toMatch(
      /^Planning 100 officers \+ 10 supervisors in 6 units \+ 2 supervisor posts · full-time only, 20 part-time or casual left out/,
    );
  });

  it('words people and shifts with the rank split only when there are supervisors', () => {
    expect(peopleWords(107, 10)).toBe('107 officers and 10 supervisors');
    expect(peopleWords(107, 0)).toBe('107 officers');
    expect(peopleWords(1)).toBe('1 officer');
    expect(shiftsWords(5595, 5103, 492)).toBe('5,595 shifts (5,103 officer + 492 supervisor)');
    expect(shiftsWords(5103, 5103, 0)).toBe('5,103 shifts');
    expect(shiftsWords(5103)).toBe('5,103 shifts');
  });

  it('reports what changed since a draft was generated, or nothing', () => {
    expect(changedSince(inputs(), inputs())).toBeNull();
    expect(changedSince(inputs(), inputs({ partTime: 21, fullTime: 99, fte: 111.5 }))).toBe(
      '99 full-time (was 100), 21 part-time or casual (was 20), 111.5 FTE (was 112)',
    );
  });
});

describe('the plan inputs card', () => {
  it('shows the headline, then the detail on request', async () => {
    const user = userEvent.setup();
    renderCard({ inputs: inputs(), fromDraft: false });

    expect(screen.getByText('Plan inputs · what Generate will use')).toBeInTheDocument();
    expect(screen.getByTestId('plan-inputs-headline')).toHaveTextContent(
      'Planning 120 officers in 6 units · 100 full-time, 20 part-time or casual · 112 FTE against about 127 needed',
    );
    expect(screen.queryByRole('region', { name: 'Plan inputs detail' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Show plan inputs' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide plan inputs' })).toHaveAttribute('aria-expanded', 'true');

    const detail = screen.getByRole('region', { name: 'Plan inputs detail' });
    // Officers by unit x employment x pattern, with the unit minimums.
    const unitA = within(detail).getByRole('row', { name: /Unit A · Living unit/ });
    expect(unitA).toHaveTextContent('11 full-time, 12 h day crew, 4 on, 4 off');
    expect(unitA).toHaveTextContent('2 part-time or casual, 12 h relief pool, no fixed rotation');
    expect(unitA).toHaveTextContent('4 · 5 · 5');
    // Preferences, with 16 h shown as not rostered.
    expect(within(detail).getByText('· 16 h shifts (not rostered)')).toBeInTheDocument();
    // The fill order, in the generator's words, as an ordered list.
    const steps = within(detail).getAllByRole('listitem').filter((item) => item.closest('ol'));
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveTextContent(/full-time officers whose rotation has them on that day fill the unit's minimum/);
    expect(steps[2]).toHaveTextContent(/Part-time and casual officers \(under 1.0 FTE\)/);
    // No closures in the dataset: no closed-days column.
    expect(within(detail).queryByRole('columnheader', { name: 'Closed days' })).not.toBeInTheDocument();
  });

  it('lists the supervisor posts in their own table, below the officer units (release v1.3 S7)', async () => {
    const user = userEvent.setup();
    renderCard({ inputs: withSupervisors(), fromDraft: false });
    await user.click(screen.getByRole('button', { name: 'Show plan inputs' }));

    const detail = screen.getByRole('region', { name: 'Plan inputs detail' });
    const headings = within(detail).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 2)).toEqual(['Officers by unit', 'Supervisors by post']);
    const tables = within(detail).getAllByRole('table');
    expect(within(tables[0]).queryByRole('row', { name: /Supervision/ })).not.toBeInTheDocument();
    const living = within(tables[1]).getByRole('row', { name: /Supervision · Living units/ });
    expect(living).toHaveTextContent('2 full-time, 12 h day crew, 4 on, 4 off');
    expect(living).toHaveTextContent('1 · 1 · 1');
    expect(within(tables[1]).getByRole('columnheader', { name: 'Post' })).toBeInTheDocument();
    expect(screen.getByText(/staff have preferences on file/)).toBeInTheDocument();
    expect(within(detail).getByText('Staff with leave')).toBeInTheDocument();
  });

  it('labels a draft snapshot and warns when the staff have changed since', () => {
    renderCard({ inputs: inputs(), live: inputs({ total: 121, partTime: 21, fte: 112.5 }), fromDraft: true });

    expect(screen.getByText('Plan inputs · what this draft was generated with')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'The plan\'s inputs have changed since this draft was generated: now 121 officers (was 120), 21 part-time or casual (was 20), 112.5 FTE (was 112). Generate again to plan with them.',
    );
  });

  it('heads a draft from before v1.2 as today’s inputs, not the draft’s', () => {
    renderCard({ inputs: inputs(), live: inputs(), fromDraft: false, draftWithoutRecord: true });
    expect(
      screen.getByText('Plan inputs · what Generate would use now (this draft kept no record of its own)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says nothing about changes when the staff are the same', () => {
    renderCard({ inputs: inputs(), live: inputs(), fromDraft: true });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('plan inputs on the quarter plan', () => {
  function renderPlanner() {
    return render(
      <ThemeProvider theme={theme}>
        <RoleProvider>
          <MemoryRouter initialEntries={['/planner']}>
            <AppShellRoutes />
          </MemoryRouter>
        </RoleProvider>
      </ThemeProvider>,
    );
  }

  it('shows what Generate will use before any draft, then the draft’s own snapshot', async () => {
    const user = userEvent.setup();
    const live = vi.spyOn(api, 'getPlannerInputs');
    renderPlanner();
    await user.selectOptions(await screen.findByLabelText('Mock sign-in: choose a role'), 'PLANNER');

    expect(await screen.findByText('No plan for this quarter yet.')).toBeInTheDocument();
    expect(await screen.findByText('Plan inputs · what Generate will use')).toBeInTheDocument();
    expect(screen.getByTestId('plan-inputs-headline')).toHaveTextContent(/^Planning 120 officers in 6 units/);
    // Fetched once on mount, not once per load (re-check nit 1).
    expect(live).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByText('Coverage gaps')).toBeInTheDocument();
    expect(screen.getByText('Plan inputs · what this draft was generated with')).toBeInTheDocument();
    expect(screen.getByText(/^Seed 20261001 · 8 h officers on their own pattern · rule set v3/)).toBeInTheDocument();
    // The inputs sit above the scorecard tabs.
    const headline = screen.getByTestId('plan-inputs-headline');
    const tablist = screen.getByRole('tablist', { name: 'Quarter plan' });
    expect(headline.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('fires no planner request for another role', async () => {
    const calls = [
      vi.spyOn(api, 'getPlannerInputs'),
      vi.spyOn(api, 'getPlannerPlan'),
      vi.spyOn(api, 'getStaffing'),
      vi.spyOn(api, 'getFlaggedShifts'),
    ];
    renderPlanner();
    expect(await screen.findByText(/may not plan the quarter/)).toBeInTheDocument();
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
