import type { RuleTableRow } from '../api/types';

/**
 * The plain-language sentence for a rule row.
 *
 * The api sends the sentence with the row (docs/07-api-spec.md §4.7); this
 * composes the same wording from the values so the panel can update as the
 * admin types, before the draft is saved.
 */
export function composeSentence(row: RuleTableRow): string {
  const hours = row.minHours;
  const after = row.after;

  if (row.result === 'INFO') {
    return `${after} is ${hours} h. It is recorded for the audit trail and never blocks an assignment.`;
  }

  const what =
    row.result === 'BLOCK'
      ? 'the assignment is blocked'
      : 'the supervisor is warned and has to acknowledge it';

  const override =
    row.override === 'EMERGENCY'
      ? ', and a supervisor may override it in an emergency'
      : row.override === 'ACKNOWLEDGE'
        ? ', and the supervisor has to acknowledge it'
        : '';

  return `After ${after.toLowerCase()}, an officer needs at least ${hours} hours off. If they do not get it, ${what}${override}.`;
}

/** The sentence to show: the one the api sent, or the composed one. */
export function sentenceFor(row: RuleTableRow, edited: boolean): string {
  return edited ? composeSentence(row) : row.sentence;
}
