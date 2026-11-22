import type {
  Block,
  DisplayBlock,
  DisplayToday,
  DisplayUnit,
  HourlyCoverage,
  ShortHourRange,
} from '../api/types';

/**
 * Builds the wall display's data from whatever the api sent, copying only the
 * fields the screen is allowed to show.
 *
 * The display is a shared screen, so it must never show a name, an employee
 * number or an id (docs/07 §4.8, docs/10 E5). The api already promises that.
 * This is the second lock: if a field is ever added to the payload, it is
 * dropped here rather than reaching the page. Anything malformed throws, so the
 * screen shows an error instead of guessing.
 */

const BLOCKS: readonly Block[] = ['DAY', 'EVENING', 'NIGHT'];

class DisplayPayloadError extends Error {
  constructor(what: string) {
    super(`The wall display data was not in the expected shape (${what}).`);
    this.name = 'DisplayPayloadError';
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DisplayPayloadError(what);
  }
  return value as Record<string, unknown>;
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DisplayPayloadError(what);
  }
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new DisplayPayloadError(what);
  }
  return value;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new DisplayPayloadError(what);
  }
  return value;
}

function hourLabel(value: unknown, what: string): string {
  const label = text(value, what);
  if (!/^\d{2}:\d{2}$/.test(label)) {
    throw new DisplayPayloadError(what);
  }
  return label;
}

function shortHour(value: unknown): ShortHourRange {
  const raw = record(value, 'short hours');
  return {
    from: hourLabel(raw.from, 'short hours from'),
    to: hourLabel(raw.to, 'short hours to'),
    count: count(raw.count, 'short hours count'),
  };
}

function hourly(value: unknown, what: string): HourlyCoverage {
  const raw = record(value, what);
  const coverage: HourlyCoverage = {
    lowestHourly: count(raw.lowestHourly, `${what} lowest`),
    shortHours: list(raw.shortHours, `${what} short hours`).map(shortHour),
  };
  if (raw.maxHourly !== undefined) {
    coverage.maxHourly = count(raw.maxHourly, `${what} highest`);
  }
  return coverage;
}

function block(value: unknown): DisplayBlock {
  const raw = record(value, 'block');
  const name = text(raw.block, 'block name');
  if (!BLOCKS.includes(name as Block)) {
    throw new DisplayPayloadError(`block name ${name}`);
  }
  if (typeof raw.covered !== 'boolean') {
    throw new DisplayPayloadError('covered');
  }
  return {
    block: name as Block,
    required: count(raw.required, 'required'),
    scheduled: hourly(raw.scheduled, 'scheduled'),
    actual: raw.actual === null || raw.actual === undefined ? null : hourly(raw.actual, 'actual'),
    covered: raw.covered,
  };
}

function unit(value: unknown): DisplayUnit {
  const raw = record(value, 'unit');
  const ref = record(raw.unit, 'unit reference');
  return {
    unit: { id: text(ref.id, 'unit id'), name: text(ref.name, 'unit name') },
    coverage: list(raw.coverage, 'coverage').map(block),
    openShifts: count(raw.openShifts, 'open shifts'),
    officersInOvertime: count(raw.officersInOvertime, 'officers in overtime'),
    // Release 3: the wall must not drop the closed state (a gate finding).
    closedToday: raw.closedToday === true,
    closedNote:
      raw.closedNote === null || raw.closedNote === undefined
        ? null
        : text(raw.closedNote, 'closed note'),
  };
}

export function toDisplayToday(value: unknown): DisplayToday {
  const raw = record(value, 'payload');
  const asOf = text(raw.asOf, 'asOf');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new DisplayPayloadError('asOf');
  }
  return {
    asOf,
    generatedAt: text(raw.generatedAt, 'generatedAt'),
    units: list(raw.units, 'units').map(unit),
    totalOpenShifts: count(raw.totalOpenShifts, 'total open shifts'),
    totalOfficersInOvertime: count(raw.totalOfficersInOvertime, 'total officers in overtime'),
  };
}
