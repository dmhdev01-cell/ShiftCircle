import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetFixtures } from '../api/fixtures/api';
import { invalidateVersionCache } from '../api/useVersion';

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
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
