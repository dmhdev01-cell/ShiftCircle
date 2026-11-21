const assert = require('node:assert/strict');
const { test } = require('node:test');

const { decide } = require('./commit-guard.cjs');

/** The guard: a real-api run names its commit and never lands on the person's stack by accident. */
const ok = { ok: true };
const version = (commit) => ({ gitCommit: commit });

test('accepts the named commit, prefix included', () => {
  assert.deepEqual(
    decide({ baseURL: 'http://localhost:18081', expectCommit: '347fb67', allowPersonStack: false, version: version('347fb67abc') }),
    ok,
  );
  assert.deepEqual(
    decide({ baseURL: 'http://localhost:18081', expectCommit: '347fb67abc', allowPersonStack: false, version: version('347fb67abc') }),
    ok,
  );
});

test('refuses a different commit', () => {
  const decision = decide({
    baseURL: 'http://localhost:18081',
    expectCommit: '347fb67',
    allowPersonStack: false,
    version: version('deadbee'),
  });
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /runs commit deadbee/);
});

test('refuses the person\'s stack on 18080 unless it is allowed explicitly', () => {
  const base = { baseURL: 'http://localhost:18080', expectCommit: '347fb67', version: version('347fb67') };
  assert.match(decide({ ...base, allowPersonStack: false }).reason, /person's trial stack/);
  assert.deepEqual(decide({ ...base, allowPersonStack: true }), ok);
});

test('refuses without EXPECT_COMMIT, without a version, or with an unreadable BASE_URL', () => {
  assert.match(
    decide({ baseURL: 'http://localhost:18081', expectCommit: '', version: version('347fb67') }).reason,
    /EXPECT_COMMIT is not set/,
  );
  assert.match(
    decide({ baseURL: 'http://localhost:18081', expectCommit: '347fb67', version: null }).reason,
    /is the stack up/,
  );
  assert.match(
    decide({ baseURL: 'not a url', expectCommit: '347fb67', version: version('347fb67') }).reason,
    /not a URL/,
  );
});
