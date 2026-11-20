import { useCallback, useState } from 'react';

import { api, ApiError } from '../api/client';
import type {
  ProblemDetails,
  RuleCheckChange,
  RuleCheckOutcome,
  SaveOutcome,
} from '../api/types';

export interface SaveOptions {
  acknowledgeWarnings?: string[];
  override?: { reason: string };
}

export interface RuleCheckedState {
  kind: 'idle' | 'checking' | 'ready' | 'saved' | 'error';
  /** The change being previewed or saved. */
  change?: RuleCheckChange;
  /** The rule outcome. */
  outcome?: RuleCheckOutcome;
  /** The Warn rule codes the supervisor has acknowledged. */
  acknowledged: string[];
  /** The assignment the api created. */
  savedAs?: string;
  /** Why the call failed, when it did. */
  message?: string;
}

function outcomeFromProblem(problem: ProblemDetails): RuleCheckOutcome {
  return {
    outcome: problem.outcome ?? 'BLOCK',
    ruleSetVersion: problem.ruleSetVersion ?? 0,
    overridable: problem.overridable ?? false,
    ruleResults: problem.ruleResults ?? [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

/**
 * The preview -> save -> 422 -> acknowledge or override flow
 * (docs/07-api-spec.md §3), in one reusable hook.
 *
 * A blocked save answers 422 with the rule results in the Problem Details
 * body, so the same state that shows a preview shows a refusal. Nothing is
 * ever auto-approved: a Warn result has to be acknowledged and a Block result
 * has to be overridden with a written reason.
 */
/** The default way to save a change: POST the change to the api. */
const defaultSaver = (
  change: RuleCheckChange,
  options?: SaveOptions,
): Promise<SaveOutcome> =>
  api.saveChange({
    change,
    ...(options?.acknowledgeWarnings ? { acknowledgeWarnings: options.acknowledgeWarnings } : {}),
    ...(options?.override ? { override: options.override } : {}),
  });

export function useRuleCheckedMutation() {
  const [state, setState] = useState<RuleCheckedState>({ kind: 'idle', acknowledged: [] });

  const preview = useCallback(async (change: RuleCheckChange) => {
    setState({ kind: 'checking', change, acknowledged: [] });
    try {
      const outcome = await api.previewRuleCheck({ change });
      setState({ kind: 'ready', change, outcome, acknowledged: [] });
    } catch (error) {
      if (error instanceof ApiError && error.problem?.ruleResults) {
        setState({
          kind: 'ready',
          change,
          outcome: outcomeFromProblem(error.problem),
          acknowledged: [],
        });
        return;
      }
      setState({ kind: 'error', acknowledged: [], message: messageOf(error) });
    }
  }, []);

  const save = useCallback(
    async (
      change: RuleCheckChange,
      options?: SaveOptions,
      /**
       * A different way to save the same change, for example assigning an
       * open shift instead of creating an assignment.
       */
      saver?: (change: RuleCheckChange, options?: SaveOptions) => Promise<SaveOutcome>,
    ): Promise<boolean> => {
      const acknowledged = options?.acknowledgeWarnings ?? [];
      setState((previous) => ({ ...previous, kind: 'checking' }));
      try {
        const save = saver ?? defaultSaver;
        const result = await save(change, {
          ...(options?.acknowledgeWarnings ? { acknowledgeWarnings: options.acknowledgeWarnings } : {}),
          ...(options?.override ? { override: options.override } : {}),
        });
        setState({
          kind: 'saved',
          change,
          outcome: result.ruleOutcome,
          acknowledged,
          savedAs: result.assignmentId,
        });
        // The caller reloads what it shows: a saved change has moved the board.
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.problem?.ruleResults) {
          setState({
            kind: 'ready',
            change,
            outcome: outcomeFromProblem(error.problem),
            acknowledged,
          });
          return false;
        }
        setState((previous) => ({ ...previous, kind: 'error', message: messageOf(error) }));
        return false;
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ kind: 'idle', acknowledged: [] }), []);

  return { state, preview, save, reset };
}
