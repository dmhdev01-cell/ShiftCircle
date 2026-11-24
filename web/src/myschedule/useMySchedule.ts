import { useCallback, useEffect, useRef, useState } from 'react';

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
  | { kind: 'ready'; offers: MyOffer[]; refreshFailed?: boolean }
  | { kind: 'error'; message: string };

/** Focus and visibilitychange both fire on one return; within this window they make one GET. */
export const RETURN_REFRESH_WINDOW_MS = 1000;

/**
 * Open offers first, the newest first; answered offers after them, newest
 * first. The api's order put the offer a supervisor had just sent fourth,
 * below the fold (demo verification D1). An offeredAt that does not parse
 * sorts after the ones that do, in its original order.
 */
export function sortOffers(offers: MyOffer[]): MyOffer[] {
  const time = (offer: MyOffer) => {
    const parsed = Date.parse(offer.offeredAt);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  return offers
    .map((offer, index) => ({ offer, index }))
    .sort((a, b) => {
      const openA = a.offer.status === 'OFFERED' ? 0 : 1;
      const openB = b.offer.status === 'OFFERED' ? 0 : 1;
      if (openA !== openB) return openA - openB;
      const newer = time(b.offer) - time(a.offer);
      return Number.isNaN(newer) || newer === 0 ? a.index - b.index : newer;
    })
    .map(({ offer }) => offer);
}

/**
 * The overtime offers waiting for the officer. They are fetched again when the
 * person comes back to the window (focus, or the tab becoming visible), so an
 * offer a supervisor sends while My schedule is open shows up without a page
 * refresh (demo verification D1). One return fires both events, so returns
 * within RETURN_REFRESH_WINDOW_MS make one request. Only the latest request's
 * answer is used: an older, slower response is dropped. A failed background
 * refresh keeps the offers on screen and says so.
 */
export function useMyOffers() {
  const [state, setState] = useState<MyOffersState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  const lastReturn = useRef(Number.NEGATIVE_INFINITY);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const onReturn = () => {
      const now = Date.now();
      if (now - lastReturn.current < RETURN_REFRESH_WINDOW_MS) return;
      lastReturn.current = now;
      reload();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onReturn();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  useEffect(() => {
    // A newer request (a later nonce) sets this to false, so an older answer
    // arriving late cannot replace a newer list.
    let active = true;
    api
      .getMyOffers()
      .then((offers) => {
        if (active) setState({ kind: 'ready', offers: sortOffers(offers) });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState((current) =>
          current.kind === 'ready'
            ? { ...current, refreshFailed: true }
            : {
                kind: 'error',
                message: error instanceof Error ? error.message : 'Could not load your offers.',
              },
        );
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { state, reload };
}
