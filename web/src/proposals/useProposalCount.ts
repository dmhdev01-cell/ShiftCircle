import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api } from '../api/client';

const CHANGED = 'sc:proposals-changed';

/** Tell the nav count that a decision was sent, so it reads the count again. */
export function notifyProposalsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The waiting proposals the signed-in supervisor or planner may decide
 * (GET /proposals/count), for "Proposals (n)" in the nav. Read again on every
 * page change and after a decision. Null while unknown or when the count could
 * not be read: the nav then shows the plain label.
 */
export function useProposalCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => setTick((value) => value + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    api
      .getProposalCount()
      .then((value) => {
        if (active) setCount(value);
      })
      .catch(() => {
        if (active) setCount(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, pathname, tick]);

  return enabled ? count : null;
}
