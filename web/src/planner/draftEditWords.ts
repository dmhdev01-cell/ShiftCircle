import { weekdayDateWords } from './unitDates';



/** The draft edit's words, shared by the shift and add dialogs (P8-SPEC §3). */
export const BLOCK_SENTENCE =
  "This change breaks a Block rule, so it can't go in the draft. Choose another officer or time, or leave the gap.";
export const STALE_SENTENCE =
  'The draft changed since you opened it (another tab or a regenerate). Reload the roster and try again.';
export const COMMITTED_SENTENCE =
  "This draft was committed or discarded, so it can't be changed. Reload the quarter plan.";
export const BUSY_SENTENCE =
  'The draft is busy (a reset or generate is running). Try again in a moment.';
export const SAVE_SENTENCE = 'The change could not be saved.';

/** "Mon 4 Jan" for a success or removal line. */
export function shortDateWords(date: string): string {
  return weekdayDateWords(date).replace(/ \d{4}$/, '');
}

/** "Draft changed: … . Scorecard updated." */
export function changedWords(
  officerName: string,
  unitName: string,
  date: string,
  code: string,
): string {
  return `Draft changed: ${officerName} · ${unitName} · ${shortDateWords(date)} · ${code}. Scorecard updated.`;
}

/** "Removed from the draft: … ." */
export function removedWords(
  officerName: string,
  unitName: string,
  date: string,
  code: string,
): string {
  return `Removed from the draft: ${officerName} · ${unitName} · ${shortDateWords(date)} · ${code}.`;
}
