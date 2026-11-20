import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api, ApiError } from '../api/client';
import { demoSchedule } from '../api/fixtures/schedule';
import type { RuleOutcome, RuleResult, ShiftItem } from '../api/types';
import { theme } from '../theme/theme';
import { ShiftActionsDialog } from './ShiftActionsDialog';

const officer = demoSchedule.officers.find((entry) => entry.name === 'Nia Thompson')!;

const item: ShiftItem = {
  type: 'SHIFT',
  assignmentId: 'a-nia-22',
  shiftTemplate: 'D8',
  startAt: '2026-11-22T07:00:00-06:00',
  endAt: '2026-11-22T15:00:00-06:00',
  kind: 'ROSTERED',
  worked: false,
  version: 4,
};

function renderDialog() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ShiftActionsDialog
        officer={officer}
        item={item}
        unitId="unit-b"
        onClose={onClose}
        onChanged={onChanged}
      />
    </ThemeProvider>,
  );
  return { onClose, onChanged };
}

describe('the rostered shift dialog', () => {
  it('moves a shift with the row version and the new change', async () => {
    const user = userEvent.setup();
    const moved = vi.spyOn(api, 'moveAssignment').mockResolvedValue({
      id: item.assignmentId,
      status: 'PLANNED',
      version: 5,
    });
    const { onClose, onChanged } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2026-11-21' } });
    await user.click(screen.getByRole('button', { name: 'Move shift' }));

    await waitFor(() =>
      expect(moved).toHaveBeenCalledWith(item.assignmentId, 4, {
        change: {
          type: 'ASSIGN',
          employeeId: officer.employeeId,
          unitId: 'unit-b',
          shiftTemplate: 'D8',
          startAt: '2026-11-21T07:00:00-06:00',
        },
      }),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('needs ten characters before cancelling, then sends the reason', async () => {
    const user = userEvent.setup();
    const cancelled = vi.spyOn(api, 'cancelAssignment').mockResolvedValue({
      id: item.assignmentId,
      status: 'CANCELLED',
      version: 5,
    });
    const { onChanged } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel shift…' }));
    const confirm = screen.getByRole('button', { name: 'Cancel shift' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Why is this shift cancelled?'), 'Short');
    expect(confirm).toBeDisabled();

    await user.type(
      screen.getByLabelText('Why is this shift cancelled?'),
      ' call, no relief',
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(cancelled).toHaveBeenCalledWith(item.assignmentId, 4, 'Short call, no relief'),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('says to reload the board when the version is stale', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'moveAssignment').mockRejectedValue(
      new ApiError('This shift changed. Reload the board.', 412, {
        type: 'https://shiftcircle.local/problems/stale-version',
        title: 'Stale version',
        status: 412,
        detail: 'This shift changed. Reload the board.',
      }),
    );
    const { onClose, onChanged } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));

    expect(await screen.findByText('This shift changed. Reload the board.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload the board' }));
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

/** The api's answer to a change the rules block (docs/07 §3). */
function blockedProblem(results: RuleResult[]): ApiError {
  return new ApiError('This change breaks a rule', 422, {
    type: 'https://shiftcircle.local/problems/blocked-by-rules',
    title: 'This change breaks a rule',
    status: 422,
    outcome: 'BLOCK',
    ruleSetVersion: 7,
    overridable: false,
    ruleResults: results,
  });
}

function rule(
  ruleCode: string,
  outcome: RuleOutcome,
  overridePolicy: 'EMERGENCY' | 'ACKNOWLEDGE' | 'NONE',
  message: string,
): RuleResult {
  return { ruleCode, ruleTable: 'REST', outcome, message, overridePolicy };
}

describe('the safeguards on a move', () => {
  it('offers no override when a blocking rule cannot be overridden', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'moveAssignment').mockRejectedValue(
      blockedProblem([
        rule('U-01', 'BLOCK', 'EMERGENCY', 'Not enough rest between shifts.'),
        rule('U-05', 'BLOCK', 'ACKNOWLEDGE', 'Too many hours in a day.'),
      ]),
    );
    const { onChanged, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));

    expect(await screen.findByText('U-05')).toBeInTheDocument();
    expect(screen.getByText(/Too many hours in a day/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emergency override…' })).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('needs a reason of ten characters for an override and acknowledges the warnings with it', async () => {
    const user = userEvent.setup();
    const moved = vi
      .spyOn(api, 'moveAssignment')
      .mockRejectedValueOnce(
        blockedProblem([
          rule('U-01', 'BLOCK', 'EMERGENCY', 'Not enough rest between shifts.'),
          rule('U-09', 'WARN', 'ACKNOWLEDGE', 'A long run of shifts.'),
        ]),
      )
      .mockResolvedValueOnce({ id: item.assignmentId, status: 'PLANNED', version: 5 });
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));
    await user.click(await screen.findByRole('button', { name: 'Emergency override…' }));

    const confirm = screen.getByRole('button', { name: 'Emergency override' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Why is this override needed?'), 'Short');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Why is this override needed?'), ' call, no relief');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(moved).toHaveBeenLastCalledWith(item.assignmentId, 4, {
        change: {
          type: 'ASSIGN',
          employeeId: officer.employeeId,
          unitId: 'unit-b',
          shiftTemplate: 'D8',
          startAt: '2026-11-22T07:00:00-06:00',
        },
        override: { reason: 'Short call, no relief' },
        acknowledgeWarnings: ['U-09'],
      }),
    );
  });

  it('needs the warnings acknowledged when nothing blocks the move', async () => {
    const user = userEvent.setup();
    const moved = vi
      .spyOn(api, 'moveAssignment')
      .mockRejectedValueOnce(
        blockedProblem([rule('U-09', 'WARN', 'ACKNOWLEDGE', 'A long run of shifts.')]),
      )
      .mockResolvedValueOnce({ id: item.assignmentId, status: 'PLANNED', version: 5 });
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));
    await user.click(await screen.findByRole('button', { name: 'Acknowledge warnings and move' }));

    await waitFor(() =>
      expect(moved).toHaveBeenLastCalledWith(item.assignmentId, 4, {
        change: {
          type: 'ASSIGN',
          employeeId: officer.employeeId,
          unitId: 'unit-b',
          shiftTemplate: 'D8',
          startAt: '2026-11-22T07:00:00-06:00',
        },
        acknowledgeWarnings: ['U-09'],
      }),
    );
  });

  it.each([
    ['pay-period-locked', 'Unlock it with a reason to make changes.'],
    ['shift-started', 'Past shifts are corrected in Time & attendance, not on the schedule.'],
    ['already-cancelled', 'Reload the board.'],
    ['fills-open-shift', 'Cancel it and assign the open shift again instead of moving it.'],
    ['actual-recorded', 'Correct the actual in Time & attendance instead of cancelling the shift.'],
  ])('says in plain words why the api refused the move (%s)', async (slug, detail) => {
    const user = userEvent.setup();
    vi.spyOn(api, 'moveAssignment').mockRejectedValue(
      new ApiError(detail, 409, {
        type: 'https://shiftcircle.local/problems/' + slug,
        title: detail,
        status: 409,
        detail,
      }),
    );
    const { onChanged, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for a reload when the version was not sent', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'moveAssignment').mockRejectedValue(
      new ApiError('Send the version you read, as If-Match: "3".', 428, {
        type: 'https://shiftcircle.local/problems/if-match-required',
        title: 'If-Match is required',
        status: 428,
        detail: 'Send the version you read, as If-Match: "3".',
      }),
    );
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));

    expect(await screen.findByText(/Send the version you read/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the board' })).toBeInTheDocument();
  });
});
