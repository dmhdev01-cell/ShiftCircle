# ShiftCircle

A shift-scheduling prototype for a 24/7 provincial correctional centre. Supervisors plan 8- and 12-hour shifts (a 16 h day is a 12 h shift plus an extension) against a **configurable rules engine** (rest and hours limits, consecutive shifts, staffing, qualifications, overtime). A planner builds a whole-quarter draft through the same engine, changes single shifts in it by hand, and commits it to the planning board. Employees see their schedule and hours and can draft and rule-check shift ideas (sending them to a supervisor is not available yet). Time feeds a payroll export, and reports show coverage and overtime as planned vs. actual.

> A prototype. **All data is synthetic.** Payroll and sign-on are simulated. The default demo seeds 100 fictional officers over 90 days; the About reset card can also load Dataset 120 and Dataset 150 for the quarter planner.

> **Using it?** [INSTALL.md](INSTALL.md) sets it up and the [user guide](USER-GUIDE.md) explains each role. All documentation starts at [docs/index.md](docs/index.md).

## Architecture at a glance

Three containers: **web** (nginx + React) · **api** (Java 21 + Spring Boot 4.x, JdbcTemplate + Flyway, Drools rules engine) · **db** (PostgreSQL). See [docs/03-architecture.md](docs/03-architecture.md).

## Documentation

| Doc | What's in it |
|---|---|
| [INSTALL.md](INSTALL.md) | Standalone Docker-only install guide: prerequisites, secrets, start, health check, demo datasets and reset, upgrade, removal, troubleshooting |
| [USER-GUIDE.md](USER-GUIDE.md) | How to use it, per role: officer, supervisor, planner, auditor, rules admin and approver |
| [docs/01-scope-and-plan.md](docs/01-scope-and-plan.md) | Problem, users, outcomes, feature priorities, assumptions, plan, open questions |
| [docs/02-requirements.md](docs/02-requirements.md) | Screens, functional and non-functional requirements, rules catalogue, data model, test cases |
| [docs/03-architecture.md](docs/03-architecture.md) | Containers, feature slices, JdbcTemplate persistence, change flow, frontend, JWT security |
| [docs/04-rules-engine.md](docs/04-rules-engine.md) | Rules engine design: Drools decision tables a non-technical admin can edit |
| [docs/05-union-rules.md](docs/05-union-rules.md) | Mock collective-agreement rule set, with each rule's source |
| [docs/06-data-model.md](docs/06-data-model.md) | PostgreSQL tables, constraints, ER diagram, migrations and seed |
| [docs/07-api-spec.md](docs/07-api-spec.md) | REST endpoints, rule-check/override contract, error format, screen-to-endpoint map |
| [docs/08-deployment.md](docs/08-deployment.md) | Docker Compose topology, configuration, startup, nginx, path to pilot |
| [docs/09-access-control.md](docs/09-access-control.md) | Roles, permission matrix, enforcement, mock sign-in, privacy |
| [docs/10-testing.md](docs/10-testing.md) | Test strategy, rule boundary matrix, scenarios, E2E flows, demo dataset spec |
| [docs/ui/README.md](docs/ui/README.md) | UI spec: Sask design tokens, components, every screen; design files in `docs/ui/screens/` |
| [docs/roadmap.md](docs/roadmap.md) | Known limits, staffing findings and the ordered post-submission roadmap |
| [docs/decisions.md](docs/decisions.md) | Decision log (ADRs) |

## How this was built

The build process is kept apart from the product docs, in [docs/process/](docs/process/):
- [HANDOFF.md](docs/process/HANDOFF.md) is the brief the team worked from.
- [ai-dev-log.md](docs/process/ai-dev-log.md) is the AI-assisted development log.
- [review-rounds.md](docs/process/review-rounds.md) records every independent review and QA round.
- [release-notes.md](docs/process/release-notes.md) says what each release added, with the test counts at the time.

[BUILD_RECORD.md](BUILD_RECORD.md) is the two-page summary.

**UI design:** six screens (planning board, my schedule, overtime board, rules admin, reports, wall display) are specified in `docs/ui/`.

## Quick install

One command. It needs a bash shell (macOS, Linux, or Git Bash/WSL on Windows), `curl`, `git`, Docker with Compose v2, a running Docker daemon and a free port. It clones into `./ShiftCircle`, creates `.env` with freshly generated random secrets that it never prints, runs `docker compose up -d --build --wait`, checks `/healthz` and `/api/v1/version`, and prints the URL:

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.1.1-submission/install.sh && bash install.sh
```

A failed download stops at the `curl` step with a non-zero exit. (`curl -fsSL <url> | bash` also works, because the script does nothing until it has all been read, but the pipe reports bash's exit status, so a failed download looks like success.) The safest way is to read it first:

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.1.1-submission/install.sh
less install.sh
bash install.sh
```

Overrides (environment variables, put them before `bash install.sh`): `SC_WEB_PORT` (host port, 1-65535, default 8080, for example `SC_WEB_PORT=9090 bash install.sh`), `SHIFTCIRCLE_PROJECT` (compose project name, default `shiftcircle`; a `COMPOSE_PROJECT_NAME` already in your shell is ignored on purpose), `SHIFTCIRCLE_REF` (tag or branch to install, default the release tag), `SHIFTCIRCLE_DIR` (default `./ShiftCircle`), and, advanced, `SHIFTCIRCLE_REPO` (clone URL). The port and project name are saved in `.env` (`SC_WEB_PORT`, `COMPOSE_PROJECT_NAME`). It refuses to touch an existing non-empty directory that is not a ShiftCircle checkout; re-running in the same place skips the clone and keeps the `.env` (it only fills a blank secret). It never runs `docker compose down`. The manual steps are below.

## Setup (clean clone)

Everything is on `main`: the API, all the screens, the mock sign-in, the quarter planner with draft edits, and the E2E suite. [INSTALL.md](INSTALL.md) is the full install guide; this section is the short version. The steps below were re-run on 24 Nov 2026 from a fresh `git clone` of the branch for this docs pass (own compose project, `SC_WEB_PORT` set): `docker compose up -d --build --wait` built and became healthy in 50 s with warm caches, `/healthz` returned `ok`, `/api/v1/version` returned the commit, rule set v3 (v4 since release v1.3), demo profile and Dataset 100, and the eight demo users in §3 match `GET /api/v1/auth/demo-users`. Anything not run is marked **UNVERIFIED**.

### Prerequisites

**Docker only:** Docker Desktop (macOS, Windows) or Docker Engine (Linux) with Compose v2, about 2 GB of free memory, and one free host port (8080 by default). No JDK, Maven, Node or database is needed on the host: everything, including the test dependencies, installs and builds inside containers.

### 1. Configure the secrets

```sh
cp .env.example .env
```

Then set the two secrets in `.env`. **There are no committed defaults**:

| Variable | Rule | Example to generate one |
|---|---|---|
| `POSTGRES_PASSWORD` | at least 8 characters | `openssl rand -base64 18` |
| `SC_JWT_SECRET` | at least 32 characters (signs the mock sign-in tokens, HS256) | `openssl rand -base64 48` |

If either is missing, `docker compose` stops before starting anything, with `required variable POSTGRES_PASSWORD is missing a value: … copy .env.example to .env and set it` (checked: `docker compose --env-file /dev/null config`). If either is too short, the API refuses to start and says which one.

### 2. Start

```sh
docker compose up -d --build --wait
```

`--wait` returns when all three containers are healthy: the database first, then the API (after it has run the Flyway migrations and generated the synthetic dataset), then the web. Then open **http://localhost:8080** and you see the mock sign-in screen with the demo users.

**How long:** with Docker's build cache warm, `up -d --build --wait` took **31 s** on 2026-11-20 and **50 s** on 2026-11-24, and the demo data took about 6.6 s of that (`Demo data generated in … ms` in `docker compose logs api`). The very first build also downloads the base images and the Maven and pnpm dependencies, which takes several minutes depending on the network (**UNVERIFIED** on a machine with an empty cache). The default dataset: 100 fictional officers, 1 Oct – 29 Dec 2026, "today" fixed at 19 Nov 2026, seed 20261001. The About reset card can also load Dataset 120 and Dataset 150 (see "Demo data and the quarter planner").

**Ports in use?** Only the web publishes a port, and it is bound to **127.0.0.1** (not the LAN) because the demo has mock sign-in and a destructive reset. Set `SC_WEB_PORT` in `.env`, for example `SC_WEB_PORT=18080`, and open that port instead. For local debugging, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` also publishes the API (`SC_API_PORT`, default 8081) and the database (`SC_DB_PORT`, default 5433), both on 127.0.0.1 only.

Checks once it's up (both checked):
- `http://localhost:8080/healthz` returns `ok`
- `http://localhost:8080/api/v1/version` returns the build, git commit, live rule-set version and `asOf`, for example `{"gitCommit":"<commit>","ruleSetVersion":"v4","profiles":"demo","asOf":"2026-11-19",…}` (rule set v4 since release v1.3; v3 before it)

Stop with `docker compose down`; add `-v` to delete the database and start from the seeded data again.

Optional, build information only: to show the commit at `/api/v1/version`, run `git rev-parse --short HEAD` and paste the value into `.env` (for example `SC_GIT_COMMIT=3a4bbbd`) **before** `docker compose up -d --build --wait`. Compose doesn't run `$(…)` in `.env`. The value is baked into the api image at build time, so recreating a container doesn't change it; only a rebuild does.

### 3. Sign in (mock)

Sign-in is **simulated**. The sign-in screen lists fictional demo users (`GET /api/v1/auth/demo-users`). Picking one asks the API for a signed token (`POST /api/v1/auth/mock-login`, HS256 with `SC_JWT_SECRET`, 8-hour expiry). The API then validates that token on every request exactly as it would a real identity provider's token. Only the token issuer is fake. The `prod-like` profile (`SC_PROFILE=prod-like`) removes mock sign-in entirely.

| User | Roles | Scope | Use it for |
|---|---|---|---|
| M. Ellis | Supervisor, Employee | Units A, B | Planning board, overtime, time and payroll |
| J. Chen | Supervisor, Employee | Admissions, Control, Escort | Scope checks (can't see Unit B) |
| T. Nakamura | Employee | own records | My schedule, offers (accept/decline) |
| L. Fraser | Rules admin | none | Edit, build and submit rule changes |
| P. Singh | Rules approver | none | Approve and publish (not their own drafts) |
| A. Reviewer | Auditor | all, read-only | Reports and audit |
| Unit office TV | Display | counts only | Wall display |
| P. Planner | Planner | all units; the live board is read-only, the uncommitted quarter draft is theirs to edit and commit (plus preferences planning and the demo reset) | Quarter plan, draft edits, preferences, reset the demo data |

### Demo data and the quarter planner

A reset rebuilds a known state from a fixed seed. **About & version → Reset the demo data** (signed in as P. Planner) selects:
- **Dataset 100**: the default 100 officers × 90 days; roster and period checksum `4156077d…da6b`.
- **Dataset 120**: 100 full-time D12/N12/E8 crew officers plus 20 casual relief officers; checksum `82b19cf8…32ca`.
- **Dataset 150**: 120 full-time officers plus 30 part-time officers, with a deterministic 20% leave placement; checksum `2e6cd938…d7f8`.

The reset is asynchronous, one at a time and audited, takes a few seconds, and leaves the payroll golden file unchanged.

**Quarter plan** (P. Planner) builds the next quarter (Mon 4 Jan to Sun 11 Apr 2027, seven 14-day periods) from a fixed seed and the 8 h pattern (rotating 5 on / 2 off by default; fixed 5/2 and 7/3 are selectable and show their warnings). Every proposed shift goes through the same rules engine as the planning board; a Block leaves a visible gap. The scorecard, gaps, roster, compare and commit are on the same screen. The scorecard includes a read-only **Qualified staff** card: block-days with fewer qualified officers on duty than the unit's minimum, as a warning only.

Before committing, the planner can **change single shifts in the draft**: move one (time or unit), give it to another officer, remove it, or add one. Each change is checked by the same rules engine: a Block saves nothing, a Warn needs a second, acknowledged save, and there is no emergency override in a draft. The whole scorecard is worked out again after each change, edited shifts read "· edited", and each edit is in the audit log. Generating again or discarding drops the hand edits after a confirm.

Commit re-checks every shift, hand edits included, needs the warning list accepted once, and refuses a stale draft or a locked period. On Dataset 120 the measured draft is 38 gaps of 1,764 (all Escort evening), 7 warnings, zero Block, and 5,103 shifts on commit. The demo script in [`docs/demo-script.md`](docs/demo-script.md) §7 walks it.

**Known limits**, stated on the scorecard and in [`BUILD_RECORD.md`](BUILD_RECORD.md):
- **Rules (mock values, known defects):** U-03 and U-11 are dormant, because they key on the retired L16 template, so no new shift can trigger them. A 12 h + extension day is still bounded by U-02 and U-04 (Warn), U-01 and U-05 (Block); only the dedicated 12 h-rest Block is missing. L-01 still lists 16 h as a regular length (a 16 h day is 12 h + extension). P-01's 80 h per-period threshold makes 4-on/4-off 12 h crews built-in overtime, because U-13 cycle averaging is not built.
- **Planner:** qualifications are not used for placement (the Qualified staff card only reports them and does not read start dates); part-timers get no floor or fair share (casuals fill leftovers, home unit only, newest-first); seniority orders nights and overtime but not the casual pool; the quarter window is fixed and a plan commits once.
- **Leave and sick:** the planner enters planned leave (**Preferences → Add planned leave**, one `POST /api/v1/planner/absences` per day; PLANNER only, type only) and the next Generate skips it. The draft roster shows it as Vac, Sick or Other chips, but the live planning board does not, and there is no request, approval or limits. Datasets 100 and 120 seed no leave in the plan quarter; Dataset 150 seeds 20%. Sick is recorded after the fact, with no call-out flow.
- **Staffing:** Dataset 150 has enough people (138 FTE against about 127 needed, the Staffing card's floor); its gaps come from the part-time fill order, and Unit C has only 4 first-aiders for four 12 h crews. Dataset 100 is deliberately tight. See [`docs/roadmap.md`](docs/roadmap.md) for the findings and the ordered roadmap.
- Payroll overtime stays per pay period (P-01); a weekly threshold is refused by the validator.
- L16 is retired: a 16 h shift is a 12 h shift plus an extension, and an old database still renders its history.
- A late-recorded actual is not re-checked against shifts saved after it.
- The Dataset 120 preferences headline excludes the 13 shift-less casuals instead of counting their wishes.
- FR-06 is partial: publishing a period is recorded and shown on the board, but My schedule is not filtered by period status (the demo week is seeded DRAFT); see `docs/07-api-spec.md`.

### 4. Run the tests

All in Docker.

GitHub Actions (`.github/workflows/ci.yml`, on pull requests and pushes to `main`) runs the check scripts, the web lint, `tsc -b`, unit tests and build, and the API `mvn verify` below. **Playwright e2e is not in CI**: run it locally as described below; running it on Actions is a follow-up.

```sh
# Guard: a source or docs path hidden by .gitignore is invisible to git, so a clean
# checkout silently misses it. Run this before committing and again in the clean
# worktree used for the verified run.
./scripts/check-ignored-sources.sh

# API: rules boundary tests, repository tests (Testcontainers PostgreSQL), API and authorization tests.
# Takes about 15 minutes (measured at the release 11 gate); run it in the foreground and wait.
# Needs the Docker socket; .env must exist because compose reads the whole file.
# --build is required: compose otherwise reuses an old api-test image and a stale run can
# report BUILD SUCCESS for a tip that never ran.
docker compose --profile test run --rm --build api-test

# Web unit tests (Vitest)
docker run --rm -v "$PWD/web":/app -w /app node:24-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm test"

# End-to-end (Playwright, E1–E5, axe, keyboard-only E1/E3) against the running stack; see e2e/README.md.
# 1. Install the test dependencies in a container (no Node on the host):
docker run --rm -v "$PWD/e2e":/app -w /app node:24-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile"
# 2. Run the browser in a container. host.docker.internal reaches the host's web port (8080, or
#    your SC_WEB_PORT: export it in this shell too, a value only in .env is not seen here) on
#    Docker Desktop (macOS, Windows); --add-host makes the same name work on Linux.
#    EXPECT_COMMIT is required: the suite refuses a stack built from any other commit
#    (use the value you set as SC_GIT_COMMIT, or `git rev-parse --short HEAD`).
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:${SC_WEB_PORT:-8080} -e EXPECT_COMMIT=<the commit you built> \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop-datasets
```

**The UI test: how to run the Playwright suite yourself.** Chromium only (the config refuses any other browser), against the compose stack. What the suite covers, screen by role by state, is in [`e2e/COVERAGE.md`](e2e/COVERAGE.md); these commands are from [`e2e/README.md`](e2e/README.md).

```sh
# once: install the test dependencies in a container (no Node on the host)
docker run --rm -v "$PWD/e2e":/app -w /app node:24-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile"

# the stack the suite drives. ALWAYS give a test stack its own project with -p:
# docker-compose.yml pins `name: shiftcircle`, so a bare `docker compose` lands in
# the same project as a stack you already run by hand.
docker compose -p sc-test up -d --build --wait

# desktop viewport, real API (skip the fixtures-only specs). The commit guard
# requires EXPECT_COMMIT: the suite refuses to drive a stack running a build
# other than the one you name, and refuses port 18080 (kept for a hand-run stack)
# unless ALLOW_PERSON_STACK=yes.
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:${SC_WEB_PORT:-8080} -e EXPECT_COMMIT=<the commit you built> \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop-datasets

# tablet: the real-API specs change data, so a fresh stack per viewport
docker compose -p sc-test down -v && docker compose -p sc-test up -d --wait
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:${SC_WEB_PORT:-8080} -e EXPECT_COMMIT=<the commit you built> \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project tablet-datasets
```

**Port:** the e2e commands read `SC_WEB_PORT` from your shell and fall back to 8080. If you changed the port in `.env`, also `export SC_WEB_PORT=<port>` in the shell where you run them (or edit `BASE_URL`). `host.docker.internal` reaches the host from a container on Docker Desktop; the `--add-host` line makes the same name work on Docker Engine (run on macOS; on Linux it is **UNVERIFIED**, and `--network host` with `BASE_URL=http://localhost:${SC_WEB_PORT:-8080}` is the alternative). `E2E_WORKERS` (default 2) sets parallelism; `tests/screenshots.spec.ts` writes full-page captures and `index.json` to `SHOTS_DIR` (default `/private/tmp/sc-ui-shots/<RUN_ID>`, outside the repository: mount it the same way when the browser runs in Docker); the HTML report is `playwright-report/`. The fixtures-mode web and the `@api` / `@fixtures` tags are in `e2e/README.md`.

**Count:** API and Playwright counts run on `5a38580` (24 Nov 2026: release 11 plus the PR-H rules-wording fix; the web unit tests below were re-counted at `8ae4bbd`, PR #22's head), on a fresh stack per viewport (the API suite in GitHub CI, `mvn verify` on PR #19):
- API: **470 = 127 rules + 28 infrastructure + 315 api tests**, `mvn verify` green in the default class order, 0 failures/errors/skipped.
- Web unit tests (at `8ae4bbd`): **532** in 54 files; lint 0 errors (4 warnings); `tsc -b` clean.
- Playwright against the real API, whole suite per viewport (`--project desktop-datasets` and `--project tablet-datasets`, which run the parallel specs and then the stack-wide specs one at a time): desktop **124 passed**; tablet **123 passed and 1 skipped** (the TV-size check runs on desktop only); no failures on either.
- Fixtures: **23 passed**, 79 skipped (they need the real API), no failures.

The dataset checksums, the payroll golden and the plan fingerprints are unchanged: the v1.3 positions migration adds no unit and no employee rows, and the generator does not change. Earlier counts, release by release, are in [docs/process/release-notes.md](docs/process/release-notes.md); each round is in `docs/process/review-rounds.md`.

**One viewport per fresh stack; dataset specs last.** `--project desktop-datasets` runs the parallel `desktop` specs first, then the thirteen stack-wide specs (dataset resets, quarter-plan generate/commit/discard, the E4 pay-period lock) one at a time, because they would corrupt each other in parallel (`e2e/README.md`). The real-API specs change the data (an offer is confirmed, a rule version is published, a period is locked), so a second viewport run on the same database fails on the changed data. Run `--project desktop-datasets`, then `docker compose -p sc-test down -v && docker compose -p sc-test up -d --wait`, then `--project tablet-datasets`. The web unit tests write `web/node_modules` with Linux binaries.

**Fixtures and the shared test database:** each API test class gets its **own database** inside the shared PostgreSQL container (`PostgresTestSupport` creates one per class, and Flyway builds the schema), so class order cannot leak a generated roster, a published rule set or a linked employee into another class. Keep new fixtures off the demo day (19 Nov 2026) where the schedule and display tests assert exact Unit A coverage; dates after it are safer. When you change shared test infrastructure, also run reverse and random class order so a future regression is caught:

```sh
docker run --rm -v "$PWD/api":/src -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -w /src \
  maven:3.9-eclipse-temurin-21 ./mvnw -B test -Dsurefire.runOrder=reversealphabetical

docker run --rm -v "$PWD/api":/src -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -w /src \
  maven:3.9-eclipse-temurin-21 ./mvnw -B test \
  -Dsurefire.runOrder=random -Dsurefire.runOrderRandomSeed=20261120
```

### What is real and what is simulated

| Real | Simulated |
|---|---|
| Rules engine: Drools decision tables compiled from editable rows; rule checks with plain-language reasons | Sign-in: the token issuer is a mock; token validation is real |
| Safeguards: emergency-policy Blocks need an override with a written reason (≥ 10 characters), and other Blocks can't be overridden (ADR-023); maker/checker on rule versions (API and a database CHECK); append-only audit (database triggers); locked pay periods (trigger) | Payroll system: ShiftCircle produces the payroll CSV; nothing is sent anywhere |
| Role and unit scope on every endpoint (out of scope returns `404`) | People and data: 100, 120 or 150 fictional officers, generated from fixed seeds |
| Quarter planner: deterministic heuristic, every shift checked by the same rules engine, including the planner's hand edits to a draft | Collective-agreement values: many are MOCK placeholders to validate (`docs/05-union-rules.md`) |
| Period-based overtime classification and the payroll CSV | "Today" is fixed at 19 Nov 2026 (`SC_DEMO_TODAY`) |
| PostgreSQL with Flyway migrations | |

**Not built at all** (designed, but not in the prototype): the Excel round-trip for rule tables, the employee shift planner and proposals inbox, offer withdrawal, a payroll-clerk role, arrow-key grid navigation, the two extra selectable patterns measured for decision 15, and more. The full list, with what exists instead, is in [docs/10-testing.md §8](docs/10-testing.md#8-intentionally-not-built).

**Known limit, by decision (ADR-025):** on the `prod-like` profile the sign-in token is kept in memory only, so a page refresh, a new tab or a deep link asks you to sign in again ("Please sign in to continue."; the demo profile keeps the session across a same-tab refresh in `sessionStorage`, per the ADR-025 amendment) and then returns you to the screen you asked for.

## Licence

[MIT](LICENSE). All data in this repository is synthetic.
