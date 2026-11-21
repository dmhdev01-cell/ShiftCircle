/**
 * The e2e commit guard (operator request after dev-qa's run mutated the
 * person's trial stack): a real-api Playwright run must name the commit it
 * expects, must not point at the person's stack on port 18080 unless that is
 * said explicitly, and must be able to read the version at all.
 *
 * Plain CommonJS so a node:test can run it with no build step, and the
 * Playwright global setup can require it.
 */

/** Parse a base URL into {port, url}; throws on something that is not a URL. */
function parseBase(baseURL) {
  const url = new URL(baseURL);
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  return { url, port };
}

/**
 * The decision, as data, so it can be tested: { ok: true } or
 * { ok: false, reason }.
 */
function decide({ baseURL, expectCommit, allowPersonStack, version }) {
  let port;
  try {
    port = parseBase(baseURL).port;
  } catch {
    return { ok: false, reason: `BASE_URL is not a URL: ${baseURL}` };
  }

  if (port === 18080 && allowPersonStack !== true) {
    return {
      ok: false,
      reason:
        'BASE_URL points at the person\'s trial stack (port 18080). Set ALLOW_PERSON_STACK=yes ' +
        'only if you mean to change their data, or use your own stack (18081+).',
    };
  }

  if (!expectCommit) {
    return {
      ok: false,
      reason: 'EXPECT_COMMIT is not set: say which commit this run is against (set EXPECT_COMMIT=<hash>).',
    };
  }

  if (!version) {
    return { ok: false, reason: `Could not read /api/v1/version at ${baseURL}: is the stack up?` };
  }

  const actual = String(version.gitCommit ?? '');
  if (!actual) {
    return { ok: false, reason: 'The stack answers /api/v1/version without a gitCommit.' };
  }
  if (!actual.startsWith(String(expectCommit))) {
    return {
      ok: false,
      reason: `The stack runs commit ${actual}, not EXPECT_COMMIT ${expectCommit}. Refusing to test the wrong build.`,
    };
  }

  return { ok: true };
}

/** Fetch the version the stack reports, or null when it cannot be read. */
async function fetchVersion(baseURL) {
  try {
    const response = await fetch(`${baseURL.replace(/\/$/, '')}/api/v1/version`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** The global setup the Playwright config calls. */
async function checkCommit() {
  const baseURL = process.env.BASE_URL ?? 'http://localhost:8080';
  const mode = process.env.E2E_MODE ?? 'api';
  if (mode === 'fixtures') return;

  const version = await fetchVersion(baseURL);
  const decision = decide({
    baseURL,
    expectCommit: process.env.EXPECT_COMMIT ?? '',
    allowPersonStack: process.env.ALLOW_PERSON_STACK === 'yes',
    version,
  });
  if (!decision.ok) {
    throw new Error(`Refusing to run the real-api e2e suite: ${decision.reason}`);
  }
}

module.exports = { decide, checkCommit, fetchVersion };
