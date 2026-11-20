import { useEffect, useState } from 'react';

import { api } from './client';
import type { Unit } from './types';

export type UnitsState =
  | { kind: 'loading' }
  | { kind: 'ready'; units: Unit[] }
  | { kind: 'error'; message: string };

/** The units the signed-in supervisor may plan (docs/07 §4.1). */
export function useUnits() {
  const [state, setState] = useState<UnitsState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .getUnits()
      .then((units) => {
        if (active) setState({ kind: 'ready', units });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load the units.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
