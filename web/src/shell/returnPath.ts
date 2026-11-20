/**
 * Where a sign-in is allowed to send the person next.
 *
 * The route guard puts the asked-for path into the router state, and the
 * sign-in screen navigates to it. That state is data from outside the app's
 * own routes, so it is validated here: an in-app absolute path only. A value
 * such as "//evil.example", "https://evil.example" or "/\evil" would send the
 * browser off-site (or is simply not a route this app has), and falls back to
 * the role's landing page (review-r2 NOTE 1: defence in depth).
 */
const IN_APP_PATH = /^\/(?!\/)[^\\]*$/;

export function safeReturnPath(value: unknown): string | null {
  return typeof value === 'string' && IN_APP_PATH.test(value) ? value : null;
}
