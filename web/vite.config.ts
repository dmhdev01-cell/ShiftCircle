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
    // The tests read the typed fixtures, the same way the demo build does.
    env: { VITE_API_MODE: 'fixtures' },
  },
});
