import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { usingFixtures } from '../api/client';
import { getSession, subscribeSession } from '../api/session';

/**
 * A protected route needs a session.
 *
 * On prod-like the token lives in memory only (ADR-025), so a full page reload
 * or a deep link arrives with no session; the demo profile keeps it in
 * sessionStorage (ADR-025 amendment), so only a new tab or a signed-out visit does. Without this guard the screens rendered and asked
 * the api for data with no token: four 401s and page errors instead of the
 * sign-in screen (D11).
 *
 * A visitor who arrived without a session is sent to /login with the route they
 * asked for, so signing in returns them there. Someone who signed out - or
 * whose session expired - is sent without it and gets their own role's landing
 * page, which matters when the next person to sign in is someone else.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const location = useLocation();

  // The fixtures demo has no token by design; its screens are the demo.
  if (usingFixtures) return <>{children}</>;
  // The sign-in screen is the one route a visitor without a session needs.
  if (location.pathname === '/login') return <>{children}</>;
  if (session.user !== null) return <>{children}</>;

  const remember = !session.signedOut && !session.ended;
  return (
    <Navigate
      to="/login"
      replace
      state={{ from: remember ? `${location.pathname}${location.search}` : undefined }}
    />
  );
}
