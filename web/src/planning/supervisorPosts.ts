/**
 * v1.3 S6: supervisor posts on the planning board. A post is a unit of kind
 * SUPERVISION (SUP-L, SUP-O) with 1 supervisor per block; it reuses the
 * board, coverage and rule check as they are. These helpers keep the wording
 * in one place: an officers-only board reads exactly as before.
 */

import type { Block, OfficerRow, SchedulePayload, Unit } from '../api/types';

export const SUPERVISION = 'SUPERVISION';

/**
 * The position codes (docs/06 `position`). The board sends `supervisory` from
 * the position table; CS is only the fallback for a payload without it.
 */
export const SUPERVISOR = 'CS';
export const OFFICER = 'CO';

/** The qualification that lets an officer act up on a supervisor post (R-01 then warns). */
export const ACTING_SUP = 'ACTING_SUP';

export function isSupervisorPost(unit: { kind?: string | undefined } | undefined): boolean {
  return unit?.kind === SUPERVISION;
}

export function isSupervisor(officer: Pick<OfficerRow, 'position' | 'supervisory'>): boolean {
  return officer.supervisory ?? officer.position === SUPERVISOR;
}

/** An officer (not a supervisor) who holds Acting supervisor. */
export function isActingOfficer(officer: Pick<OfficerRow, 'position' | 'supervisory' | 'qualifications'>): boolean {
  return !isSupervisor(officer) && (officer.qualifications ?? []).includes(ACTING_SUP);
}

/**
 * The position to name beside a person, only where it matters: a supervisor
 * anywhere, and an officer on a supervisor post. Null on an officers-only
 * board, so its words are unchanged.
 */
export function positionTag(
  officer: Pick<OfficerRow, 'position' | 'supervisory'>,
  unit: { kind?: string | undefined } | undefined,
): 'supervisor' | 'officer' | null {
  if (isSupervisor(officer)) return 'supervisor';
  if (isSupervisorPost(unit) && officer.position !== undefined) return 'officer';
  return null;
}

/** "Morgan Ellis (supervisor)", or the name alone on an officers-only board. */
export function nameWithPosition(
  officer: Pick<OfficerRow, 'name' | 'position' | 'supervisory'>,
  unit: { kind?: string | undefined } | undefined,
): string {
  const tag = positionTag(officer, unit);
  return tag ? `${officer.name} (${tag})` : officer.name;
}

/**
 * The gap-fill pool for the board's unit (Q1, R-01/R-02): a supervisor post
 * lists supervisors, then officers who hold Acting supervisor (a warning to
 * acknowledge); a line unit lists officers only, because a supervisor there
 * is R-02's warning and is assigned from their row on purpose. A row with no
 * position (an older payload) counts as an officer.
 */
export function inGapPool(
  officer: Pick<OfficerRow, 'position' | 'supervisory' | 'qualifications'>,
  unit: { kind?: string | undefined } | undefined,
): boolean {
  if (isSupervisorPost(unit)) return isSupervisor(officer) || isActingOfficer(officer);
  return !isSupervisor(officer);
}

/** "M. Ellis" from "Morgan Ellis": the on-duty line is narrow. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`;
}

/** The supervisors on duty for one block of one day, or undefined when the board has none. */
export function onDuty(
  payload: Pick<SchedulePayload, 'supervisorsOnDuty'>,
  date: string,
  block: Block,
): string[] | undefined {
  return payload.supervisorsOnDuty?.find((entry) => entry.date === date && entry.block === block)
    ?.names;
}

/** The unit picker's groups: line units, then the supervisor posts after them. */
export function unitGroups(units: Unit[]): { line: Unit[]; posts: Unit[] } {
  return {
    line: units.filter((unit) => !isSupervisorPost(unit)),
    posts: units.filter((unit) => isSupervisorPost(unit)),
  };
}

/**
 * The self-edit refusal, word for word as the api's 403 says it (release v1.3
 * S4, SelfActionGuard). The board row and the gap panel both show it, after
 * "This is you.", so one rule reads one way everywhere.
 */
export const SELF_EDIT_REFUSAL = "You can't change your own schedule; ask another supervisor.";
export const SELF_NOTE = `This is you. ${SELF_EDIT_REFUSAL}`;
