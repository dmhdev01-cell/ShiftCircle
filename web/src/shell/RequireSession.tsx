import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { usingFixtures } from '../api/client';
import { getSession, subscribeSession } from '../api/session';

/**
 * A protected route needs a session.
 *
 * The token lives in memory only (no localStorage: where a token is kept is a
 * decision the project has not made), so a full page reload or a deep link
 * arrives with no session. Without this guard the screens rendered and asked
 * the api for data with no token: four 401s and page errors instead of the
 * sign-in screen (D11).
 *
 * The signed-out visitor is sent to /login with the route they asked for, so
 * signing in returns them there instead of to their role's landing page.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const location = useLocation();

  // The fixtures demo has no token by design; its screens are the demo.
  if (usingFixtures) return <>{children}</>;
  // The sign-in screen is the one route a visitor without a session needs.
  if (location.pathname === '/login') return <>{children}</>;
  if (session.user !== null) return <>{children}</>;

  return (
    <Navigate
      to="/login"
      replace
      state={{ from: `${location.pathname}${location.search}` }}
    />
  );
}
