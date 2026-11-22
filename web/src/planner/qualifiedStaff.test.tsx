import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { PlannerScorecard } from '../api/types';
import { QualifiedStaffCard } from './QualifiedStaffCard';

type Qualification = NonNullable<PlannerScorecard['qualification']>;

const WORDS = {
  failing: '346 block-days are below the qualified minimum. The planner does not enforce this.',
  one: '1 block-day is below the qualified minimum. The planner does not enforce this.',
  none: 'No block-day is below the qualified minimum in this draft. The planner does not enforce this, so a new draft can change it.',
  notChecked:
    'Qualification start dates are not checked: an officer with a qualification counts as qualified for the whole quarter.',
};

function qualification(overrides: Partial<Qualification> = {}): Qualification {
  return {
    failingBlockDays: 346,
    checkedBlockDays: 1470,
    passes: false,
    byUnitBlock: [
      { unitCode: 'A', unitName: 'Unit A · Living unit', block: 'NIGHT', qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 98, checkedBlockDays: 98 },
      { unitCode: 'A', unitName: 'Unit A · Living unit', block: 'EVENING', qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 1, checkedBlockDays: 98 },
      { unitCode: 'B', unitName: 'Unit B · Living unit', block: 'DAY', qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
      { unitCode: 'CTL', unitName: 'Control', block: 'DAY', qualification: 'CONTROL', minimum: 3, failingBlockDays: 1, checkedBlockDays: 98 },
      { unitCode: 'ESC', unitName: 'Escort & transport', block: 'EVENING', qualification: 'ESCORT', minimum: 4, failingBlockDays: 0, checkedBlockDays: 98 },
    ],
    validFromRespected: false,
    validFromNote: WORDS.notChecked,
    sentence: WORDS.failing,
    ...overrides,
  };
}

/** A sentence split by a bold figure or by expressions; compare its whole text. */
function expectText(text: string) {
  expect(
    screen.getByText((_, element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim() === text),
  ).toBeInTheDocument();
}

function renderCard(value: Qualification) {
  return render(<QualifiedStaffCard qualification={value} from="2027-01-04" to="2027-04-11" />);
}

describe('the qualified staff card', () => {
  it('states the api sentence, the failing rows in block order and the blocks that met', () => {
    renderCard(qualification());

    expect(screen.getByRole('heading', { name: 'Qualified staff by unit', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Below minimum')).toBeInTheDocument();
    expectText(WORDS.failing);

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Unit',
      'Block',
      'Needs at least',
      'Block-days below',
    ]);
    expect(within(table).getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['Unit A · Living unit', 'Evening', '1 First aid', '1'],
      ['Unit A · Living unit', 'Night', '1 First aid', '98'],
      ['Control', 'Day', '3 Control', '1'],
    ]);

    expect(
      screen.getByText('The other 2 unit blocks met their minimum every day.'),
    ).toBeInTheDocument();
    // The footnote carries the quarter and the api's valid_from sentence, always.
    expectText(
      `Checked every day from 4 Jan to 11 Apr 2027: an officer counts when their shift overlaps the block in that unit. ${WORDS.notChecked}`,
    );
  });

  it('renders a single failing block-day in the api words, with no "other" line', () => {
    renderCard(
      qualification({
        failingBlockDays: 1,
        checkedBlockDays: 1470,
        sentence: WORDS.one,
        byUnitBlock: [
          { unitCode: 'CTL', unitName: 'Control', block: 'DAY', qualification: 'CONTROL', minimum: 3, failingBlockDays: 1, checkedBlockDays: 98 },
        ],
      }),
    );

    expectText(WORDS.one);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(/^The other /)).not.toBeInTheDocument();
    expect(screen.getByText('Below minimum')).toBeInTheDocument();
    expect(screen.getByText(/Qualification start dates are not checked/)).toBeInTheDocument();
  });

  it('says all met with no table when nothing fails', () => {
    renderCard(
      qualification({
        failingBlockDays: 0,
        passes: true,
        sentence: WORDS.none,
        byUnitBlock: [
          { unitCode: 'A', unitName: 'Unit A · Living unit', block: 'NIGHT', qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
          { unitCode: 'B', unitName: 'Unit B · Living unit', block: 'DAY', qualification: 'FIRST_AID', minimum: 1, failingBlockDays: 0, checkedBlockDays: 98 },
        ],
      }),
    );

    expect(screen.getByText('All met')).toBeInTheDocument();
    expectText(WORDS.none);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/^The other /)).not.toBeInTheDocument();
    expectText(
      `Checked every day from 4 Jan to 11 Apr 2027: an officer counts when their shift overlaps the block in that unit. ${WORDS.notChecked}`,
    );
  });

  it('keeps the start year when the checked window crosses a year', () => {
    render(
      <QualifiedStaffCard
        qualification={qualification()}
        from="2026-11-04"
        to="2027-02-11"
      />,
    );

    expectText(
      `Checked every day from 4 Nov 2026 to 11 Feb 2027: an officer counts when their shift overlaps the block in that unit. ${WORDS.notChecked}`,
    );
  });

  it('renders the api start-date sentence as sent when it is read', () => {
    renderCard(
      qualification({
        validFromRespected: true,
        validFromNote: 'Qualification start dates are checked.',
      }),
    );

    expect(
      screen.getByText(/Qualification start dates are checked\.$/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/are not checked/)).not.toBeInTheDocument();
  });
});
