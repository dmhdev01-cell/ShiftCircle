# ShiftCircle end-to-end tests (Playwright)

Flows E1–E5 from `docs/10-testing.md` §5, on a desktop (1440 × 900) and a tablet (768 × 1024) viewport, with axe accessibility checks (WCAG 2.1 AA; serious or critical findings fail) on every screen reached, and keyboard-only runs of E1 and E3.

Specs find elements by role, label or text, never by CSS path. `BASE_URL` picks the web under test (default `http://localhost:8080`).

**Give a test stack its own compose project.** `docker-compose.yml` pins `name: shiftcircle`, the same project as the person's trial stack on port 18080, so a compose command without `-p` can land in their stack. Always use `-p <your-name>` or `COMPOSE_PROJECT_NAME` (and `ALLOW_PERSON_STACK` is never set for a real run).

## The commit guard (real-api runs)

A real-api run must say which build it is testing and must not land on the
person's trial stack by accident (one did, and changed their data):

```sh
EXPECT_COMMIT=<hash> BASE_URL=http://localhost:28080 npx playwright test --grep-invert @fixtures
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

`vite preview` won't do for step 2: it refuses the `host.docker.internal` host name with a 403 unless `preview.allowedHosts` is set. The fixtures result of the current suite is in `docs/10-testing.md` §2 ("Current counts").

## Run against the compose stack

```sh
# your own project name and port, so the file's `name: shiftcircle` never adopts another stack
export COMPOSE_PROJECT_NAME=sc-test        # or pass -p sc-test to every command
echo 'SC_WEB_PORT=28080' >> .env           # any free port other than 8080 and 18080
docker compose up -d --build --wait
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:28080 -e EXPECT_COMMIT=<the commit you built> \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop-datasets
```

The real-api specs change the data (offer confirmed, rule version published, period locked), so run **one viewport per fresh stack**: after `--project desktop-datasets`, run `docker compose down -v && docker compose up -d --wait`, then `--project tablet-datasets`. Both viewports on one stack fail tablet tests on the changed data. `down -v` deletes the database volume of the project you name, so check `docker compose ls` first and never run it for a stack you did not start. The current pass counts are in [`docs/10-testing.md`](../docs/10-testing.md) §2 ("Current counts").

`E2E_WORKERS` sets parallelism (default 2; the shared machine made 7 workers flaky). The HTML report is in `playwright-report/`.

### Stack-wide specs run one at a time, last

Fourteen specs change state the whole stack shares: they publish an effective rule change (E3: U-02 12 → 14 h changes rule results everywhere), reset the one demo database to another dataset (120 or 150) and back to 100, generate, commit or discard the one quarter plan, or lock the demo pay period (E4, which another spec's actual edit in that period would otherwise disable mid-test). They are `dataset120`, `e3-rule-change`, `e4-lock-and-payroll`, `planned-leave`, `planner`, `planner-a11y`, `planner-absences`, `planner-committed`, `planner-draft-edit`, `planner-options`, `planner-preferences-committed`, `reset-datasets`, `reset` and `unit-closure` (the `STACK_SPECS` list in `playwright.config.ts`). Under `fullyParallel`, two of them in flight corrupt each other's data, and a reset or generate racing another answers 409 ("A demo reset or another planner run is in progress"). So each viewport has two projects:

| Project | Runs | Workers |
|---|---|---|
| `desktop` / `tablet` | every other spec, in parallel | `E2E_WORKERS` |
| `desktop-datasets` / `tablet-datasets` | the stack-wide specs, **after** the parallel project has finished (`dependencies`) | 1 |

- **Whole suite for a viewport:** `--project desktop-datasets`. It runs `desktop` first, then the stack-wide specs one at a time. `--project desktop` alone skips the stack-wide specs.
- **Tags:** CLI `--grep`/`--grep-invert` do not reach a dependency project, so the projects filter by mode themselves: a real-api run never runs `@fixtures` tests, and a run with `E2E_MODE=fixtures` never runs `@api` tests. The documented `--grep-invert @fixtures` is kept and is harmless.
- **One stack-wide spec on its own:** add `--no-deps`, for example `npx playwright test tests/planned-leave.spec.ts --project desktop-datasets --no-deps`. Without it, Playwright runs the whole `desktop` project first, because CLI file filters do not apply to dependency projects either.
- **A new spec that resets the dataset, generates, commits or discards a plan, or locks a pay period** goes into `STACK_SPECS`.
