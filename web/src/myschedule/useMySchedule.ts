import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { MyOffer, MySchedulePayload } from '../api/types';

export type MyScheduleState =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: MySchedulePayload }
  | { kind: 'error'; message: string };

/** The signed-in officer's own schedule. */
export function useMySchedule(from?: string, to?: string) {
  const [result, setResult] = useState<{ key: string; state: MyScheduleState } | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const key = `${from ?? ''}|${to ?? ''}|${nonce}`;

  useEffect(() => {
    let active = true;
    api
      .getMySchedule({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      })
      .then((payload) => {
        if (active) setResult({ key, state: { kind: 'ready', payload } });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResult({
          key,
          state: {
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not load your schedule.',
          },
        });
      });
    return () => {
      active = false;
    };
  }, [from, to, key]);

  const state: MyScheduleState = result && result.key === key ? result.state : { kind: 'loading' };

  return { state, reload };
}

export type MyOffersState =
  | { kind: 'loading' }
  | { kind: 'ready'; offers: MyOffer[] }
  | { kind: 'error'; message: string };

/** The overtime offers waiting for the officer. */
export function useMyOffers() {
  const [state, setState] = useState<MyOffersState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    api
      .getMyOffers()
      .then((offers) => {
        if (active) setState({ kind: 'ready', offers });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load your offers.',
        });
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { state, reload };
}
