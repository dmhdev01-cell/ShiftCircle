import { useSyncExternalStore } from 'react';
import { Navigate } from 'react-router-dom';

import { usingFixtures } from '../api/client';
import { getSession, subscribeSession } from '../api/session';
import { destinationFor } from './destinations';

/**
 * The bare address "/": signed in, the role's own home (the same landing the
 * sign-in screen uses); not signed in, the sign-in screen. It used to send
 * everyone to the Planning board, so an officer, a rules user or the wall
 * display signed in there and saw "This account may not do that" (install
 * verification, 26 Nov 2026). The fixtures demo has no session and keeps the
 * board.
 */
export function RootRedirect() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const to = session.user ? destinationFor(session.user) : usingFixtures ? '/planning' : '/login';
  return <Navigate to={to} replace />;
}
