import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api, ApiError } from '../api/client';
import { demoSchedule } from '../api/fixtures/schedule';
import type { ShiftItem } from '../api/types';
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
