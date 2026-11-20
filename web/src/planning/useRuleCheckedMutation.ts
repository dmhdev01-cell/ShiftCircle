import { useCallback, useState } from 'react';

import { api, ApiError } from '../api/client';
import type { ProblemDetails, RuleCheckChange, RuleCheckOutcome } from '../api/types';

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
      options?: { acknowledgeWarnings?: string[]; override?: { reason: string } },
    ) => {
      const acknowledged = options?.acknowledgeWarnings ?? [];
      setState((previous) => ({ ...previous, kind: 'checking' }));
      try {
        const result = await api.saveChange({
          change,
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
      } catch (error) {
        if (error instanceof ApiError && error.problem?.ruleResults) {
          setState({
            kind: 'ready',
            change,
            outcome: outcomeFromProblem(error.problem),
            acknowledged,
          });
          return;
        }
        setState((previous) => ({ ...previous, kind: 'error', message: messageOf(error) }));
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ kind: 'idle', acknowledged: [] }), []);

  return { state, preview, save, reset };
}
