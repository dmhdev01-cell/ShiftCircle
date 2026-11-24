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

// One run, one screenshot folder: the workers inherit this from the runner.
process.env.RUN_ID ??= new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * CHROMIUM ONLY. Every project uses Desktop Chrome. Never add Firefox or
 * WebKit projects: on the project lead's Mac they took the window server down.
 * The guard below fails the run if a project ever names another browser.
 */
/**
 * The stack-wide specs: they reset the one shared demo database to another
 * dataset (120 or 150, and back to 100), generate, commit or discard the one
 * quarter plan, or lock the demo pay period (E4). Under fullyParallel two of them in flight corrupt each other's
 * data, and a reset or generate racing another answers 409 ("A demo reset or
 * another planner run is in progress"). They run in their own
 * `<viewport>-datasets` project: one worker, and only after the parallel
 * project for the same viewport has finished (see e2e/README.md).
 */
const STACK_SPECS = [
  /\/dataset120\.spec\.ts$/,
  // E3 publishes an effective U-02 change (12 -> 14 h), which changes rule
  // results for every spec that runs after it.
  /\/e3-rule-change\.spec\.ts$/,
  /\/e4-lock-and-payroll\.spec\.ts$/,
  /\/planned-leave\.spec\.ts$/,
  /\/planner\.spec\.ts$/,
  /\/planner-a11y\.spec\.ts$/,
  /\/planner-absences\.spec\.ts$/,
  /\/planner-committed\.spec\.ts$/,
  /\/planner-draft-edit\.spec\.ts$/,
  /\/planner-options\.spec\.ts$/,
  /\/planner-preferences-committed\.spec\.ts$/,
  /\/reset-datasets\.spec\.ts$/,
  /\/reset\.spec\.ts$/,
  /\/unit-closure\.spec\.ts$/,
];

/**
 * CLI --grep / --grep-invert do not reach a dependency project, so the tag
 * filter for the mode lives here too: a real-api run never runs @fixtures
 * tests, a fixtures run (E2E_MODE=fixtures) never runs @api tests.
 */
const modeFilter = process.env.E2E_MODE === 'fixtures' ? /@api/ : /@fixtures/;

const viewports = [
  { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  {
    name: 'tablet',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
    },
  },
];

const projects = viewports.flatMap((viewport) => [
  { name: viewport.name, use: viewport.use, testIgnore: STACK_SPECS, grepInvert: modeFilter },
  {
    name: `${viewport.name}-datasets`,
    use: viewport.use,
    testMatch: STACK_SPECS,
    grepInvert: modeFilter,
    workers: 1,
    dependencies: [viewport.name],
  },
]);
for (const project of projects) {
  const use = project.use as { browserName?: string; defaultBrowserType?: string };
  const browser = use.browserName ?? use.defaultBrowserType;
  if (browser !== 'chromium') {
    throw new Error(`Chromium only: project "${project.name}" uses ${browser ?? 'an unknown browser'}.`);
  }
}

export default defineConfig({
  testDir: './tests',
  // Refuses the wrong commit, the person's stack (18080) and an unreachable
  // stack; fixtures-mode runs set E2E_MODE=fixtures (see README).
  globalSetup: './global-setup.ts',
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
  projects,
});
