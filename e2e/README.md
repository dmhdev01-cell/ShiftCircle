# ShiftCircle end-to-end tests (Playwright)

Flows E1–E5 from `docs/10-testing.md` §5, on a desktop (1440 × 900) and a tablet (768 × 1024) viewport, with axe accessibility checks (WCAG 2.1 AA; serious or critical findings fail) on every screen reached, and keyboard-only runs of E1 and E3.

Specs find elements by role, label or text, never by CSS path. `BASE_URL` picks the web under test (default `http://localhost:8080`).

## Tags and skipped tests

- **`@fixtures`**: the test relies on fixture-only data or writes state, such as publishing a rule version or saving an override. Against the real compose stack, skip these: `npx playwright test --grep-invert @fixtures`.
- **`test.fixme`**: E5 (wall display) is written but skipped, because the screen isn't built yet (a placeholder at `/display`).

## Run against the fixtures-mode web

The browser runs only in Docker. The host needs Node and pnpm for the install step.

```sh
# 1. Install the test dependencies (host)
pnpm --dir e2e install

# 2. Build the web in fixtures mode and serve it with a single-page-app fallback
VITE_API_MODE=fixtures pnpm --dir web build
pnpm dlx serve@14.2.4 -s -l tcp://0.0.0.0:4317 web/dist

# 3. Run the browser in Docker (host.docker.internal reaches the host on Docker Desktop)
docker run --rm -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:4317 \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test
```

`vite preview` won't do for step 2: it refuses the `host.docker.internal` host name with a 403 unless `preview.allowedHosts` is set.

## Run against the compose stack

```sh
docker compose up -d --build
docker run --rm --network host -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://localhost:8080 \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures
```

`E2E_WORKERS` sets parallelism (default 2; the shared machine made 7 workers flaky). The HTML report is in `playwright-report/`.
