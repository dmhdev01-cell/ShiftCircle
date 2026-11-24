# ShiftCircle web

React + TypeScript + Vite + MUI. `pnpm install`, then `pnpm dev` for the dev server on http://localhost:5173.
`pnpm build` type-checks and builds to `dist/`, `pnpm lint` runs oxlint (4 warnings, 0 errors is the baseline), `pnpm exec tsc -b` type-checks on its own, and `pnpm test` runs the Vitest suite (514 tests in 53 files at `5a38580`, 24 Nov 2026). CI runs lint, `tsc -b`, the tests and the build.
`VITE_API_MODE=fixtures pnpm dev` runs the screens on built-in fixtures with no api (what the `@fixtures` Playwright specs use).
The api is called through `/api/` - proxied to `http://localhost:8081` in dev and to the api container by nginx in Docker.
`docker build .` builds the image: nginx serves `dist/` on port 80 and proxies `/api/` to `http://api:8081`, with `/healthz` for the health check.

## Demo session kill switch

On the `demo` profile the web keeps the mock sign-in in `sessionStorage` so a refresh does not sign you out (ADR-025 amendment, `src/api/session.ts`). Build with `VITE_PERSIST_DEMO_SESSION=false` to turn that off: the `web/Dockerfile` takes it as a build argument, and `docker-compose.yml` passes it from `.env`, so set it there and run `docker compose up -d --build --wait`. Only the exact string `false` switches it off. `prod-like` never persists.

## Contract samples

`src/api/contract-samples/` holds the api's own answers, captured from a running stack:

```sh
./scripts/capture-contract-samples.sh http://localhost:8080   # from the repository root
```

The fixtures and the api drift apart: the api sends `null` for a field the
fixtures leave out, and a screen that assumes otherwise leaves a blank page.
`src/api/contract.test.tsx` renders every screen from the recorded shapes, so
a null cannot crash one again. The data is synthetic, so the samples are
committed.

## The suite on a busy machine

The web suite often runs while the api suite (Docker, Testcontainers) and the
Playwright suite share the host. It passed or failed depending on the load, and
the failures were always timeouts, so the settings now assume a shared machine:

| Setting | Value | Why |
|---|---|---|
| `testTimeout`, `hookTimeout` | 30 s | A test that hangs should name its own bug, not report the machine's load. |
| `maxWorkers` | 2 | Two jsdom workers keep their memory and CPU use predictable next to a Maven build and a browser. |
| `VITE_FIXTURE_LATENCY_MS` | `0` in the tests | The demo fixtures answer after 120 ms so a screen can show its loading state. In the tests that is a real timer whose length the test cannot control; at 0 the fixtures answer at once and nothing waits on a clock. |
| `asyncUtilTimeout` | 5 s (`src/test/setup.ts`) | `findBy`/`waitFor` poll for the answer; the 1 s default is a judgement about the host. |

Two rules follow from this and keep the suite honest:

- **No wall-clock deadlines and no real sleeps in a test.** Wait for content
  (`await screen.findByText(...)`) or count event-loop turns, as
  `WallDisplayPage.test.tsx` does; a loop bounded by `performance.now()` spins
  hot on a loaded host and then fails a test that would pass a moment later.
- **Wait on content, not on a page heading.** Every screen draws its `h1` while
  it loads and again when the answer lands, so the node a `findByRole('heading')`
  returns is gone a moment later. That "element is not in the document" failure
  was a race in the test, not a bug in the screen.

The fixtures keep their demo delay outside the tests: `VITE_API_MODE=fixtures pnpm dev`
still answers after 120 ms, and `VITE_FIXTURE_LATENCY_MS` sets another value.
For a one-off local loop, `pnpm vitest run --maxWorkers=8` is faster on a quiet
machine; the committed defaults are the ones the reviewers' runs use.
