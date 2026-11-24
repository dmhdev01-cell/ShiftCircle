import { useCallback, useEffect, useState } from 'react';

import { fetchVersion } from './version';
import type { VersionInfo } from './version';

export type VersionState =
  | { status: 'loading' }
  | { status: 'ready'; info: VersionInfo }
  | { status: 'error'; message: string };

/**
 * One in-flight request and one result are shared by every caller, so the
 * footer tooltip and the About screen do not each hit the api.
 */
let cache: VersionInfo | null = null;
let inFlight: Promise<VersionInfo> | null = null;

/** Start (or join) the shared /version request; the start-up gate uses it too. */
export function loadVersion(): Promise<VersionInfo> {
  return load();
}

function load(): Promise<VersionInfo> {
  if (!inFlight) {
    inFlight = fetchVersion()
      .then((info) => {
        cache = info;
        return info;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function invalidateVersionCache(): void {
  cache = null;
  inFlight = null;
}

export function useVersion() {
  // The cache is read during render, so a warm cache never needs an effect.
  const [state, setState] = useState<VersionState>(() =>
    cache ? { status: 'ready', info: cache } : { status: 'loading' },
  );

  const refresh = useCallback(async () => {
    invalidateVersionCache();
    setState({ status: 'loading' });
    try {
      const info = await load();
      setState({ status: 'ready', info });
    } catch (cause) {
      setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Unknown error.' });
    }
  }, []);

  useEffect(() => {
    if (cache) {
      return;
    }
    let active = true;
    load()
      .then((info) => {
        if (active) setState({ status: 'ready', info });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Unknown error.' });
      });
    return () => {
      active = false;
    };
  }, []);

  return { state, refresh };
}
