import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { OpenShift, OpenShiftCandidates } from '../api/types';

export type OpenShiftsState =
  | { kind: 'loading' }
  | { kind: 'ready'; shifts: OpenShift[] }
  | { kind: 'error'; message: string };

/** The open shifts on the board. */
export function useOpenShifts() {
  const [state, setState] = useState<OpenShiftsState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    api
      .getOpenShifts({})
      .then((shifts) => {
        if (active) setState({ kind: 'ready', shifts });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load the open shifts.',
        });
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { state, reload };
}

export type CandidatesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; payload: OpenShiftCandidates }
  | { kind: 'error'; message: string };

/**
 * The ranked candidates for the selected open shift.
 *
 * The result is tagged with the shift it belongs to, so a new selection shows
 * as loading without setting state inside the effect.
 */
export function useOpenShiftCandidates(openShiftId: string | null) {
  const [result, setResult] = useState<{ key: string; state: CandidatesState } | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const key = `${openShiftId ?? ''}|${nonce}`;

  useEffect(() => {
    if (!openShiftId) {
      return;
    }
    let active = true;
    api
      .getOpenShiftCandidates(openShiftId)
      .then((payload) => {
        if (active) setResult({ key, state: { kind: 'ready', payload } });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResult({
          key,
          state: {
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not load the candidates.',
          },
        });
      });
    return () => {
      active = false;
    };
  }, [openShiftId, key]);

  const state: CandidatesState = !openShiftId
    ? { kind: 'idle' }
    : result && result.key === key
      ? result.state
      : { kind: 'loading' };

  return { state, reload };
}
