import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
import { api } from '../api/client';
import type { PayPeriod, TimeEntry } from '../api/types';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { workedOf } from './workedHours';

function renderScreen() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/time']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

describe('Time and attendance', () => {
  it('shows the period, the tiles and the shifts with no actual', async () => {
    renderScreen();

    // The heading is drawn while the periods load; the select below is the wait.
    await screen.findByRole('heading', { name: 'Time & attendance' });
    // The pay-period select appears once the periods have loaded.
    expect(await screen.findByLabelText('Pay period')).toBeInTheDocument();
    // A grid row appears once the time entries have loaded.
    expect(await screen.findByText('Tara Nakamura')).toBeInTheDocument();
    expect(await screen.findByText('Scheduled h')).toBeInTheDocument();
    expect(screen.getByText('Worked h')).toBeInTheDocument();
    expect(screen.getByText('Overtime h')).toBeInTheDocument();
    expect(screen.getByText('Shifts needing actuals')).toBeInTheDocument();
    expect(screen.getByText('Short extensions')).toBeInTheDocument();

    // The shifts with no actual are named, not just counted.
    expect(screen.getByText('3 shifts with no actual recorded')).toBeInTheDocument();
  });

  it('records nothing until the supervisor says what happened', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const cells = await screen.findAllByRole('button', { name: /needs actual/ });
    await user.click(cells[0]);

    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(
      screen.getByText('Choose what happened. Nothing is recorded until you do.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Worked as scheduled' }));
    expect(save).toBeEnabled();
    expect(
      screen.getByText(/Will record: worked as scheduled, 07:00 – 15:00/),
    ).toBeInTheDocument();
  });

  it('takes a missing-actual line to its cell and opens the actual panel', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    await user.click(
      screen.getByRole('button', { name: /Marc Desjardins · 2026-11-16 07:00/ }),
    );

    expect(await screen.findByRole('heading', { name: /Record actual/ })).toBeInTheDocument();
  });

  it('will not lock the period while a shift has no actual', async () => {
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const lock = screen.getByRole('button', { name: 'Lock pay period' });
    expect(lock).toBeDisabled();
    expect(screen.getByText('Record 3 missing actuals first')).toBeInTheDocument();
  });

  it('records an actual and shows the recalculated pay codes', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const cell = await screen.findAllByRole('button', { name: /needs actual/ });
    await user.click(cell[0]);

    const panel = await screen.findByRole('heading', { name: /Record actual/ });
    expect(panel).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Worked as scheduled' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Now 82.5 h/)).toBeInTheDocument();
  });

  it('records an absence', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    const cells = await screen.findAllByRole('button', { name: /needs actual/ });
    await user.click(cells[0]);
    await user.click(screen.getByRole('radio', { name: 'Absent' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/The actual is recorded/)).toBeInTheDocument();
  });

  it('shows a locked period as read-only with the payroll export', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    await user.selectOptions(screen.getByLabelText('Pay period'), 'period-2026-10-26');

    expect(await screen.findByText(/Locked · M. Ellis/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payroll export (CSV)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument();
    expect(screen.getByText(/Last export 9 Nov 08:14/)).toBeInTheDocument();
    expect(screen.getByText(/the actuals are read-only/)).toBeInTheDocument();
    // A read-only grid still has to be reachable for keyboard scrolling.
    expect(
      await screen.findByRole('region', { name: 'Time entries, scrolls sideways' }),
    ).toHaveAttribute('tabindex', '0');
  });

  it('asks for a reason before unlocking', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');
    await user.selectOptions(screen.getByLabelText('Pay period'), 'period-2026-10-26');

    await user.click(await screen.findByRole('button', { name: 'Unlock…' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Unlocking recalculates pay codes/)).toBeInTheDocument();

    const unlock = within(dialog).getByRole('button', { name: 'Unlock' });
    expect(unlock).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Why is this period being unlocked?'), 'Short');
    expect(unlock).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText('Why is this period being unlocked?'),
      ' reason enough',
    );
    expect(unlock).toBeEnabled();

    await user.click(unlock);
    expect(await screen.findByText(/The pay period is unlocked/)).toBeInTheDocument();
  });

  it('filters the grid by unit', async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByText('Tara Nakamura');

    expect(screen.getByText('Sam Abara')).toBeInTheDocument();
    expect(screen.getByText('Devon Clarke')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Unit'), 'control');

    expect(screen.getByText('Devon Clarke')).toBeInTheDocument();
    expect(screen.queryByText('Sam Abara')).not.toBeInTheDocument();
  });

  it('names the person who locked the period, and never invents one', async () => {
    // V5: the pill said "Locked · a supervisor", which is nobody. With a name
    // it shows the name; without one it shows the time only.
    const current: PayPeriod = {
      id: 'period-2026-11-09',
      label: '9 – 22 Nov 2026',
      from: '2026-11-09',
      to: '2026-11-22',
      status: 'LOCKED',
      lockedAt: '20 Nov 08:48',
      totals: { officers: 10, workedHours: 801, overtimeHours: 31 },
      overtimeThresholdHours: 80,
    };
    vi.spyOn(api, 'getPayPeriods').mockResolvedValue([current]);
    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([]);

    renderScreen();

    expect(await screen.findByText('Locked · 20 Nov 08:48')).toBeInTheDocument();
    expect(screen.queryByText(/a supervisor/)).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('opens on the pay period that contains the demo day', async () => {
    // V3: the list runs newest first, so the first period was 21 Dec - 3 Jan.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const body = String(input).includes('/api/v1/version')
          ? { name: 'shiftcircle-api', asOf: '2026-11-19' }
          : {};
        return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
      }),
    );
    const future: PayPeriod = {
      id: 'period-2026-12-21',
      label: '21 Dec – 3 Jan 2027',
      from: '2026-12-21',
      to: '2027-01-03',
      status: 'OPEN',
      totals: { officers: 10, workedHours: 0, overtimeHours: 0 },
      overtimeThresholdHours: 80,
    };
    const current: PayPeriod = {
      id: 'period-2026-11-09',
      label: '9 – 22 Nov 2026',
      from: '2026-11-09',
      to: '2026-11-22',
      status: 'OPEN',
      totals: { officers: 10, workedHours: 801, overtimeHours: 31 },
      overtimeThresholdHours: 80,
    };
    vi.spyOn(api, 'getPayPeriods').mockResolvedValue([future, current]);

    renderScreen();

    const select = await screen.findByLabelText('Pay period');
    expect(select).toHaveValue('period-2026-11-09');
    vi.restoreAllMocks();
  });

  it('keeps the grid and its scroll position while a save refreshes it', async () => {
    // Observation #9: the reload changed the cache key, the whole grid was
    // replaced by a loading line and the browser jumped to the top.
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const first = api.getTimeEntries.bind(api);
    const entries = await first('period-2026-11-09');
    vi.spyOn(api, 'getTimeEntries')
      .mockResolvedValueOnce(entries)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(entries);
          }),
      );
    vi.spyOn(api, 'recordActual').mockResolvedValue({
      entry: entries[0],
      payCodes: [],
      periodHours: 8,
    });

    renderScreen();

    // Scroll the grid down, then record an actual.
    const grid = await screen.findByRole('region', { name: 'Time entries, scrolls sideways' });
    grid.scrollTop = 240;
    await user.click((await screen.findAllByRole('button', { name: /needs actual/ }))[0]);
    await user.click(screen.getByRole('radio', { name: 'Worked as scheduled' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // While the refresh is in flight the rows are still there and the grid is
    // the same element, so its scroll position survives.
    expect(await screen.findByText('Updating the entries…')).toBeInTheDocument();
    expect(screen.queryByText('Loading the time entries…')).not.toBeInTheDocument();
    // The modal drawer hides the page from the accessibility tree; the grid is
    // still in the document, and after Done it is the same element.
    expect(document.querySelector('[aria-label="Time entries, scrolls sideways"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    // The drawer's close transition clears aria-hidden on the page; until then
    // the grid is out of the accessibility tree.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Time entries, scrolls sideways' })).toBe(grid),
    );
    expect(grid.scrollTop).toBe(240);

    release?.();
    await waitFor(() => expect(screen.queryByText('Updating the entries…')).not.toBeInTheDocument());
    vi.restoreAllMocks();
  });

  it('clears a record back to needs actual', async () => {
    // Observation #11: there was no undo - an absence or a wrong actual stayed.
    const worked: TimeEntry = {
      assignmentId: 'assignment-worked',
      employeeId: 'emp-tara',
      employeeName: 'Tara Nakamura',
      unitId: 'unit-b',
      unitName: 'Unit B · Living unit',
      date: '2026-11-18',
      startAt: '2026-11-18T07:00:00-06:00',
      endAt: '2026-11-18T15:00:00-06:00',
      shiftTemplate: 'D8',
      worked: true,
      needsActual: false,
      actualStart: '2026-11-18T07:00:00-06:00',
      actualEnd: '2026-11-18T15:00:00-06:00',
    };
    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([worked]);
    const clear = vi.spyOn(api, 'clearActual').mockResolvedValue({
      entry: { ...worked, worked: false, needsActual: true },
      payCodes: [],
      periodHours: 0,
    });
    const user = userEvent.setup();

    renderScreen();

    await screen.findByText('Tara Nakamura');
    const grid = await screen.findByRole('region', { name: 'Time entries, scrolls sideways' });
    await user.click(within(grid).getAllByRole('button')[0]);
    await user.click(await screen.findByRole('button', { name: 'Clear (back to needs actual)' }));

    await waitFor(() => expect(clear).toHaveBeenCalledWith('assignment-worked'));
    expect(await screen.findByText(/The record is cleared/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('writes a night shift\'s adjusted end on the next day', async () => {
    // A 23:00-07:00 shift used to send an end before its start (400).
    const night: TimeEntry = {
      assignmentId: 'assignment-night',
      employeeId: 'emp-sam',
      employeeName: 'Sam Abara',
      unitId: 'unit-b',
      unitName: 'Unit B · Living unit',
      date: '2026-11-18',
      startAt: '2026-11-18T23:00:00-06:00',
      endAt: '2026-11-19T07:00:00-06:00',
      shiftTemplate: 'N8',
      worked: false,
      needsActual: true,
    };
    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([night]);
    const record = vi.spyOn(api, 'recordActual').mockResolvedValue({
      entry: night,
      payCodes: [],
      periodHours: 8,
    });
    const user = userEvent.setup();

    renderScreen();

    await user.click(await screen.findByRole('button', { name: /needs actual/ }));
    await user.click(screen.getByRole('radio', { name: 'Adjusted times' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('assignment-night', {
        workedAsScheduled: false,
        actualStart: '2026-11-18T23:00:00-06:00',
        actualEnd: '2026-11-19T07:00:00-06:00',
      }),
    );
    vi.restoreAllMocks();
  });

  it('explains its chips, tiles and pills in a key', async () => {
    // Observation #8: the cells and pill codes (P-01, P-04) were unexplained.
    renderScreen();

    const key = await screen.findByRole('region', { name: 'Key' });
    expect(within(key).getByText(/click to record what happened/)).toBeInTheDocument();
    expect(within(key).getByText(/Short extension = under 30 min, unpaid/)).toBeInTheDocument();
    expect(within(key).getByText(/Overtime = hours over 80 h in a pay period/)).toBeInTheDocument();
    // No bare rule codes in the tiles.
    expect(screen.queryByText('P-01')).not.toBeInTheDocument();
    expect(screen.queryByText(/P-04/)).not.toBeInTheDocument();
  });

  it('reopens a sickness record and changes it to worked', async () => {
    // Observation #11: an absence cell was a plain span, so a Sick or Vac
    // record could never be reopened or corrected.
    const sick: TimeEntry = {
      assignmentId: 'assignment-sick',
      employeeId: 'emp-tara',
      employeeName: 'Tara Nakamura',
      unitId: 'unit-b',
      unitName: 'Unit B · Living unit',
      date: '2026-11-20',
      startAt: '2026-11-20T07:00:00-06:00',
      endAt: '2026-11-20T15:00:00-06:00',
      shiftTemplate: 'D8',
      worked: false,
      needsActual: false,
      absence: 'SICK',
    };
    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([sick]);
    const record = vi.spyOn(api, 'recordActual').mockResolvedValue({
      entry: { ...sick, absence: undefined, worked: true, actualStart: sick.startAt, actualEnd: sick.endAt },
      payCodes: [],
      periodHours: 8,
    });
    const user = userEvent.setup();

    renderScreen();

    await user.click(
      await screen.findByRole('button', {
        name: 'Sick · Tara Nakamura on 2026-11-20 · change',
      }),
    );
    // The drawer opens on what is recorded, not on an empty question.
    expect(await screen.findByRole('radio', { name: 'Absent' })).toBeChecked();
    expect(await screen.findByLabelText('Absence type')).toHaveValue('SICK');

    await user.click(screen.getByRole('radio', { name: 'Worked as scheduled' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('assignment-sick', { workedAsScheduled: true }),
    );
    vi.restoreAllMocks();
  });

  it('changes a vacation record to sick', async () => {
    const vacation: TimeEntry = {
      assignmentId: 'assignment-vac',
      employeeId: 'emp-tara',
      employeeName: 'Tara Nakamura',
      unitId: 'unit-b',
      unitName: 'Unit B · Living unit',
      date: '2026-11-20',
      startAt: '2026-11-20T07:00:00-06:00',
      endAt: '2026-11-20T15:00:00-06:00',
      shiftTemplate: 'D8',
      worked: false,
      needsActual: false,
      absence: 'VACATION',
    };
    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([vacation]);
    const record = vi.spyOn(api, 'recordActual').mockResolvedValue({
      entry: vacation,
      payCodes: [],
      periodHours: 0,
    });
    const user = userEvent.setup();

    renderScreen();

    await user.click(
      await screen.findByRole('button', { name: 'Vac · Tara Nakamura on 2026-11-20 · change' }),
    );
    expect(await screen.findByLabelText('Absence type')).toHaveValue('VACATION');
    await user.selectOptions(screen.getByLabelText('Absence type'), 'SICK');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('assignment-vac', {
        workedAsScheduled: false,
        absence: 'SICK',
      }),
    );
    vi.restoreAllMocks();
  });

  it('records and reopens the Other absence code (FR-51)', async () => {
    // S8: the api accepts SICK, VACATION and OTHER; the panel offered two.
    const planned: TimeEntry = {
      assignmentId: 'assignment-other',
      employeeId: 'emp-tara',
      employeeName: 'Tara Nakamura',
      unitId: 'unit-b',
      unitName: 'Unit B · Living unit',
      date: '2026-11-20',
      startAt: '2026-11-20T07:00:00-06:00',
      endAt: '2026-11-20T15:00:00-06:00',
      shiftTemplate: 'D8',
      worked: false,
      needsActual: false,
      absence: 'OTHER',
    };
    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([planned]);
    const record = vi.spyOn(api, 'recordActual').mockResolvedValue({
      entry: planned,
      payCodes: [],
      periodHours: 0,
    });
    const user = userEvent.setup();

    renderScreen();

    await user.click(
      await screen.findByRole('button', { name: 'Other · Tara Nakamura on 2026-11-20 · change' }),
    );
    const type = await screen.findByLabelText('Absence type');
    expect(type).toHaveValue('OTHER');
    expect(
      within(type).getAllByRole('option').map((option) => option.getAttribute('value')),
    ).toEqual(['SICK', 'VACATION', 'OTHER']);
    expect(screen.getByText('Will record: absent (other), no hours.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('assignment-other', {
        workedAsScheduled: false,
        absence: 'OTHER',
      }),
    );
    vi.restoreAllMocks();
  });

  it('counts no hours as worked until an actual is recorded', async () => {
    // V3: a future period read "Worked h 2304 recorded" because the page used
    // the planned times when no actual existed.
    const planned: TimeEntry = {
      assignmentId: 'assignment-planned',
      employeeId: 'emp-tara',
      employeeName: 'Tara Nakamura',
      unitId: 'unit-b',
      unitName: 'Unit B · Living unit',
      date: '2026-11-20',
      startAt: '2026-11-20T07:00:00-06:00',
      endAt: '2026-11-20T15:00:00-06:00',
      shiftTemplate: 'D8',
      worked: false,
      needsActual: false,
    };
    expect(workedOf(planned)).toBe(0);
    expect(
      workedOf({ ...planned, actualStart: planned.startAt, actualEnd: planned.endAt }),
    ).toBe(8);

    vi.spyOn(api, 'getTimeEntries').mockResolvedValue([planned]);

    renderScreen();

    await screen.findByText('Tara Nakamura');
    const tile = screen.getByText('Worked h').closest('div') as HTMLElement;
    expect(within(tile).getByText('0')).toBeInTheDocument();
    const scheduled = screen.getByText('Scheduled h').closest('div') as HTMLElement;
    expect(within(scheduled).getByText('8')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
