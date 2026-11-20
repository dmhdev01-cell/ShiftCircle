import { defineConfig, devices } from '@playwright/test';

/**
 * ShiftCircle end-to-end flows (docs/10-testing.md section 5).
 *
 * BASE_URL points at a running web: the fixtures-mode build for now
 * (VITE_API_MODE=fixtures), the real compose stack later. Tests that rely on
 * fixture-only behaviour carry the @fixtures tag, so against the real api run:
 *   npx playwright test --grep-invert @fixtures
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // The browser runs in Docker on a shared machine; a few workers and a
  // 10 s assertion timeout keep runs stable without hiding real failures.
  workers: Number(process.env.E2E_WORKERS ?? 2),
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
    },
  ],
});
