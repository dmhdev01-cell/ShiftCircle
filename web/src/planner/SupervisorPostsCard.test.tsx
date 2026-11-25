import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import type { PlannerSupervisorsCard, PlannerTotals } from '../api/types';
import { theme } from '../theme/theme';
import { SupervisorPostsCard } from './SupervisorPostsCard';

/** Dataset 150's supervisor card and totals, in the api's shape (release v1.3). */
const CARD: PlannerSupervisorsCard = {
  supervisors: 12,
  posts: 2,
  coverage: { coveredBlockDays: 495, shortBlockDays: 93, totalBlockDays: 588 },
  shifts: 463,
  warnings: { total: 2, byRule: [] },
  preferences: { asked: 4, met: 3 },
  overtime: { officersOver: 8, hoursOver: 96, thresholdHours: 80 },
  absences: { officers: 11, days: 140, coveredByRelief: 40, uncovered: 100 },
  line: 'Supervisor posts covered 495 of 588 block-days; 93 short.',
};

const TOTALS: PlannerTotals = {
  shifts: 5877,
  officerShifts: 5414,
  supervisorShifts: 463,
  people: 158,
  officers: 146,
  supervisors: 12,
  warnings: 41,
  lineUnitWarnings: 39,
  postWarnings: 2,
  line: '5,414 officer + 463 supervisor shifts',
};

function renderCard(totals?: PlannerTotals) {
  return render(
    <ThemeProvider theme={theme}>
      <SupervisorPostsCard card={CARD} totals={totals} />
    </ThemeProvider>,
  );
}

describe('the scorecard supervisor card (release v1.3 S7)', () => {
  it('gives the posts their own figures, beside the officer cards', () => {
    renderCard(TOTALS);
    const card = screen.getByRole('region', { name: 'Supervisor posts' });
    expect(within(card).getByText('Supervisor posts covered 495 of 588 block-days; 93 short.')).toBeInTheDocument();
    expect(within(card).getByText('495 of 588')).toBeInTheDocument();
    expect(within(card).getByText('block-days; 93 short')).toBeInTheDocument();
    expect(within(card).getByText('on 2 posts · 463 shifts on the posts')).toBeInTheDocument();
    expect(within(card).getByText('75%')).toBeInTheDocument();
    expect(within(card).getByText('8 supervisors over 80 h in a pay period')).toBeInTheDocument();
    expect(within(card).getByText('Supervisor leave')).toBeInTheDocument();
    // Its own labels, so the officer tiles above stay the only "Rule warnings" and "Preferences met".
    for (const label of ['Rule warnings', 'Preferences met', 'Overtime built in']) {
      expect(within(card).queryByText(label, { exact: true })).not.toBeInTheDocument();
    }
  });

  it('says the other cards are the officers only, and gives everyone with the split', () => {
    renderCard(TOTALS);
    expect(
      screen.getByText(
        'The cards above count the officers and the officer units only. Everyone in this draft: 5,414 officer + 463 supervisor shifts, 146 officers and 12 supervisors.',
      ),
    ).toBeInTheDocument();
  });

  it('still reads without the totals', () => {
    renderCard();
    expect(screen.getByText('The cards above count the officers and the officer units only.')).toBeInTheDocument();
  });
});
