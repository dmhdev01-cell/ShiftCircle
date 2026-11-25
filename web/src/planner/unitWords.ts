/**
 * The six demo units and (release v1.3) the two supervisor posts by api code, for links and
 * warnings that carry a code.
 */
const UNIT_NAMES: Record<string, string> = {
  A: 'Unit A',
  B: 'Unit B',
  C: 'Unit C',
  ADM: 'Admissions',
  CTL: 'Control',
  ESC: 'Escort & transport',
  'SUP-L': 'Supervision · Living units',
  'SUP-O': 'Supervision · Operations',
};

export function unitWords(code: string): string {
  return UNIT_NAMES[code] ?? code;
}

/** A sentence from the api with unit codes ("ADM coverage gaps") in names. */
export function unitWordsIn(label: string): string {
  return Object.keys(UNIT_NAMES).reduce(
    (text, code) => text.replace(new RegExp(`\\b${code}\\b`, 'g'), unitWords(code)),
    label,
  );
}
