/**
 * Qualification names, so the screens read "First aid" rather than
 * "FIRST_AID" (docs/09-access-control.md).
 */

export const qualificationNames: Record<string, string> = {
  CONTROL: 'Control',
  ESCORT: 'Escort',
  FIRST_AID: 'First aid',
};

/** The short form the compact roster shows, with the full name as its title. */
export const qualificationShortNames: Record<string, string> = {
  CONTROL: 'Ctl',
  ESCORT: 'Esc',
  FIRST_AID: 'FA',
};

export function qualificationLabel(code: string): string {
  return Object.hasOwn(qualificationNames, code) ? qualificationNames[code] : code;
}

export function qualificationShortLabel(code: string): string {
  return Object.hasOwn(qualificationShortNames, code) ? qualificationShortNames[code] : code;
}

/** The qualifications of an officer, in words. */
export function qualificationLabels(codes: string[]): string {
  return codes.map(qualificationLabel).join(', ');
}
