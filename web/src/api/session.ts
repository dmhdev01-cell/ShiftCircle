/**
 * The signed-in session.
 *
 * The token comes from the mock sign-in (docs/09-access-control.md §4). The api
 * validates it on every request exactly as it would a real identity
 * provider's token - only the issuer is fake - so the web sends it with every
 * call once someone has signed in.
 *
 * The screen reads this store, not a copy of the token, so signing out or an
 * expired token removes the identity everywhere at once. `ended` is set when
 * the api answers 401, and the shell sends the person back to the sign-in
 * screen (docs/ui/build-notes.md §2.1).
 */

import type { DemoUser } from './types';

export interface SessionState {
  /** The signed-in user, when there is one. */
  token: string | null;
  user: DemoUser | null;
  /** True when the api answered 401 and the token has to be replaced. */
  ended: boolean;
  /**
   * True after a deliberate sign-out. The sign-in screen uses it to tell a
   * person arriving at a protected route (a reload) from one who just left:
   * only the first is sent back to the route they asked for (D11).
   */
  signedOut: boolean;
}

const EMPTY: SessionState = { token: null, user: null, ended: false, signedOut: false };

let state: SessionState = EMPTY;

/**
 * ADR-025 amendment (S11): on the demo profile only, the token is also kept in
 * sessionStorage so a refresh during a live demo does not lose the session.
 * Off by default; `enableSessionPersistence` is called at start-up only when
 * the api reports `demoMode` (never on prod-like), and the build-time switch
 * `VITE_PERSIST_DEMO_SESSION=false` turns it off for good.
 */
const STORAGE_KEY = 'sc.demoSession';
let persist = false;

function store(value: { token: string; user: DemoUser } | null): void {
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the session simply stays memory-only.
  }
}

/** Demo profile only: keep the token across a refresh, and restore a saved one. */
export function enableSessionPersistence(): void {
  if (import.meta.env.VITE_PERSIST_DEMO_SESSION === 'false') return;
  persist = true;
  if (state.token !== null) return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as { token?: unknown; user?: unknown }) : null;
    if (saved && typeof saved.token === 'string' && saved.user && typeof saved.user === 'object') {
      state = { token: saved.token, user: saved.user as DemoUser, ended: false, signedOut: false };
      emit();
    }
  } catch {
    store(null);
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSession(): SessionState {
  return state;
}

/** The signed-in user, or null. */
export function getSessionUser(): DemoUser | null {
  return state.user;
}

/** The bearer token the api calls carry, or null. */
export function getToken(): string | null {
  return state.token;
}

/** A successful mock sign-in: keep the token and the user it belongs to. */
export function setSession(token: string, user: DemoUser): void {
  state = { token, user, ended: false, signedOut: false };
  if (persist) store({ token, user });
  emit();
}

/**
 * The identity the fixtures demo switch chooses. There is no token in that
 * flow, so the screens can still show whose turn it is.
 */
export function setActingUser(user: DemoUser | null): void {
  state = { token: null, user, ended: false, signedOut: false };
  emit();
}

/** A deliberate sign out. It is not an expired session, so no warning. */
export function signOut(): void {
  state = { ...EMPTY, signedOut: true };
  store(null);
  emit();
}

/** The api answered 401: drop the token and mark the session as ended. */
export function sessionExpired(): void {
  state = { token: null, user: null, ended: true, signedOut: false };
  store(null);
  emit();
}

/** Tests only: put the store back, so one test cannot sign the next one in. */
export function resetSession(): void {
  state = EMPTY;
  persist = false;
  store(null);
  listeners.clear();
}
