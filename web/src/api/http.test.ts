import { describe, expect, it, vi } from 'vitest';

import { ApiError, UNREACHABLE_MESSAGE, createHttpApi } from './http';

/**
 * The boundary between the browser and the app: what a screen is told when the
 * api cannot be reached at all.
 */
describe('the http client', () => {
  it('turns the browser\'s network failure into a sentence a person can act on', async () => {
    // fetch says "Failed to fetch", which names the browser, not the problem.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const failure = await createHttpApi()
      .getSchedule({ unitId: 'unit-b' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
    expect((failure as ApiError).message).toBe(UNREACHABLE_MESSAGE);
    expect((failure as ApiError).message).not.toContain('Failed to fetch');
  });
});
