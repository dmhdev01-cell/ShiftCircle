import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api, ApiError } from '../api/client';
import type {
  OfficerRow,
  PlannerAssignmentResult,
  RuleCheckOutcome,
  ShiftItem,
} from '../api/types';
import { theme } from '../theme/theme';
import { DraftShiftDialog } from './DraftShiftDialog';

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

const ITEM: ShiftItem = {
  type: 'SHIFT',
  assignmentId: 'a1',
  shiftTemplate: 'D8',
  startAt: '2027-01-05T07:00:00-06:00',
  endAt: '2027-01-05T15:00:00-06:00',
  kind: 'ROSTERED',
  worked: false,
  version: 3,
  edited: false,
};

const UNITS = [
  { id: 'u-a', name: 'Unit A · Living unit', closedFrom: null, closedTo: null },
  { id: 'u-b', name: 'Unit B · Living unit', closedFrom: '2027-02-15', closedTo: null },
];

const OFFICERS = [
  { employeeId: 'e1', name: 'Nia Thompson', unitName: 'Unit A · Living unit' },
  { employeeId: 'e2', name: 'Sam Abara', unitName: 'Control' },
];

const SAVED = {
  draftId: 'draft-1',
  assignmentId: 'a1',
  version: 4,
  handEdits: 1,
  editedAssignmentIds: ['a1'],
  scorecard: {},
  warnings: [],
  warningCount: 0,
  gaps: [],
} as unknown as PlannerAssignmentResult;

function pass(): RuleCheckOutcome {
  return { outcome: 'PASS', ruleSetVersion: 3, overridable: false, ruleResults: [] };
}

function warn(): RuleCheckOutcome {
  return {
    outcome: 'WARN',
    ruleSetVersion: 3,
    overridable: false,
    ruleResults: [
      {
        ruleCode: 'U-14',
        ruleTable: 'HOURS',
        outcome: 'WARN',
        message: 'The officer is above the 48-hour warning level.',
        overridePolicy: 'ACKNOWLEDGE',
      },
    ],
  };
}

function block(): RuleCheckOutcome {
  return {
    outcome: 'BLOCK',
    ruleSetVersion: 3,
    overridable: false,
    ruleResults: [
      {
        ruleCode: 'U-01',
        ruleTable: 'REST',
        outcome: 'BLOCK',
        message: 'The officer has less than 8 hours rest before this shift.',
        overridePolicy: 'NONE',
      },
    ],
  };
}

function renderDialog(onSaved = vi.fn(), onReload = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <DraftShiftDialog
        draftId="draft-1"
        version={3}
        officer={OFFICER}
        item={ITEM}
        unit={{ id: 'u-a', name: 'Unit A · Living unit' }}
        units={UNITS}
        officers={OFFICERS}
        onClose={() => undefined}
        onSaved={onSaved}
        onReload={onReload}
      />
    </ThemeProvider>,
  );
  return { onSaved, onReload };
}

describe('the draft shift dialog', () => {
  it('checks and saves a pass, then hands the recomputed draft back', async () => {
    const user = userEvent.setup();
    const preview = vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(pass());
    const save = vi.spyOn(api, 'updatePlannerAssignment').mockResolvedValue(SAVED);
    const { onSaved } = renderDialog();

    expect(screen.getByRole('heading', { name: /Nia Thompson/ })).toBeInTheDocument();
    expect(
      screen.getByText('Change this shift in the draft. Nothing reaches the planning board until you commit.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change time or unit…' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(preview).toHaveBeenCalledWith('draft-1', {
      assignmentId: 'a1',
      employeeId: 'e1',
      unitId: 'u-a',
      shiftTemplate: 'D8',
      startAt: '2027-01-05T07:00:00-06:00',
      kind: 'ROSTERED',
    });
    expect(save).toHaveBeenCalledWith('draft-1', 'a1', 3, {
      employeeId: 'e1',
      unitId: 'u-a',
      shiftTemplate: 'D8',
      startAt: '2027-01-05T07:00:00-06:00',
      kind: 'ROSTERED',
    });
    expect(onSaved).toHaveBeenCalledWith(SAVED, expect.stringContaining('Draft changed: Nia Thompson'));
  });

  it('shows warnings, saves nothing, then keeps the change with the acknowledgement', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(warn());
    const save = vi.spyOn(api, 'updatePlannerAssignment').mockResolvedValue(SAVED);
    const { onSaved } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Change time or unit…' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/U-14/)).toBeInTheDocument();
    expect(screen.getByText(/above the 48-hour warning level/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep the change with these warnings' }));

    expect(save).toHaveBeenCalledWith(
      'draft-1',
      'a1',
      3,
      expect.objectContaining({ acknowledgeWarnings: true }),
    );
    expect(onSaved).toHaveBeenCalledWith(SAVED, expect.any(String));
  });

  it('refuses a block and saves nothing', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(block());
    const save = vi.spyOn(api, 'updatePlannerAssignment');
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Change time or unit…' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/U-01/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "This change breaks a Block rule, so it can't go in the draft. Choose another officer or time, or leave the gap.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Keep the change with these warnings' }),
    ).not.toBeInTheDocument();
  });

  it('gives the shift to another officer as a one-way move', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(pass());
    const save = vi.spyOn(api, 'updatePlannerAssignment').mockResolvedValue({
      ...SAVED,
      editedAssignmentIds: ['a1'],
    });
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Give to another officer…' }));
    const select = screen.getByLabelText('Officer');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Nia Thompson · Unit A · Living unit',
      'Sam Abara · Control',
    ]);
    await user.selectOptions(select, 'e2');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(save).toHaveBeenCalledWith(
      'draft-1',
      'a1',
      3,
      expect.objectContaining({ employeeId: 'e2', unitId: 'u-a', kind: 'ROSTERED' }),
    );
  });

  it('removes a shift without asking for a reason', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(api, 'removePlannerAssignment').mockResolvedValue(SAVED);
    const { onSaved } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Remove from draft…' }));
    expect(
      screen.getByText('Remove this shift from the draft? The block may become a gap; the scorecard will show it.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove shift' }));

    expect(remove).toHaveBeenCalledWith('draft-1', 'a1', 3);
    expect(onSaved).toHaveBeenCalledWith(SAVED, expect.stringContaining('Removed from the draft'));
  });

  it('shows the api detail verbatim on a 409', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(pass());
    vi.spyOn(api, 'updatePlannerAssignment').mockRejectedValue(
      new ApiError('conflict', 409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Unit B is closed on 15 Feb 2027.',
      }),
    );
    const { onReload } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Change time or unit…' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(screen.getByText('Unit B is closed on 15 Feb 2027.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('never shows raw error text on a generic failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(pass());
    vi.spyOn(api, 'updatePlannerAssignment').mockRejectedValue(
      new ApiError('Internal Server Error', 500, {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
      }),
    );
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Change time or unit…' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(screen.getByText('The change could not be saved.')).toBeInTheDocument();
    expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument();
  });

  it('uses the draft-changed words on a 412 and offers Reload', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewPlannerAssignment').mockResolvedValue(pass());
    vi.spyOn(api, 'updatePlannerAssignment').mockRejectedValue(
      new ApiError('stale', 412, { type: 'about:blank', title: 'Precondition failed', status: 412 }),
    );
    const { onReload } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Change time or unit…' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(
      screen.getByText(
        'The draft changed since you opened it (another tab or a regenerate). Reload the roster and try again.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });
});
