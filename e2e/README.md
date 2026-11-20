# ShiftCircle end-to-end tests (Playwright)

Flows E1–E5 from `docs/10-testing.md` §5, on a desktop (1440 × 900) and a tablet (768 × 1024) viewport, with axe accessibility checks (WCAG 2.1 AA; serious or critical findings fail) on every screen reached, and keyboard-only runs of E1 and E3.

Specs find elements by role, label or text, never by CSS path. `BASE_URL` picks the web under test (default `http://localhost:8080`).

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
