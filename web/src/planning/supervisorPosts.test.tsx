import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { api } from '../api/client';
import { demoSchedule } from '../api/fixtures/schedule';
import type {
  BlockCoverage,
  OfficerRow,
  RuleCheckOutcome,
  SchedulePayload,
  ShiftItem,
  Unit,
} from '../api/types';
import { AppShellRoutes } from '../App';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { GapFillPanel } from './GapFillPanel';
import { gapCandidates } from './gapFill';
import { RosterGrid } from './RosterGrid';
import { RuleCheckPanel } from './RuleCheckPanel';
import { ShiftActionsDialog } from './ShiftActionsDialog';
import {
  inGapPool,
  nameWithPosition,
  onDuty,
  positionTag,
  shortName,
  unitGroups,
} from './supervisorPosts';

const DAY = '2026-11-21';
const DAYS = ['2026-11-20', DAY];

function person(
  name: string,
  position: string | undefined,
  hours = 40,
  qualifications: string[] = [],
): OfficerRow {
  return {
    employeeId: name.toLowerCase().replace(/\s/g, '-'),
    name,
    rotation: '',
    qualifications,
    payPeriodHours: hours,
    payPeriodThreshold: 80,
    overtimeStatus: 'UNDER',
    cells: DAYS.map((date) => ({ date, items: [] })),
    ...(position ? { position } : {}),
  };
}

function block(date: string, kind: BlockCoverage['block'], lowest: number, required = 1): BlockCoverage {
  return {
    block: kind,
    date,
    required,
    scheduled: {
      lowestHourly: lowest,
      shortHours: lowest < required ? [{ from: '07:00', to: '15:00', count: lowest }] : [],
      maxHourly: lowest,
    },
    covered: lowest >= required,
  };
}

const POST = { id: 'sup-l', name: 'Supervision · Living units', kind: 'SUPERVISION' };
const LINE = { id: 'unit-a', name: 'Unit A · Living unit', kind: 'LIVING' };

function board(unit: SchedulePayload['unit'], officers: OfficerRow[], extra: Partial<SchedulePayload> = {}) {
  return {
    unit,
    from: DAYS[0],
    to: DAYS[1],
    days: DAYS,
    asOf: '2026-11-19',
    coverage: DAYS.flatMap((date) => [
      block(date, 'DAY', date === DAY ? 0 : 1),
      block(date, 'EVENING', 1),
      block(date, 'NIGHT', 1),
    ]),
    officers,
    warnings: 0,
    overridesThisPeriod: 0,
    publishedState: { published: false, unpublishedChanges: null },
    ...extra,
  } as SchedulePayload;
}

function wrap(node: ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>{node}</MemoryRouter>
    </ThemeProvider>,
  );
}

describe('supervisor posts: the words', () => {
  it('shortens a name for the on-duty line', () => {
    expect(shortName('Morgan Ellis')).toBe('M. Ellis');
    expect(shortName('Ana de la Cruz')).toBe('A. de la Cruz');
    expect(shortName('Cher')).toBe('Cher');
  });

  it('names the position only where it matters', () => {
    expect(positionTag({ position: 'CS' }, LINE)).toBe('supervisor');
    expect(positionTag({ position: 'CS' }, POST)).toBe('supervisor');
    expect(positionTag({ position: 'CO' }, POST)).toBe('officer');
    // An officers-only board reads exactly as before.
    expect(positionTag({ position: 'CO' }, LINE)).toBeNull();
    expect(nameWithPosition({ name: 'Nia Thompson', position: 'CO' }, LINE)).toBe('Nia Thompson');
    expect(nameWithPosition({ name: 'Morgan Ellis', position: 'CS' }, POST)).toBe(
      'Morgan Ellis (supervisor)',
    );
  });

  it('keeps the gap pool to the unit kind', () => {
    const sup = { position: 'CS', qualifications: [] };
    const co = { position: 'CO', qualifications: [] };
    const acting = { position: 'CO', qualifications: ['ACTING_SUP'] };
    expect([sup, co, acting].map((entry) => inGapPool(entry, POST))).toEqual([true, false, true]);
    expect([sup, co, acting].map((entry) => inGapPool(entry, LINE))).toEqual([false, true, true]);
    // An older payload with no position counts as an officer.
    expect(inGapPool({ qualifications: [] }, LINE)).toBe(true);
  });

  it('groups the supervisor posts after the line units', () => {
    const units = [
      { id: 'a', code: 'A', name: 'Unit A', kind: 'LIVING' },
      { id: 'l', code: 'SUP-L', name: 'Supervision · Living units', kind: 'SUPERVISION' },
      { id: 'b', code: 'B', name: 'Unit B', kind: 'LIVING' },
    ] as Unit[];
    const groups = unitGroups(units);
    expect(groups.line.map((unit) => unit.code)).toEqual(['A', 'B']);
    expect(groups.posts.map((unit) => unit.code)).toEqual(['SUP-L']);
  });

  it('reads who is on duty per day and block', () => {
    const payload = {
      supervisorsOnDuty: [{ date: DAY, block: 'DAY' as const, names: ['Morgan Ellis'] }],
    };
    expect(onDuty(payload, DAY, 'DAY')).toEqual(['Morgan Ellis']);
    expect(onDuty(payload, DAY, 'NIGHT')).toBeUndefined();
    expect(onDuty({}, DAY, 'DAY')).toBeUndefined();
  });
});

describe('supervisor posts: gap fill', () => {
  it('lists only supervisors on a post, then acting officers tagged', () => {
    const payload = board(POST, [
      person('Acting Andy', 'CO', 10, ['ACTING_SUP']),
      person('Plain Pat', 'CO', 5),
      person('Sue Sup', 'CS', 60),
      person('Sam Sup', 'CS', 30),
    ]);
    const list = gapCandidates(payload, block(DAY, 'DAY', 0), 'D8');
    expect(list.map((entry) => entry.officer.name)).toEqual(['Sam Sup', 'Sue Sup', 'Acting Andy']);
    expect(list.map((entry) => entry.acting ?? false)).toEqual([false, false, true]);
  });

  it('leaves supervisors out of a line unit pool', () => {
    const payload = board(LINE, [person('Nia Officer', 'CO', 20), person('Sue Sup', 'CS', 10)]);
    const list = gapCandidates(payload, block(DAY, 'DAY', 0), 'D8');
    expect(list.map((entry) => entry.officer.name)).toEqual(['Nia Officer']);
    expect(list[0].acting).toBeUndefined();
  });

  it('speaks of supervisors on a post and tags an acting officer', () => {
    const payload = board(POST, [
      person('Sam Sup', 'CS', 30),
      person('Acting Andy', 'CO', 10, ['ACTING_SUP']),
    ]);
    wrap(
      <GapFillPanel
        payload={payload}
        gap={block(DAY, 'DAY', 0)}
        template="D8"
        onTemplate={vi.fn()}
        onCheck={vi.fn()}
        onClose={vi.fn()}
        findEligibleHref="/overtime"
      />,
    );
    const list = screen.getByRole('list', { name: 'Free supervisors' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sam Sup');
    expect(items[1]).toHaveTextContent('Acting Andy');
    expect(within(items[1]).getByText('Acting · Warn')).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('R-01 needs acknowledgement');
    expect(screen.getByRole('link', { name: 'Find eligible supervisor → Overtime board' })).toBeInTheDocument();
  });
});

describe('supervisor posts: the roster grid', () => {
  it('shows supervisor rows and "Supervisor 1 / 1" per block on a post', () => {
    wrap(<RosterGrid payload={board(POST, [person('Morgan Ellis', 'CS')])} today="2026-11-19" />);
    expect(screen.getByRole('columnheader', { name: 'Supervisor' })).toBeInTheDocument();
    expect(screen.getAllByText(/needs 1 supervisor$/)).toHaveLength(3);
    expect(screen.getAllByText('Supervisor 1 / 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Supervisor 0 / 1')).toBeInTheDocument();
    // The post's own board has no on-duty line and no badge on a supervisor.
    expect(screen.queryByTestId('supervisor-on-duty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('position-badge')).not.toBeInTheDocument();
  });

  it('keeps a line unit board as it was, with the supervisor on duty per block', () => {
    const payload = board(LINE, [person('Nia Officer', 'CO')], {
      supervisorsOnDuty: DAYS.flatMap((date) => [
        { date, block: 'DAY' as const, names: ['Morgan Ellis'] },
        { date, block: 'EVENING' as const, names: ['Jamie Chen'] },
        { date, block: 'NIGHT' as const, names: date === DAY ? [] : ['Riley Stone'] },
      ]),
    });
    wrap(<RosterGrid payload={payload} today="2026-11-19" />);
    expect(screen.getByRole('columnheader', { name: 'Officer' })).toBeInTheDocument();
    expect(screen.queryByText(/supervisor$/)).not.toBeInTheDocument();
    const row = screen.getByTestId('supervisor-on-duty');
    expect(within(row).getByTestId('supervisor-on-duty-label')).toHaveTextContent('Supervisor on duty');
    const day = within(row).getByRole('list', { name: `Supervisor on duty, ${DAY}` });
    expect(within(day).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'D Days: M. Ellis',
      'E Evenings: J. Chen',
      'N Nights: none',
    ]);
    expect(screen.queryByTestId('position-badge')).not.toBeInTheDocument();
  });

  it('names the on-duty supervisors in the compact cell', () => {
    const payload = board(LINE, [person('Nia Officer', 'CO')], {
      supervisorsOnDuty: [{ date: DAY, block: 'DAY', names: ['Morgan Ellis'] }],
    });
    wrap(<RosterGrid payload={payload} today="2026-11-19" density="compact" />);
    expect(
      screen.getByRole('img', {
        name: 'Supervisor on duty. Days: Morgan Ellis · Evenings: none · Nights: none',
      }),
    ).toHaveTextContent('!');
  });

  it('marks a supervisor working an officer post "Sup"', () => {
    const payload = board(LINE, [person('Nia Officer', 'CO'), person('Morgan Ellis', 'CS')]);
    wrap(<RosterGrid payload={payload} today="2026-11-19" />);
    const badges = screen.getAllByTestId('position-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent(/^Sup/);
    expect(badges[0].closest('tr')).toHaveAttribute('data-officer-name', 'Morgan Ellis');
  });
});

describe('supervisor posts: review round', () => {
  it('marks an officer on a post "Acting" or "Officer"', () => {
    const payload = board(POST, [
      person('Morgan Ellis', 'CS'),
      person('Acting Andy', 'CO', 40, ['ACTING_SUP']),
      person('Plain Pat', 'CO'),
    ]);
    wrap(<RosterGrid payload={payload} today="2026-11-19" />);
    const badges = screen.getAllByTestId('position-badge');
    expect(badges).toHaveLength(2);
    const andy = badges.find((badge) => badge.closest('tr')?.dataset.officerName === 'Acting Andy')!;
    const pat = badges.find((badge) => badge.closest('tr')?.dataset.officerName === 'Plain Pat')!;
    expect(andy).toHaveTextContent(/^Acting/);
    expect(andy).toHaveAttribute('title', 'Officer acting as supervisor (R-01 warning)');
    expect(pat).toHaveTextContent(/^Officer/);
    expect(pat).toHaveAttribute('title', 'Officer on a supervisor post (R-01)');
  });

  it('keys on the supervisory flag the board sends, not the CS code', () => {
    // A later supervisory position (a Lead) is a row in the position table.
    const lead = { ...person('Lee Lead', 'LD'), supervisory: true };
    expect(positionTag(lead, LINE)).toBe('supervisor');
    expect(inGapPool(lead, POST)).toBe(true);
    expect(positionTag({ ...person('Odd Code', 'CS'), supervisory: false }, POST)).toBe('officer');
  });

  it('lists the signed-in supervisor last and does not offer their own row', () => {
    const payload = board(POST, [person('Morgan Ellis', 'CS', 10), person('Sam Sup', 'CS', 30)]);
    const list = gapCandidates(payload, block(DAY, 'DAY', 0), 'D8', undefined, 'morgan-ellis');
    expect(list.map((entry) => [entry.officer.name, entry.self ?? false])).toEqual([
      ['Sam Sup', false],
      ['Morgan Ellis', true],
    ]);
    wrap(
      <GapFillPanel
        payload={payload}
        gap={block(DAY, 'DAY', 0)}
        template="D8"
        onTemplate={vi.fn()}
        onCheck={vi.fn()}
        onClose={vi.fn()}
        findEligibleHref="/overtime"
        selfEmployeeId="morgan-ellis"
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Free supervisors' })).getAllByRole('listitem');
    expect(within(items[0]).getByRole('button', { name: /Check & assign D8: Sam Sup/ })).toBeEnabled();
    expect(within(items[1]).getByRole('button', { name: /Check & assign D8: Morgan Ellis/ })).toBeDisabled();
    expect(items[1]).toHaveTextContent("This is you: you can't assign your own shift");
  });
});

describe('supervisor posts: the rule check and the shift dialog', () => {
  it('shows R-01 as a Block with no Assign and no override', () => {
    const outcome: RuleCheckOutcome = {
      outcome: 'BLOCK',
      ruleSetVersion: 4,
      overridable: false,
      passedRules: 20,
      ruleResults: [
        {
          ruleCode: 'R-01',
          ruleTable: 'POSTS',
          outcome: 'BLOCK',
          overridePolicy: 'NONE',
          message: 'A supervisor post needs a supervisor: Nia Officer is an officer.',
        },
      ],
    };
    wrap(
      <RuleCheckPanel
        state={{
          kind: 'ready',
          change: {
            type: 'ASSIGN',
            employeeId: 'nia',
            unitId: 'sup-l',
            shiftTemplate: 'D8',
            startAt: `${DAY}T07:00:00-06:00`,
          },
          outcome,
          acknowledged: [],
        }}
        title="Assign Nia Officer (officer) → Day 8 h"
        detail="Supervision · Living units · Sat 21 Nov"
        findEligibleLabel="Find eligible supervisor"
        onSave={vi.fn()}
        onAcknowledge={vi.fn()}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/^R-01/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign shift' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acknowledge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Emergency override/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find eligible supervisor' })).toBeInTheDocument();
  });

  it('names a supervisor in the shift dialog title', () => {
    const item: ShiftItem = {
      type: 'SHIFT',
      assignmentId: 'shift-1',
      shiftTemplate: 'D8',
      startAt: `${DAY}T07:00:00-06:00`,
      endAt: `${DAY}T15:00:00-06:00`,
      kind: 'ROSTERED',
      worked: false,
      version: 0,
      edited: false,
    };
    wrap(
      <ShiftActionsDialog
        officer={person('Morgan Ellis', 'CS')}
        item={item}
        unitId="sup-l"
        unitKind="SUPERVISION"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/^Morgan Ellis \(supervisor\) · /);
  });
});

describe('supervisor posts: the unit picker', () => {
  it('groups the supervisor posts after the units', async () => {
    const units = [
      { id: 'unit-b', code: 'B', name: 'Unit B · Living unit', kind: 'LIVING', allows_12h: true, allows_16h: true },
      { id: 'sup-l', code: 'SUP-L', name: 'Supervision · Living units', kind: 'SUPERVISION', allows_12h: true, allows_16h: false },
      { id: 'sup-o', code: 'SUP-O', name: 'Supervision · Operations', kind: 'SUPERVISION', allows_12h: true, allows_16h: false },
    ] as Unit[];
    const getUnits = vi.spyOn(api, 'getUnits').mockResolvedValue(units);
    try {
      render(
        <ThemeProvider theme={theme}>
          <RoleProvider>
            <MemoryRouter initialEntries={['/planning']}>
              <AppShellRoutes />
            </MemoryRouter>
          </RoleProvider>
        </ThemeProvider>,
      );
      const picker = await screen.findByRole('combobox', { name: 'Unit' });
      const groups = picker.querySelectorAll('optgroup');
      expect([...groups].map((group) => group.label)).toEqual(['Units', 'Supervisor posts']);
      expect([...groups[1].querySelectorAll('option')].map((option) => option.textContent)).toEqual([
        'Supervision · Living units',
        'Supervision · Operations',
      ]);
      expect(demoSchedule.unit.id).toBe('unit-b');
    } finally {
      getUnits.mockRestore();
    }
  });
});
