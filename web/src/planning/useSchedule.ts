import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { SchedulePayload } from '../api/types';

export type ScheduleState =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: SchedulePayload }
  | { kind: 'error'; message: string };

/**
 * Loads the planning board payload through the api client.
 *
 * The result is tagged with the request it belongs to, so a changed request
 * shows as loading without setting state inside the effect.
 */
export function useSchedule(unitId?: string, from?: string, to?: string) {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ScheduleState } | null>(null);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const key = `${unitId ?? ''}|${from ?? ''}|${to ?? ''}|${nonce}`;

  useEffect(() => {
    let active = true;

    api
      .getSchedule({
        ...(unitId ? { unitId } : {}),
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
            message: error instanceof Error ? error.message : 'Could not load the schedule.',
          },
        });
      });

    return () => {
      active = false;
    };
  }, [unitId, from, to, key]);

  const state: ScheduleState = result && result.key === key ? result.state : { kind: 'loading' };

  return { state, reload };
}
