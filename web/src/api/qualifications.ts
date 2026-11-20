/**
 * Qualification names, so the screens read "First aid" rather than
 * "FIRST_AID" (docs/09-access-control.md).
 */

export const qualificationNames: Record<string, string> = {
  CONTROL: 'Control',
  ESCORT: 'Escort',
  FIRST_AID: 'First aid',
};

export function qualificationLabel(code: string): string {
  return qualificationNames[code] ?? code;
}

/** The qualifications of an officer, in words. */
export function qualificationLabels(codes: string[]): string {
  return codes.map(qualificationLabel).join(', ');
}
