import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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

/** The demo business clock: noon on Thu 19 Nov 2026 in Regina (BusinessClock). */
const NOW = '2026-11-19T18:00:00Z';

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderDialog(options: { item?: ShiftItem; now?: string } = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/planning']}>
        <Routes>
          <Route
            path="/planning"
            element={
              <ShiftActionsDialog
                officer={officer}
                item={options.item ?? item}
                unitId="unit-b"
                {...(options.now ? { now: options.now } : {})}
                onClose={onClose}
                onChanged={onChanged}
              />
            }
          />
          <Route path="/time" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { onClose, onChanged };
}

/** Owen Mackenzie's night shift of Tue 17 Nov, two days before the demo day. */
const startedNight: ShiftItem = {
  type: 'SHIFT',
  assignmentId: 'a-owen-17',
  shiftTemplate: 'N8',
  startAt: '2026-11-17T23:00:00-06:00',
  endAt: '2026-11-18T07:00:00-06:00',
  kind: 'ROSTERED',
  worked: true,
  version: 2,
  actualRecorded: true,
  absenceRecorded: false,
  fillsOpenShift: false,
};

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
    ['pay-period-locked', 'This pay period is locked', 'Unlock it with a reason to make changes.'],
    [
      'shift-started',
      'This shift has started',
      'Past shifts are corrected in Time & attendance, not on the schedule.',
    ],
    ['already-cancelled', 'This shift is already cancelled', 'Reload the board.'],
    [
      'fills-open-shift',
      'This shift fills an open shift',
      'Cancel it and assign the open shift again instead of moving it.',
    ],
    [
      'actual-recorded',
      'This shift has actual time recorded',
      'Correct the actual in Time & attendance instead of cancelling the shift.',
    ],
  ])('shows the title and detail when the api refuses the move (%s)', async (slug, title, detail) => {
    const user = userEvent.setup();
    vi.spyOn(api, 'moveAssignment').mockRejectedValue(
      new ApiError(title, 409, {
        type: 'https://shiftcircle.local/problems/' + slug,
        title,
        status: 409,
        detail,
      }),
    );
    const { onChanged, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    await user.click(screen.getByRole('button', { name: 'Move shift' }));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
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

  it('does not offer the retired 16 h template for a new assignment', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    const select = await screen.findByLabelText('Shift');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(options.some((text) => text.startsWith('D8'))).toBe(true);
    // L16 is retired (release 5): history still renders its chip, but it is
    // not assignable any more.
    expect(options.some((text) => text.startsWith('L16'))).toBe(false);
  });

  it('reads the scheduled time in words, with the next day spelled out', () => {
    renderDialog({ item: startedNight, now: NOW });
    expect(
      screen.getByText('Scheduled Tue 17 Nov 2026, 23:00 – 07:00 next day'),
    ).toBeInTheDocument();
  });

  it('says up front that a started shift is corrected in Time & attendance, with no move or cancel', async () => {
    const user = userEvent.setup();
    const moved = vi.spyOn(api, 'moveAssignment');
    const cancelled = vi.spyOn(api, 'cancelAssignment');
    renderDialog({ item: startedNight, now: NOW });

    const notice = screen.getByRole('note', { name: 'This shift has started' });
    expect(notice).toHaveTextContent(
      'This shift started on Tue 17 Nov at 23:00. Worked shifts are corrected in Time & attendance.',
    );
    expect(screen.queryByRole('button', { name: 'Move…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel shift…' })).not.toBeInTheDocument();

    await user.click(within(notice).getByRole('link', { name: 'Open in Time & attendance' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/time?date=2026-11-17&unit=unit-b&shift=a-owen-17',
    );
    expect(moved).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('counts a shift that starts exactly now as started, the same test the api makes', () => {
    renderDialog({
      item: { ...item, startAt: '2026-11-19T12:00:00-06:00', endAt: '2026-11-19T20:00:00-06:00' },
      now: NOW,
    });
    expect(screen.getByRole('note', { name: 'This shift has started' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move…' })).not.toBeInTheDocument();
  });

  it('still offers move and cancel on a shift that has not started', () => {
    renderDialog({ now: NOW });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel shift…' })).toBeInTheDocument();
  });

  it.each([
    [
      'actualRecorded',
      'This shift has actual time recorded',
      'Correct the actual in Time & attendance instead of cancelling the shift.',
    ],
    [
      'absenceRecorded',
      'This shift has an absence recorded',
      'Correct the absence in Time & attendance instead of cancelling the shift.',
    ],
  ])('offers no cancel when the future shift has %s, in the api words', (flag, title, detail) => {
    renderDialog({ item: { ...item, [flag]: true }, now: NOW });
    const notice = screen.getByRole('note', { name: title });
    expect(notice).toHaveTextContent(`${title}. ${detail}`);
    expect(within(notice).getByRole('link', { name: 'Open in Time & attendance' })).toHaveAttribute(
      'href',
      '/time?date=2026-11-22&unit=unit-b&shift=a-nia-22',
    );
    expect(screen.queryByRole('button', { name: 'Cancel shift…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move…' })).toBeInTheDocument();
  });

  it('offers no move when the shift fills an open shift, in the api words', () => {
    renderDialog({ item: { ...item, fillsOpenShift: true }, now: NOW });
    const notice = screen.getByRole('note', { name: 'This shift fills an open shift' });
    expect(notice).toHaveTextContent(
      'This shift fills an open shift. Cancel it and assign the open shift again instead of moving it.',
    );
    expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel shift…' })).toBeInTheDocument();
  });

  it('refuses a new date and shift that has already started before the move is sent', async () => {
    const user = userEvent.setup();
    const moved = vi.spyOn(api, 'moveAssignment');
    renderDialog({ now: NOW });

    await user.click(screen.getByRole('button', { name: 'Move…' }));
    expect(screen.getByText('The moved shift starts Sun 22 Nov 2026 at 07:00.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2026-11-19' } });
    expect(
      screen.getByText(
        'Thu 19 Nov 2026 at 07:00 has already started (it is now Thu 19 Nov 2026, 12:00). Pick a date and shift that start later.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move shift' })).toBeDisabled();

    // The evening shift on the same day has not started yet.
    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: 'E8' } });
    expect(screen.getByText('The moved shift starts Thu 19 Nov 2026 at 15:00.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move shift' })).toBeEnabled();
    expect(moved).not.toHaveBeenCalled();
  });

  it('says a started shift in a locked pay period is locked, in the api words, with no link to correct it', () => {
    renderDialog({ item: { ...startedNight, payPeriodLocked: true }, now: NOW });

    const notice = screen.getByRole('note', { name: 'This pay period is locked' });
    expect(notice).toHaveTextContent(
      'This pay period is locked. Unlock it with a reason to make changes.',
    );
    expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'This shift has started' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Worked shifts are corrected/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel shift…' })).not.toBeInTheDocument();
    // One notice for both actions, not one each.
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });

  it('writes the enabled cancel button in white on the block red (WCAG AA)', async () => {
    const user = userEvent.setup();
    renderDialog({ now: NOW });
    await user.click(screen.getByRole('button', { name: 'Cancel shift…' }));
    await user.type(screen.getByLabelText('Why is this shift cancelled?'), 'No longer needed here');
    const confirm = screen.getByRole('button', { name: 'Cancel shift' });
    expect(confirm).toBeEnabled();
    expect(getComputedStyle(confirm).color).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(confirm).backgroundColor).toBe('rgb(163, 0, 0)');
  });

  it('offers a reload when the api says the shift is already cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'cancelAssignment').mockRejectedValue(
      new ApiError('This shift is already cancelled', 409, {
        type: 'https://shiftcircle.local/problems/already-cancelled',
        title: 'This shift is already cancelled',
        status: 409,
        detail: 'Reload the board.',
      }),
    );
    renderDialog({ now: NOW });

    await user.click(screen.getByRole('button', { name: 'Cancel shift…' }));
    await user.type(screen.getByLabelText('Why is this shift cancelled?'), 'No longer needed here');
    await user.click(screen.getByRole('button', { name: 'Cancel shift' }));

    expect(await screen.findByText('This shift is already cancelled')).toBeInTheDocument();
    expect(screen.getByText('Reload the board.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the board' })).toBeInTheDocument();
  });
});
