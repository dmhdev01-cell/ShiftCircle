import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetFixtures } from '../api/fixtures/api';
import { resetSession } from '../api/session';
import { invalidateVersionCache } from '../api/useVersion';

/**
 * How long a `findBy`/`waitFor` polls before it gives up. The 1 s default is a
 * judgement about the machine as much as about the code: the same suite runs
 * while the api tests and the browser tests share the host, and a render that
 * takes 300 ms there is still correct.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * A minimal Response-like object. jsdom has no fetch, and the app only needs
 * `ok`, `status`, `statusText` and `json()`.
 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

// jsdom has no object URLs, and the reports download a CSV.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => undefined;
}

beforeEach(() => {
  invalidateVersionCache();
  resetFixtures();
  resetSession();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
