import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import { AppShellRoutes } from '../App';
// The route is lazy: importing the module here means React.lazy resolves it from
// memory, so the waits below are event-loop turns and never file IO.
import './WallDisplayPage';
import { api, ApiError } from '../api/client';
import { demoDisplayToday } from '../api/fixtures/display';
import { demoSchedule } from '../api/fixtures/schedule';
import { createHttpApi } from '../api/http';
import { RoleProvider } from '../shell/nav';
import { theme } from '../theme/theme';
import { toDisplayToday } from './displayPayload';
import { REFRESH_MS, STALE_AFTER_MS } from './displayTime';

/** The real (unfaked) event-loop turn; the web tsconfig has no Node types. */
const nextTurn = () =>
  new Promise<void>((resolve) =>
    (globalThis as unknown as { setImmediate: (callback: () => void) => void }).setImmediate(resolve),
  );

/** 14:32 in Regina (UTC-6, no daylight saving): the day block. */
const DAY_TIME = new Date('2026-11-19T20:32:00Z');
/** 20:00 in Regina: the evening block, when Unit C is short. */
const EVENING_TIME = new Date('2026-11-20T02:00:00Z');

function renderDisplay() {
  return render(
    <ThemeProvider theme={theme}>
      <RoleProvider>
        <MemoryRouter initialEntries={['/display']}>
          <AppShellRoutes />
        </MemoryRouter>
      </RoleProvider>
    </ThemeProvider>,
  );
}

/** Lets the lazy route, the first fetch and any timers due by then run. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function startAt(time: Date) {
  // Only the timers and the clock are fake, so the lazy route module can still load.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(time);
}

/**
 * Waits for the lazy route and its first answer.
 *
 * Counted in event-loop turns, not seconds on a clock: the lazy module and the
 * first fetch need a number of turns, and how long those turns take is the
 * machine's business. A wall-clock deadline here spun hot for its full 10 s on a
 * loaded host and then failed a test that would have passed a moment later.
 */
const ROUTE_TURNS = 100;

async function firstLoad() {
  for (let turn = 0; turn < ROUTE_TURNS; turn += 1) {
    if (screen.queryByRole('heading', { name: "Today's coverage" })) {
      // The route is up; let the first answer land, then read the screen.
      await advance(500);
      return;
    }
    await act(async () => {
      await nextTurn();
    });
  }
  throw new Error('The wall display route never loaded.');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Names, employee numbers and ids planted where a careless api might put them. */
const HOSTILE_STRINGS = ['Nia Thompson', 'Ruth Okafor', 'Tara Nakamura', 'E-0042', 'emp-7f3a'];

function hostilePayload() {
  const base = demoDisplayToday(null) as unknown as Record<string, unknown>;
  const units = (base.units as Record<string, unknown>[]).map((unit, index) => ({
    ...unit,
    supervisorName: 'Ruth Okafor',
    coverage: (unit.coverage as Record<string, unknown>[]).map((block) => ({
      ...block,
      onDuty: [{ displayName: 'Tara Nakamura', employeeNo: 'E-0042', employeeId: 'emp-7f3a' }],
      scheduled: { ...(block.scheduled as object), names: ['Nia Thompson'] },
    })),
    ...(index === 0 ? { officers: [{ name: 'Nia Thompson' }] } : {}),
  }));
  return { ...base, units, officersInOvertime: [{ name: 'Nia Thompson', employeeNo: 'E-0042' }] };
}

describe('displayPayload whitelist', () => {
  it('keeps the counts and drops every field the contract does not name', () => {
    const cleaned = toDisplayToday(hostilePayload());
    const json = JSON.stringify(cleaned);
    for (const value of HOSTILE_STRINGS) {
      expect(json, value).not.toContain(value);
    }
    expect(cleaned.units).toHaveLength(6);
    expect(cleaned.units[2].coverage[1]).toEqual({
      block: 'EVENING',
      required: 4,
      scheduled: { lowestHourly: 3, shortHours: [{ from: '19:00', to: '23:00', count: 3 }], maxHourly: 4 },
      actual: null,
      covered: false,
    });
  });

  it('refuses a payload that is not the contract shape, rather than guessing', () => {
    expect(() => toDisplayToday({ asOf: '2026-11-19', units: 'none' })).toThrow(/expected shape/);
    expect(() =>
      toDisplayToday({ ...demoDisplayToday(null), totalOpenShifts: -1 }),
    ).toThrow(/total open shifts/);
  });
});

describe('leaving the wall display', () => {
  it('offers a supervisor a visible exit that lands on their board', async () => {
    // Observation #7: the only way out was small light-blue text at the end of
    // the footer line, which the person could not find.
    startAt(DAY_TIME);
    renderDisplay();
    await firstLoad();

    const exit = screen.getByRole('button', { name: 'Exit wall display' });
    expect(exit).toBeVisible();

    // A direct click: the page's clock is fake, so user-event's timers would
    // never fire.
    await act(async () => {
      exit.click();
    });
    // The display is gone; real timers let the next screen settle.
    vi.useRealTimers();
    expect(await screen.findByRole('heading', { name: 'Planning board', level: 1 })).toBeInTheDocument();
  });

  it('leaves on Escape', async () => {
    startAt(DAY_TIME);
    renderDisplay();
    await firstLoad();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    vi.useRealTimers();
    expect(await screen.findByRole('heading', { name: 'Planning board', level: 1 })).toBeInTheDocument();
  });

  it('gives the unit-office TV no way out by design', async () => {
    startAt(DAY_TIME);
    const { setActingUser } = await import('../api/session');
    const displayUser = (await import('../api/fixtures/demoUsers')).demoUsers.find((user) =>
      user.roles.includes('DISPLAY'),
    );
    setActingUser(displayUser ?? null);

    renderDisplay();
    await firstLoad();

    expect(screen.queryByRole('button', { name: 'Exit wall display' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeInTheDocument();
  });
});

describe('Wall display', () => {
  it('shows each unit with counts for the current block, and the facility totals', async () => {
    startAt(DAY_TIME);
    renderDisplay();
    await firstLoad();

    expect(screen.getByRole('heading', { name: "Today's coverage", level: 1 })).toBeInTheDocument();
    expect(screen.getByText('14:32')).toBeInTheDocument();
    expect(screen.getByText(/Thursday 19 November 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Days block 07:00 – 15:00/)).toBeInTheDocument();

    const units = ['Unit A · Living unit', 'Unit B · Living unit', 'Unit C · Living unit', 'Admissions', 'Control', 'Escort & transport'];
    for (const name of units) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    const unitA = screen.getByRole('region', { name: 'Unit A · Living unit' });
    expect(within(unitA).getByText('5 / 5')).toBeInTheDocument();
    expect(within(unitA).getByText('Covered')).toBeInTheDocument();
    const escort = screen.getByRole('region', { name: 'Escort & transport' });
    expect(within(escort).getByText('+1 extra')).toBeInTheDocument();

    const facility = screen.getByRole('region', { name: 'Facility today' });
    expect(within(facility).getByText('Open shifts today').nextSibling).toHaveTextContent('2');
    expect(within(facility).getByText('On overtime this pay period').nextSibling).toHaveTextContent('4');

    expect(screen.getByText(/updated 14:32/)).toBeInTheDocument();
    expect(screen.getByText('Shared screen: counts only, no names')).toBeInTheDocument();
    expect(
      screen.getByText('Not an official Government of Saskatchewan service · fictional, synthetic data only'),
    ).toBeInTheDocument();
    expect(screen.getByText('Demo fixtures')).toBeInTheDocument();
  });

  it('says a shortfall in words and an icon, not colour alone', async () => {
    startAt(EVENING_TIME);
    renderDisplay();
    await firstLoad();

    const unitC = screen.getByRole('region', { name: 'Unit C · Living unit' });
    expect(within(unitC).getByText('3 / 4')).toBeInTheDocument();
    // Words and an icon in the pill, not colour alone.
    const pill = within(unitC).getByText('Short 1 · 19:00 – 23:00');
    expect(pill.querySelector('svg')).not.toBeNull();
    const facility = screen.getByRole('region', { name: 'Facility today' });
    expect(within(facility).getByText('Units short right now').nextSibling).toHaveTextContent('1');
  });

  it('refreshes every 60 seconds', async () => {
    startAt(DAY_TIME);
    const spy = vi.spyOn(api, 'getDisplayToday');
    renderDisplay();
    await firstLoad();
    expect(spy).toHaveBeenCalledTimes(1);

    await advance(REFRESH_MS);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/updated 14:33/)).toBeInTheDocument();
  });

  it('says loudly when the api cannot be reached, and stops calling the old counts live', async () => {
    startAt(DAY_TIME);
    const spy = vi.spyOn(api, 'getDisplayToday');
    renderDisplay();
    await firstLoad();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    spy.mockRejectedValue(new ApiError('Could not reach the API.', 0));
    await advance(REFRESH_MS);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Not live: no update since 14:32. These counts may be out of date.');
    const unitA = screen.getByRole('region', { name: 'Unit A · Living unit' });
    expect(within(unitA).getByText('Last known: Covered')).toBeInTheDocument();
    expect(within(unitA).queryByText('Covered')).not.toBeInTheDocument();
    // Old per-block detail is hidden, the totals say they are last known, and no browser jargon reaches the TV.
    expect(within(unitA).queryByText(/Evenings 15:00/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Facility today · last known' })).toBeInTheDocument();
    expect(alert).not.toHaveTextContent('Could not reach the API');
    expect(screen.getByText(/updated 14:32 · not live/)).toBeInTheDocument();

    // When the api is back, the next refresh is live again.
    spy.mockRestore();
    await advance(REFRESH_MS);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/updated 14:34$/)).toBeInTheDocument();
  });

  it('goes stale when a refresh hangs, even without an error', async () => {
    startAt(DAY_TIME);
    const spy = vi.spyOn(api, 'getDisplayToday');
    renderDisplay();
    await firstLoad();

    spy.mockImplementation(() => new Promise(() => undefined));
    await advance(STALE_AFTER_MS - 1_000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await advance(2_000);
    expect(screen.getByRole('alert')).toHaveTextContent('no update since 14:32');
  });

  it('shows no numbers at all when the first load fails', async () => {
    startAt(DAY_TIME);
    vi.spyOn(api, 'getDisplayToday').mockRejectedValue(new ApiError('Could not reach the API.', 0));
    renderDisplay();
    await firstLoad();

    expect(screen.getByRole('alert')).toHaveTextContent("Not updating: can't reach ShiftCircle.");
    expect(screen.queryByRole('region', { name: 'Unit A · Living unit' })).not.toBeInTheDocument();
    expect(screen.getByText(/not updated yet/)).toBeInTheDocument();
  });

  it('shows no name, employee number or id even when the api sends them', async () => {
    startAt(DAY_TIME);
    // The real http client, fed a hostile body, behind the page.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => hostilePayload() })),
    );
    const http = createHttpApi();
    vi.spyOn(api, 'getDisplayToday').mockImplementation(() => http.getDisplayToday());
    const { container } = renderDisplay();
    await firstLoad();

    expect(screen.getByRole('region', { name: 'Unit C · Living unit' })).toBeInTheDocument();
    for (const value of HOSTILE_STRINGS) {
      expect(container.innerHTML, value).not.toContain(value);
    }
    // And none of the fixture roster's officers either.
    for (const officer of demoSchedule.officers) {
      expect(container.innerHTML, officer.name).not.toContain(officer.name);
    }
  });

  it('says a closed unit is closed today instead of showing counts', async () => {
    startAt(DAY_TIME);
    vi.spyOn(api, 'getDisplayToday').mockResolvedValue({
      asOf: '2026-11-19',
      generatedAt: '2026-11-19T20:32:00Z',
      totalOpenShifts: 0,
      totalOfficersInOvertime: 0,
      units: [
        {
          unit: { id: 'unit-c', name: 'Unit C · Living unit' },
          coverage: [],
          openShifts: 0,
          officersInOvertime: 0,
          closedToday: true,
          closedNote: 'No reopening date is set.',
        },
      ],
    });
    renderDisplay();
    await firstLoad();
    expect(screen.getByText('Unit C is closed today')).toBeInTheDocument();
    expect(screen.getByText('No reopening date is set.')).toBeInTheDocument();
  });

  it('renders the closed wording through the real payload mapper', async () => {
    startAt(DAY_TIME);
    const mapped = toDisplayToday({
      asOf: '2026-11-19',
      generatedAt: '2026-11-19T20:32:00Z',
      totalOpenShifts: 0,
      totalOfficersInOvertime: 0,
      units: [
        {
          unit: { id: 'unit-b', name: 'Unit B · Living unit' },
          coverage: [],
          openShifts: 0,
          officersInOvertime: 0,
          closedToday: true,
          closedNote: 'No reopening date is set.',
        },
      ],
    });
    vi.spyOn(api, 'getDisplayToday').mockResolvedValue(mapped);
    renderDisplay();
    await firstLoad();
    expect(screen.getByText('Unit B is closed today')).toBeInTheDocument();
    expect(screen.getByText('No reopening date is set.')).toBeInTheDocument();
  });
});
