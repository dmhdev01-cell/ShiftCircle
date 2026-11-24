/**
 * A3: find, filter and sort the officers already on the board. Nothing here
 * asks the API for more: every filter reads the rows `GET /schedule` sent.
 *
 * The defaults (no search, every filter "All", the board's own order) leave
 * the board exactly as it was, so demo §2 is unchanged.
 */

import { shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow, OvertimeStatus, ShiftItem } from '../api/types';
import { countsTowardTotals, shiftHours } from './rosterView';

export type OvertimeFilter = 'all' | OvertimeStatus;
export type RotationKind = '8h' | '12h' | 'casual';
export type RotationFilter = 'all' | RotationKind;
export type WorksBlock = 'D' | 'E' | 'N';
export type WorksFilter = 'all' | WorksBlock;
export type RosterSort = 'board' | 'hours-asc' | 'hours-desc' | 'name' | 'rotation';

export interface RosterFilterState {
  /** Part of an officer's name, any case. */
  query: string;
  overtime: OvertimeFilter;
  rotation: RotationFilter;
  works: WorksFilter;
  /** A qualification code (CONTROL, ESCORT, FIRST_AID) or 'all'. */
  qualification: string;
  sort: RosterSort;
}

export const DEFAULT_FILTERS: RosterFilterState = {
  query: '',
  overtime: 'all',
  rotation: 'all',
  works: 'all',
  qualification: 'all',
  sort: 'board',
};

export const OVERTIME_OPTIONS: { id: OvertimeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'IN_OVERTIME', label: 'In overtime' },
  { id: 'APPROACHING', label: 'Approaching' },
  { id: 'UNDER', label: 'Under' },
];

export const ROTATION_OPTIONS: { id: RotationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: '8h', label: '8 h' },
  { id: '12h', label: '12 h' },
  { id: 'casual', label: 'Casual' },
];

export const WORKS_OPTIONS: { id: WorksFilter; label: string }[] = [
  { id: 'all', label: 'Any shift' },
  { id: 'D', label: 'Days' },
  { id: 'E', label: 'Evenings' },
  { id: 'N', label: 'Nights' },
];

export const SORT_OPTIONS: { id: RosterSort; label: string }[] = [
  { id: 'board', label: 'Board order' },
  { id: 'hours-asc', label: 'Pay-period hours, lowest first' },
  { id: 'hours-desc', label: 'Pay-period hours, highest first' },
  { id: 'name', label: 'Name, A to Z' },
  { id: 'rotation', label: 'Rotation (8 h, 12 h, casual)' },
];

/** The address keys, kept short; a default value is never written. */
const PARAM: Record<keyof RosterFilterState, string> = {
  query: 'q',
  overtime: 'ot',
  rotation: 'rot',
  works: 'works',
  qualification: 'qual',
  sort: 'sort',
};

function pick<T extends string>(value: string | null, options: { id: T }[], fallback: T): T {
  return options.find((option) => option.id === value)?.id ?? fallback;
}

/** Read the filters from the address; anything unknown is its default. */
export function parseFilters(params: URLSearchParams): RosterFilterState {
  const qualification = params.get(PARAM.qualification);
  return {
    query: params.get(PARAM.query) ?? '',
    overtime: pick(params.get(PARAM.overtime), OVERTIME_OPTIONS, 'all'),
    rotation: pick(params.get(PARAM.rotation), ROTATION_OPTIONS, 'all'),
    works: pick(params.get(PARAM.works), WORKS_OPTIONS, 'all'),
    qualification: qualification && /^[A-Z_]+$/.test(qualification) ? qualification : 'all',
    sort: pick(params.get(PARAM.sort), SORT_OPTIONS, 'board'),
  };
}

/** Write the filters into a copy of the address, dropping every default. */
export function writeFilters(params: URLSearchParams, filters: RosterFilterState): URLSearchParams {
  const next = new URLSearchParams(params);
  (Object.keys(PARAM) as (keyof RosterFilterState)[]).forEach((key) => {
    const value = filters[key];
    if (value === DEFAULT_FILTERS[key] || value === '') next.delete(PARAM[key]);
    else next.set(PARAM[key], value);
  });
  return next;
}

/** True when any filter narrows the rows (the sort does not count). */
export function isFiltered(filters: RosterFilterState): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.overtime !== 'all' ||
    filters.rotation !== 'all' ||
    filters.works !== 'all' ||
    filters.qualification !== 'all'
  );
}

function countedShifts(officer: OfficerRow): ShiftItem[] {
  return officer.cells
    .flatMap((cell) => cell.items)
    .filter((item): item is ShiftItem => item.type === 'SHIFT' && countsTowardTotals(item));
}

/**
 * The block a shift belongs to, from its template's start time: a start from
 * 05:00 to before 11:00 is a day (D8, D12), from 11:00 to before 19:00 an
 * evening (E8, P12), anything else a night (N8, N12, A12, L16).
 */
export function blockOfShift(item: ShiftItem): WorksBlock | null {
  const start = shiftTemplates[item.shiftTemplate]?.start;
  if (!start) return null;
  const hour = Number(start.slice(0, 2));
  if (hour >= 5 && hour < 11) return 'D';
  if (hour >= 11 && hour < 19) return 'E';
  return 'N';
}

/** The blocks an officer works in the days on screen. */
export function worksBlocks(officer: OfficerRow): Set<WorksBlock> {
  const blocks = new Set<WorksBlock>();
  for (const item of countedShifts(officer)) {
    const block = blockOfShift(item);
    if (block) blocks.add(block);
  }
  return blocks;
}

/**
 * An officer's rotation: from the rotation text when it names one ("8 h ·
 * Control", "12 h · …", a casual or part-time pattern), else from the shifts
 * on screen (mostly 12 h shifts is a 12 h rotation, otherwise 8 h). The live
 * board sends no rotation text today, so it is read from the shifts there.
 * null when there is nothing to tell from.
 */
export function rotationKind(officer: OfficerRow): RotationKind | null {
  const text = officer.rotation ?? '';
  if (/casual|part[- ]?time|relief/i.test(text)) return 'casual';
  if (/(^|\D)12\s?h/i.test(text)) return '12h';
  if (/(^|\D)8\s?h/i.test(text)) return '8h';
  const shifts = countedShifts(officer);
  if (shifts.length === 0) return null;
  const long = shifts.filter((item) => shiftHours(item) >= 12).length;
  return long * 2 > shifts.length ? '12h' : '8h';
}

export function rotationLabel(kind: RotationKind | null): string {
  if (kind === '8h') return '8 h';
  if (kind === '12h') return '12 h';
  if (kind === 'casual') return 'Casual';
  return '';
}

function matches(officer: OfficerRow, filters: RosterFilterState): boolean {
  const query = filters.query.trim().toLocaleLowerCase('en-CA');
  if (query && !officer.name.toLocaleLowerCase('en-CA').includes(query)) return false;
  if (filters.overtime !== 'all' && officer.overtimeStatus !== filters.overtime) return false;
  if (filters.rotation !== 'all' && rotationKind(officer) !== filters.rotation) return false;
  if (filters.works !== 'all' && !worksBlocks(officer).has(filters.works)) return false;
  if (filters.qualification !== 'all' && !(officer.qualifications ?? []).includes(filters.qualification)) {
    return false;
  }
  return true;
}

const ROTATION_ORDER: Record<string, number> = { '8h': 0, '12h': 1, casual: 2 };

function byName(a: OfficerRow, b: OfficerRow): number {
  return a.name.localeCompare(b.name, 'en-CA');
}

/**
 * The rows to show, in order. 'board' keeps the API's order; every other sort
 * breaks a tie by name, so the order is stable from one load to the next.
 */
export function applyRosterFilters(officers: OfficerRow[], filters: RosterFilterState): OfficerRow[] {
  const shown = officers.filter((officer) => matches(officer, filters));
  switch (filters.sort) {
    case 'hours-asc':
      return [...shown].sort((a, b) => a.payPeriodHours - b.payPeriodHours || byName(a, b));
    case 'hours-desc':
      return [...shown].sort((a, b) => b.payPeriodHours - a.payPeriodHours || byName(a, b));
    case 'name':
      return [...shown].sort(byName);
    case 'rotation':
      return [...shown].sort(
        (a, b) =>
          (ROTATION_ORDER[rotationKind(a) ?? ''] ?? 3) - (ROTATION_ORDER[rotationKind(b) ?? ''] ?? 3) ||
          byName(a, b),
      );
    default:
      return shown;
  }
}

/** "near or under 80 h, works nights": the active filters, in words. */
export function filterWords(filters: RosterFilterState, qualificationLabel: (code: string) => string): string {
  const words: string[] = [];
  if (filters.query.trim()) words.push(`name has "${filters.query.trim()}"`);
  if (filters.overtime !== 'all') {
    words.push(OVERTIME_OPTIONS.find((option) => option.id === filters.overtime)!.label.toLowerCase());
  }
  if (filters.rotation !== 'all') {
    words.push(`${ROTATION_OPTIONS.find((option) => option.id === filters.rotation)!.label} rotation`);
  }
  if (filters.works !== 'all') {
    words.push(`works ${WORKS_OPTIONS.find((option) => option.id === filters.works)!.label.toLowerCase()}`);
  }
  if (filters.qualification !== 'all') words.push(qualificationLabel(filters.qualification));
  return words.join(', ');
}
