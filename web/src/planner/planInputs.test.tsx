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
import { changedSince, inputsHeadline, optionsLine } from './planInputsWords';

function inputs(overrides: Partial<PlanInputs['officers']> = {}): PlanInputs {
  const copy = JSON.parse(JSON.stringify(PLAN_INPUTS_120)) as PlanInputs;
  copy.officers = { ...copy.officers, ...overrides };
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
    expect(inputsHeadline(inputs({ total: 150, fullTime: 120, partTime: 30, fte: 138, neededFte: 123 }))).toBe(
      'Planning 150 officers in 6 units · 120 full-time, 30 part-time or casual · 138 FTE against about 123 needed · 4 Jan – 11 Apr 2027',
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

  it('labels a draft snapshot and warns when the staff have changed since', () => {
    renderCard({ inputs: inputs(), live: inputs({ total: 121, partTime: 21, fte: 112.5 }), fromDraft: true });

    expect(screen.getByText('Plan inputs · what this draft was generated with')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Staff have changed since this draft was generated: now 121 officers (was 120), 21 part-time or casual (was 20), 112.5 FTE (was 112). Generate again to plan with them.',
    );
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
    expect(live).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByText('Coverage gaps')).toBeInTheDocument();
    expect(screen.getByText('Plan inputs · what this draft was generated with')).toBeInTheDocument();
    expect(screen.getByText(/^Seed 20261001 · 8 h officers on their own pattern · rule set v3/)).toBeInTheDocument();
    // The inputs sit above the scorecard tabs.
    const headline = screen.getByTestId('plan-inputs-headline');
    const tablist = screen.getByRole('tablist', { name: 'Quarter plan' });
    expect(headline.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
