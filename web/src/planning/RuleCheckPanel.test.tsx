import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import type { RuleCheckOutcome } from '../api/types';
import { theme } from '../theme/theme';
import { OverrideDialog } from './OverrideDialog';
import { RuleCheckPanel } from './RuleCheckPanel';
import type { RuleCheckedState } from './useRuleCheckedMutation';

const blockedOutcome: RuleCheckOutcome = {
  outcome: 'BLOCK',
  ruleSetVersion: 7,
  overridable: true,
  passedRules: 9,
  publishedAt: '13:50',
  ruleResults: [
    {
      ruleCode: 'U-01',
      outcome: 'BLOCK',
      message:
        "Only 7 hours' rest after the 12 h shift ending Fri 24:00. The minimum is 8 consecutive hours in any 24 hours.",
      facts: { restHours: 7, minHours: 8 },
      evidence: [{ assignmentId: 'a-nia-20', label: 'Fri 20 P12 12:00–24:00' }],
      source: 'Saskatchewan Employment Act',
    },
    {
      ruleCode: 'U-05',
      outcome: 'BLOCK',
      message: '17 hours of work in 24 hours (Fri 12:00 – Sat 12:00).',
      facts: { hours: 17, maxHours: 16 },
    },
    {
      ruleCode: 'U-14',
      outcome: 'WARN',
      message: '52 hours this week, over the 48 h warning level.',
    },
  ],
};

const blockedState: RuleCheckedState = {
  kind: 'ready',
  change: {
    type: 'ASSIGN',
    employeeId: 'emp-nia',
    unitId: 'unit-b',
    shiftTemplate: 'D8',
    startAt: '2026-11-21T07:00:00-06:00',
  },
  outcome: blockedOutcome,
  acknowledged: [],
};

function renderPanel(state: RuleCheckedState = blockedState) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <RuleCheckPanel
          state={state}
          title="Assign Nia Thompson → Day 8 h"
          detail="Unit B · Living unit · Sat 21 Nov · 07:00 – 15:00"
          onSave={vi.fn()}
          onAcknowledge={vi.fn()}
          onOverride={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('the rule-check panel', () => {
  it('shows the proposed change', () => {
    renderPanel();
    expect(screen.getByText('Proposed change')).toBeInTheDocument();
    expect(screen.getByText('Assign Nia Thompson → Day 8 h')).toBeInTheDocument();
    expect(screen.getByText('Unit B · Living unit · Sat 21 Nov · 07:00 – 15:00')).toBeInTheDocument();
  });

  it('shows the overall result and each rule result with the api message', () => {
    renderPanel();

    expect(screen.getByRole('status')).toHaveTextContent('Blocked: 2 rules fail');
    expect(screen.getByText('U-01 · Minimum rest')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Only 7 hours' rest after the 12 h shift ending Fri 24:00. The minimum is 8 consecutive hours in any 24 hours.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('U-05 · Max 16 h in 24 h')).toBeInTheDocument();
    expect(screen.getByText('52 hours this week, over the 48 h warning level.')).toBeInTheDocument();
  });

  it('shows the evidence and the source the api sent', () => {
    renderPanel();
    expect(screen.getByText(/Source: Saskatchewan Employment Act/)).toBeInTheDocument();
    expect(screen.getByText(/Evidence: Fri 20 P12 12:00–24:00/)).toBeInTheDocument();
  });

  it('says how many other rules passed and which rule tables were in force', () => {
    renderPanel();
    expect(screen.getByText(/9 other rules passed/)).toBeInTheDocument();
    expect(screen.getByText(/Rule tables v7/)).toBeInTheDocument();
  });

  it('offers the emergency override only when the rules allow it', () => {
    const { unmount } = renderPanel();
    expect(screen.getByRole('button', { name: 'Emergency override…' })).toBeInTheDocument();
    unmount();

    renderPanel({
      ...blockedState,
      outcome: { ...blockedOutcome, overridable: false },
    });
    expect(screen.queryByRole('button', { name: 'Emergency override…' })).not.toBeInTheDocument();
  });

  it('does not offer to save a change that is blocked', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Assign shift' })).not.toBeInTheDocument();
  });

  it('offers to save a change that passes every rule', () => {
    renderPanel({
      ...blockedState,
      outcome: {
        outcome: 'PASS',
        ruleSetVersion: 7,
        overridable: true,
        ruleResults: [
          {
            ruleCode: 'U-01',
            outcome: 'PASS',
            message: '12 hours of rest after the previous shift.',
          },
        ],
      },
    });
    expect(screen.getByRole('button', { name: 'Assign shift' })).toBeInTheDocument();
  });

  it('asks for the warnings to be acknowledged before the change is saved', () => {
    renderPanel({
      ...blockedState,
      outcome: {
        outcome: 'WARN',
        ruleSetVersion: 7,
        overridable: true,
        ruleResults: [
          { ruleCode: 'U-14', outcome: 'WARN', message: '52 hours this week, over the 48 h warning level.' },
        ],
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('1 warning need acknowledging');
    expect(screen.getByRole('button', { name: 'Acknowledge the warning' })).toBeInTheDocument();
  });
});

describe('the override dialog', () => {
  it('will not accept a reason that is too short', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ThemeProvider theme={theme}>
        <OverrideDialog open ruleCodes={['U-01', 'U-05']} onClose={vi.fn()} onConfirm={onConfirm} />
      </ThemeProvider>,
    );

    const confirm = screen.getByRole('button', { name: 'Emergency override' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Why is this override needed?'), 'Too short');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Why is this override needed?'), ' but long enough');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Too short but long enough');
  });

  it('says which rules the override breaks', () => {
    render(
      <ThemeProvider theme={theme}>
        <OverrideDialog open ruleCodes={['U-01', 'U-05']} onClose={vi.fn()} onConfirm={vi.fn()} />
      </ThemeProvider>,
    );

    expect(screen.getByText(/This overrides U-01, U-05/)).toBeInTheDocument();
    expect(screen.getByText(/saved to the audit log and flagged in reports/)).toBeInTheDocument();
  });
});
