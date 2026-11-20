import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { PayPeriod, TimeEntry } from '../api/types';

export type PayPeriodsState =
  | { kind: 'loading' }
  | { kind: 'ready'; periods: PayPeriod[] }
  | { kind: 'error'; message: string };

/** The pay periods the supervisor can work on. */
export function usePayPeriods() {
  const [state, setState] = useState<PayPeriodsState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    api
      .getPayPeriods()
      .then((periods) => {
        if (active) setState({ kind: 'ready', periods });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load the pay periods.',
        });
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { state, reload };
}

export type EntriesState =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: TimeEntry[] }
  | { kind: 'error'; message: string };

/** The time entries of the selected pay period. */
export function useTimeEntries(payPeriodId: string | null) {
  const [result, setResult] = useState<{ key: string; state: EntriesState } | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const key = `${payPeriodId ?? ''}|${nonce}`;

  useEffect(() => {
    if (!payPeriodId) {
      return;
    }
    let active = true;
    api
      .getTimeEntries(payPeriodId)
      .then((entries) => {
        if (active) setResult({ key, state: { kind: 'ready', entries } });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResult({
          key,
          state: {
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not load the time entries.',
          },
        });
      });
    return () => {
      active = false;
    };
  }, [payPeriodId, key]);

  const state: EntriesState = !payPeriodId
    ? { kind: 'loading' }
    : result && result.key === key
      ? result.state
      : { kind: 'loading' };

  return { state, reload };
}
