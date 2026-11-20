/**
 * The signed-in session.
 *
 * The token comes from the mock sign-in (docs/09-access-control.md §4). The api
 * validates it on every request exactly as it would a real identity
 * provider's token - only the issuer is fake - so the web sends it with every
 * call once someone has signed in.
 */

let token: string | null = null;

export function setToken(value: string | null): void {
  token = value;
}

export function getToken(): string | null {
  return token;
}
