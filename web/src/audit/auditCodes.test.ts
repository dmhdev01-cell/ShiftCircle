import { describe, expect, it } from 'vitest';

import {
  ACTION_LABELS,
  API_AUDIT_ACTIONS,
  API_AUDIT_ENTITIES,
  ENTITY_FILTER_CHOICES,
  ENTITY_LABELS,
} from './auditCodes';
import { actionLabel, entityLabel } from './auditText';

/**
 * The audit screen must have plain words for every code the api writes. The
 * api's codes live in api/src/main/java; scripts/check-audit-codes.sh compares
 * this list with the api sources, and these tests keep the labels and the
 * filter choices in step with the list.
 */
describe('the audit codes', () => {
  it('has a label for every action code the api writes', () => {
    for (const code of API_AUDIT_ACTIONS) {
      expect(ACTION_LABELS[code], `a label for ${code}`).toBeTruthy();
      expect(actionLabel(code)).not.toContain('Unknown action');
    }
  });

  it('has no label for an action the api does not write', () => {
    for (const code of Object.keys(ACTION_LABELS)) {
      expect(API_AUDIT_ACTIONS as readonly string[]).toContain(code);
    }
  });

  it('has a label for every entity type the api writes', () => {
    for (const entityType of API_AUDIT_ENTITIES) {
      expect(ENTITY_LABELS[entityType], `a label for ${entityType}`).toBeTruthy();
      expect(entityLabel(entityType)).not.toContain('Unknown entity');
    }
  });

  it('offers a filter choice for every entity type', () => {
    expect(ENTITY_FILTER_CHOICES.map((choice) => choice.value)).toEqual([
      ...API_AUDIT_ENTITIES,
    ]);
    for (const choice of ENTITY_FILTER_CHOICES) {
      expect(choice.label).toBe(ENTITY_LABELS[choice.value]);
    }
  });

  it('says a code is unknown rather than showing the raw code', () => {
    expect(actionLabel('a_code_the_api_does_not_write')).toBe(
      'Unknown action: a_code_the_api_does_not_write',
    );
    expect(entityLabel('an_entity_the_api_does_not_write')).toBe(
      'Unknown entity: an_entity_the_api_does_not_write',
    );
    expect(entityLabel(null)).toBe('—');
  });
});
