import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // During local development the api runs on the host; in Docker the same
    // path is proxied by nginx to the api container.
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // The tests read the typed fixtures, the same way the demo build does. The
    // fixtures answer at once here: a real 120 ms timer is a wait whose length
    // the test does not control, and on a loaded machine those waits pile up.
    env: { VITE_API_MODE: 'fixtures', VITE_FIXTURE_LATENCY_MS: '0' },
    // A shared build machine runs the api suite, the browser suite and this one
    // at the same time. The defaults (5 s, one worker per core) assume a quiet
    // machine and turn a busy host into red runs that say nothing about the code.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 2,
  },
});
