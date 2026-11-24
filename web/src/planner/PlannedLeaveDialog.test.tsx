import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api, ApiError } from '../api/client';
import type { PlannedAbsenceInput, PlannerPlan } from '../api/types';
import { theme } from '../theme/theme';
import { PlannedLeaveDialog } from './PlannedLeaveDialog';
import { leaveDates, leaveProblem, leaveRangeWords, MAX_LEAVE_DAYS } from './plannedLeave';

const OFFICERS = [
  { employeeId: 'e2', name: 'Zoe Park', unitName: 'Unit B · Living unit' },
  { employeeId: 'e1', name: 'Nia Thompson', unitName: 'Unit A · Living unit' },
];

const QUARTER = { from: '2027-01-04', to: '2027-04-11' };

function plan(): PlannerPlan {
  return {
    window: { ...QUARTER, periods: 7 },
    defaultSeed: 20261001,
    patterns8h: null,
    state: 'NONE',
    draft: null,
    lastCommitted: null,
  };
}

function renderDialog(onSaved = vi.fn(), onClose = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <PlannedLeaveDialog officers={OFFICERS} onClose={onClose} onSaved={onSaved} />
    </ThemeProvider>,
  );
  return { onSaved, onClose };
}

function fill(employeeId: string, from: string, to: string) {
  fireEvent.change(screen.getByLabelText('Officer'), { target: { value: employeeId } });
  fireEvent.change(screen.getByLabelText('First day'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('Last day'), { target: { value: to } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('planned leave words and checks', () => {
  it('lists every calendar day of a range, both ends included', () => {
    expect(leaveDates('2027-02-26', '2027-03-02')).toEqual([
      '2027-02-26',
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
      '2027-03-02',
    ]);
    expect(leaveDates('2027-02-08', '2027-02-08')).toEqual(['2027-02-08']);
  });

  it('reads a range in house date words with its day count', () => {
    expect(leaveRangeWords('2027-02-08', '2027-02-14')).toBe('Mon 8 Feb 2027 – Sun 14 Feb 2027 (7 days)');
    expect(leaveRangeWords('2027-02-08', '2027-02-08')).toBe('Mon 8 Feb 2027');
  });

  it('names the first problem: officer, dates, order, quarter, length', () => {
    expect(leaveProblem({ employeeId: '', from: '2027-02-08', to: '2027-02-08' }, QUARTER)).toBe(
      'Choose an officer.',
    );
    expect(leaveProblem({ employeeId: 'e1', from: '', to: '' }, QUARTER)).toMatch(/first and the last day/);
    expect(leaveProblem({ employeeId: 'e1', from: '2027-02-09', to: '2027-02-08' }, QUARTER)).toBe(
      'The last day is before the first day.',
    );
    expect(leaveProblem({ employeeId: 'e1', from: '2027-01-03', to: '2027-01-05' }, QUARTER)).toBe(
      'Leave must be inside the plan quarter (4 Jan 2027 – 11 Apr 2027).',
    );
    expect(leaveProblem({ employeeId: 'e1', from: '2027-02-01', to: '2027-03-15' }, QUARTER)).toBe(
      `Enter at most ${MAX_LEAVE_DAYS} days at a time.`,
    );
    expect(leaveProblem({ employeeId: 'e1', from: '2027-02-01', to: '2027-03-03' }, QUARTER)).toBeNull();
    expect(leaveProblem({ employeeId: 'e1', from: '2027-04-11', to: '2027-04-11' }, QUARTER)).toBeNull();
  });
});

describe('PlannedLeaveDialog', () => {
  it('posts one absence per day, in order, with the chosen type, then reports it', async () => {
    vi.spyOn(api, 'getPlannerPlan').mockResolvedValue(plan());
    const posted: PlannedAbsenceInput[] = [];
    vi.spyOn(api, 'planAbsence').mockImplementation(async (input) => {
      posted.push(input);
      return { ...input, id: `a-${posted.length}` };
    });
    const { onSaved } = renderDialog();
    expect(await screen.findByText(/Plan quarter: 4 Jan 2027 – 11 Apr 2027/)).toBeInTheDocument();

    fill('e1', '2027-02-08', '2027-02-10');
    await userEvent.click(screen.getByRole('radio', { name: 'Sick' }));
    expect(screen.getByText('Sick for Nia Thompson: Mon 8 Feb 2027 – Wed 10 Feb 2027 (3 days)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save leave' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(posted).toEqual([
      { employeeId: 'e1', date: '2027-02-08', type: 'SICK' },
      { employeeId: 'e1', date: '2027-02-09', type: 'SICK' },
      { employeeId: 'e1', date: '2027-02-10', type: 'SICK' },
    ]);
    expect(onSaved.mock.calls[0][0]).toContain('Sick recorded for Nia Thompson');
    expect(onSaved.mock.calls[0][0]).toContain('audit log');
  });

  it('lists officers by name with their unit, and records no reason', async () => {
    vi.spyOn(api, 'getPlannerPlan').mockResolvedValue(plan());
    renderDialog();
    const options = Array.from((screen.getByLabelText('Officer') as HTMLSelectElement).options).map(
      (option) => option.textContent,
    );
    expect(options).toEqual([
      'Choose an officer',
      'Nia Thompson · Unit A · Living unit',
      'Zoe Park · Unit B · Living unit',
    ]);
    expect(screen.getByText(/no reason or medical detail is recorded/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Vacation' })).toBeChecked();
  });

  it('refuses to save until the form is valid, and never calls the api', async () => {
    vi.spyOn(api, 'getPlannerPlan').mockResolvedValue(plan());
    const post = vi.spyOn(api, 'planAbsence');
    renderDialog();
    await screen.findByText(/Plan quarter/);
    await userEvent.click(screen.getByRole('button', { name: 'Save leave' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an officer.');

    fill('e1', '2027-04-10', '2027-04-12');
    await userEvent.click(screen.getByRole('button', { name: 'Save leave' }));
    expect(screen.getByRole('alert')).toHaveTextContent('inside the plan quarter');
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps going past a day already recorded as another type and lists it', async () => {
    vi.spyOn(api, 'getPlannerPlan').mockResolvedValue(plan());
    vi.spyOn(api, 'planAbsence').mockImplementation(async (input) => {
      if (input.date === '2027-02-09') {
        throw new ApiError('An absence of type SICK is already recorded for that date; reset or correct it first', 409);
      }
      return { ...input, id: input.date };
    });
    const { onSaved } = renderDialog();
    await screen.findByText(/Plan quarter/);
    fill('e2', '2027-02-08', '2027-02-10');
    await userEvent.click(screen.getByRole('button', { name: 'Save leave' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Saved 2 of 3 days.');
    expect(alert).toHaveTextContent('Tue 9 Feb 2027: An absence of type SICK is already recorded');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('stops on a server failure and says how many days were saved', async () => {
    vi.spyOn(api, 'getPlannerPlan').mockResolvedValue(plan());
    let calls = 0;
    vi.spyOn(api, 'planAbsence').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 2) throw new ApiError('The server could not be reached.', 0);
      return { ...input, id: input.date };
    });
    renderDialog();
    await screen.findByText(/Plan quarter/);
    fill('e1', '2027-02-08', '2027-02-12');
    await userEvent.click(screen.getByRole('button', { name: 'Save leave' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('1 of 5 days were saved before it stopped.');
    expect(calls).toBe(2);
  });
});
