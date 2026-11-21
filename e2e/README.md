# ShiftCircle end-to-end tests (Playwright)

Flows E1–E5 from `docs/10-testing.md` §5, on a desktop (1440 × 900) and a tablet (768 × 1024) viewport, with axe accessibility checks (WCAG 2.1 AA; serious or critical findings fail) on every screen reached, and keyboard-only runs of E1 and E3.

Specs find elements by role, label or text, never by CSS path. `BASE_URL` picks the web under test (default `http://localhost:8080`).

## The commit guard (real-api runs)

A real-api run must say which build it is testing and must not land on the
person's trial stack by accident (one did, and changed their data):

```sh
EXPECT_COMMIT=<hash> BASE_URL=http://localhost:18081 npx playwright test --grep-invert @fixtures
```

`global-setup.ts` then refuses unless `BASE_URL/api/v1/version` reports a
`gitCommit` starting with `EXPECT_COMMIT`. It also refuses port 18080 unless
`ALLOW_PERSON_STACK=yes` is set (the person's trial stack is not a test
target), and refuses when the version cannot be read at all. The rules are in
`scripts/commit-guard.cjs` with their own `node --test scripts/commit-guard.test.cjs`.

Fixtures-mode runs set `E2E_MODE=fixtures` and skip the guard: that build has
no api behind it.

**Chromium only.** Both projects are Desktop Chrome; the config refuses any other browser (Firefox and WebKit took the project lead's window server down). What the suite covers, screen by role by state, and the product defects it found are in [COVERAGE.md](COVERAGE.md).

**Known defects** are tests that assert the correct behaviour and carry `test.fail(true, 'Dn: …')`: they count as passed while the defect is there and report "expected to fail, but passed" once it is fixed; then remove the marker.

**Screenshots.** `tests/screenshots.spec.ts` (and the rules refusal spec) save full-page captures as `<viewport>__<role>__<screen>__<state>.png` plus `index.json` to `SHOTS_DIR`, default `/private/tmp/sc-ui-shots/<RUN_ID>` (outside the repository; `RUN_ID` defaults to the run's start time). With the browser in Docker, mount that folder at the same path: `-v /private/tmp/sc-ui-shots:/private/tmp/sc-ui-shots`.

## Tags and skipped tests

- **`@fixtures`**: the test relies on fixture-only data or writes state, such as publishing a rule version or saving an override. Against the real compose stack, skip these: `npx playwright test --grep-invert @fixtures`.
- **`@api`**: the test needs the real api, for example because it cuts the network to `/display/today` (the fixtures web makes no request to cut). Against the fixtures web, skip these: `npx playwright test --grep-invert @api`.

## Run against the fixtures-mode web

Everything runs in containers; the host needs only Docker. `host.docker.internal` reaches the host from a container on Docker Desktop (macOS, Windows); `--add-host=host.docker.internal:host-gateway` makes the same name work on Docker Engine (Linux). Checked on macOS; Linux is **UNVERIFIED** here (alternative: `--network host` with `localhost`).

```sh
# Install the test dependencies (once)
docker run --rm -v "$PWD/e2e":/app -w /app node:24-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile"
```

## Run against the fixtures-mode web

```sh
# 1. Build the web in fixtures mode
docker run --rm -e VITE_API_MODE=fixtures -v "$PWD/web":/app -w /app node:24-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm build"

# 2. Serve it with a single-page-app fallback on port 4317 (stop it with: docker stop sc-fixtures-web)
docker run -d --rm --name sc-fixtures-web -p 4317:4317 -v "$PWD/web/dist":/site:ro \
  node:24-alpine npx -y serve@14.2.4 -s -l tcp://0.0.0.0:4317 /site

# 3. Run the browser, skipping the real-api specs
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:4317 \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @api
```

`vite preview` won't do for step 2: it refuses the `host.docker.internal` host name with a 403 unless `preview.allowedHosts` is set. Latest fixtures result (dev-qa): 35 passed, 3 skipped, 0 failed.

## Run against the compose stack

```sh
docker compose up -d --build --wait
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:8080 \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop
```

The real-api specs change the data (offer confirmed, rule version published, period locked), so run **one viewport per fresh stack**: after `--project desktop`, run `docker compose down -v && docker compose up -d --wait`, then `--project tablet`. Fresh-clone result at `f1d696d`: tablet on a fresh stack 12 passed, 1 skipped; both viewports on one stack failed 4 tablet tests on the changed data.

`E2E_WORKERS` sets parallelism (default 2; the shared machine made 7 workers flaky). The HTML report is in `playwright-report/`.
