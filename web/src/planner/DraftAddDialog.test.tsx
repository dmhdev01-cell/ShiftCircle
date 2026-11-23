import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api } from '../api/client';
import type { OfficerRow, PlannerAssignmentResult, RuleCheckOutcome } from '../api/types';
import { theme } from '../theme/theme';
import { DraftAddDialog } from './DraftAddDialog';

const OFFICER: OfficerRow = {
  employeeId: 'e1',
  name: 'Nia Thompson',
  rotation: 'Rotating 5 on, 2 off',
  qualifications: [],
  payPeriodHours: 80,
  payPeriodThreshold: 80,
  overtimeStatus: 'UNDER',
  cells: [],
};

const UNITS = [
  { id: 'u-a', name: 'Unit A · Living unit', closedFrom: null, closedTo: null },
  { id: 'u-b', name: 'Unit B · Living unit', closedFrom: '2027-02-15', closedTo: null },
];

const SAVED = {
  draftId: 'draft-1',
  assignmentId: 'new-1',
  version: 4,
  handEdits: 1,
  editedAssignmentIds: ['new-1'],
  scorecard: {},
  warnings: [],
  warningCount: 0,
  gaps: [],
} as unknown as PlannerAssignmentResult;

function pass(): RuleCheckOutcome {
  return { outcome: 'PASS', ruleSetVersion: 3, overridable: false, ruleResults: [] };
}

const WARN: RuleCheckOutcome = {
  outcome: 'WARN',
  ruleSetVersion: 3,
  overridable: false,
  ruleResults: [
    {
      ruleCode: 'U-16',
      ruleTable: 'SHIFT_TYPES',
      outcome: 'WARN',
      message: 'An 8-hour officer is assigned to a night shift; 8-hour officers work day or evening.',
      overridePolicy: 'ACKNOWLEDGE',
    },
  ],
};

function renderDialog(date = '2027-01-05', onSaved = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <DraftAddDialog
        draftId="draft-1"
        version={3}
        officer={OFFICER}
        date={date}
        defaultUnitId="u-a"
        units={UNITS}
        onClose={() => undefined}
        onSaved={onSaved}
        onReload={() => undefined}
      />
    </ThemeProvider>,
  );
  return onSaved;
}

describe('the add-to-draft dialog', () => {
  it('defaults to the officer unit and adds a rostered shift after a pass', async () => {
    const user = userEvent.setup();
    const preview = vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(pass());
    const save = vi.spyOn(api, 'addPlannerAssignment').mockResolvedValue(SAVED);
    const onSaved = renderDialog();

    expect(
      screen.getByText(/Add a shift for Nia Thompson on/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Unit')).toHaveValue('u-a');
    await user.selectOptions(screen.getByLabelText('Shift'), 'E8');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(preview).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        employeeId: 'e1',
        unitId: 'u-a',
        shiftTemplate: 'E8',
        startAt: '2027-01-05T15:00:00-06:00',
      }),
    );
    expect(preview.mock.calls[0][1]).not.toHaveProperty('assignmentId');
    expect(save).toHaveBeenCalledWith(
      'draft-1',
      3,
      expect.objectContaining({
        employeeId: 'e1',
        unitId: 'u-a',
        shiftTemplate: 'E8',
        startAt: '2027-01-05T15:00:00-06:00',
      }),
    );
    expect(save.mock.calls[0][2]).not.toHaveProperty('kind');
    expect(onSaved).toHaveBeenCalledWith(SAVED, expect.stringContaining('Draft changed'));
  });

  it('shows a Warn and saves only when the planner keeps it', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(WARN);
    const save = vi.spyOn(api, 'addPlannerAssignment').mockResolvedValue(SAVED);
    renderDialog();

    await user.selectOptions(screen.getByLabelText('Shift'), 'N8');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/U-16/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep the change with these warnings' }));

    expect(save).toHaveBeenCalledWith(
      'draft-1',
      3,
      expect.objectContaining({ acknowledgeWarnings: true }),
    );
  });

  it('disables a unit on a day it is closed', async () => {
    renderDialog('2027-02-16');

    const options = screen.getByLabelText('Unit').querySelectorAll('option');
    expect(options[1]).toBeDisabled();
    expect(options[1]?.textContent).toContain('closed from 15 Feb 2027');
  });
});
