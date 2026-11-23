# ShiftCircle

A shift-scheduling prototype for a 24/7 provincial correctional centre. Supervisors plan 8- and 12-hour shifts (a 16 h day is a 12 h shift plus an extension) against a **configurable rules engine** (rest and hours limits, consecutive shifts, staffing, qualifications, overtime), and a planner builds a whole-quarter draft through the same engine. Employees see their schedule and hours and propose shifts. Time feeds a payroll export, and reports show coverage and overtime as planned vs. actual.

> Built for the AI Solutions Architect screening assessment. **All data is synthetic.** Payroll and sign-on are simulated. The default demo seeds 100 fictional officers over 90 days; the quarter planner also offers a **120-officer crew dataset** from the About reset card.

> **Picking this up?** Start with [HANDOFF.md](HANDOFF.md).

## Architecture at a glance

Three containers: **web** (nginx + React) · **api** (Java 21 + Spring Boot 4.x + Drools rules engine) · **db** (PostgreSQL). See [docs/03-architecture.md](docs/03-architecture.md).

## Documentation

| Doc | What's in it |
|---|---|
| [INSTALL.md](INSTALL.md) | Standalone Docker-only install guide: prerequisites, secrets, start, health check, demo datasets and reset, upgrade, removal, troubleshooting |
| [docs/01-scope-and-plan.md](docs/01-scope-and-plan.md) | Problem, users, outcomes, feature priorities, assumptions, plan, open questions |
| [docs/02-requirements.md](docs/02-requirements.md) | Screens, functional and non-functional requirements, rules catalogue, data model, test cases |
| [docs/03-architecture.md](docs/03-architecture.md) | Containers, layers, change flow, frontend, security |
| [docs/04-rules-engine.md](docs/04-rules-engine.md) | Rules engine design: Drools decision tables a non-technical admin can edit |
| [docs/05-union-rules.md](docs/05-union-rules.md) | Mock collective-agreement rule set, with each rule's source |
| [docs/06-data-model.md](docs/06-data-model.md) | PostgreSQL tables, constraints, ER diagram, migrations and seed |
| [docs/07-api-spec.md](docs/07-api-spec.md) | REST endpoints, rule-check/override contract, error format, screen-to-endpoint map |
| [docs/08-deployment.md](docs/08-deployment.md) | Docker Compose topology, configuration, startup, nginx, path to pilot |
| [docs/09-access-control.md](docs/09-access-control.md) | Roles, permission matrix, enforcement, mock sign-in, privacy |
| [docs/10-testing.md](docs/10-testing.md) | Test strategy, rule boundary matrix, scenarios, E2E flows, demo dataset spec |
| [docs/ui/README.md](docs/ui/README.md) | UI spec: Sask design tokens, components, every screen; design files in `docs/ui/screens/` |
| [docs/ai-dev-log.md](docs/ai-dev-log.md) | AI-assisted development log (assessment requirement) |
| [docs/decisions.md](docs/decisions.md) | Decision log (ADRs) |

**UI design:** six screens (planning board, my schedule, overtime board, rules admin, reports, wall display) are specified in `docs/ui/`. The original design canvas is a private Claude artifact owned by the project lead.

## Setup (clean clone)

Everything on `main` is merged: the api, all the screens, the mock sign-in, the quarter planner and the e2e suite. Sections 1, 2 and 4 below were run from a fresh clone of `main` at `f1d696d` on 2026-11-20 (macOS, Docker Desktop); the commands are unchanged at the final tip `5d0f810`, and the final counts are in §4. Anything not run is marked **UNVERIFIED**.

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

If either is missing, `docker compose` stops before starting anything, with `required variable POSTGRES_PASSWORD is missing a value: … copy .env.example to .env and set it` (checked: `docker compose --env-file /dev/null config`). If either is too short, the api refuses to start and says which one.

### 2. Start

```sh
docker compose up -d --build --wait
```

`--wait` returns when all three containers are healthy: the database first, then the api (after it has run the Flyway migrations and generated the synthetic dataset), then the web. Then open **http://localhost:8080** and you see the mock sign-in screen with the demo users.

**How long:** with Docker's build cache warm, `up -d --build --wait` took **31 s**. Inside that, the api was ready about 6 s after it started, and the demo data took 2.8 s (`Demo data generated in 2814 ms: 6182 assignments, 193 absences, 194 open shifts, 309 offers` in `docker compose logs api`). The very first build also downloads the base images and the Maven and pnpm dependencies, which takes several minutes depending on the network (**UNVERIFIED** on a machine with an empty cache). The default dataset: 100 fictional officers, 1 Oct – 29 Dec 2026, "today" fixed at 19 Nov 2026, seed 20261001. The About reset card can also load the 120-officer crew dataset (see “Demo data and the quarter planner”).

**Ports in use?** Only the web publishes a port, and it is bound to **127.0.0.1** (not the LAN) because the demo has mock sign-in and a destructive reset. Set `SC_WEB_PORT` in `.env`, for example `SC_WEB_PORT=18080`, and open that port instead. For local debugging, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` also publishes the api (`SC_API_PORT`, default 8081) and the database (`SC_DB_PORT`, default 5433).

Checks once it's up (both checked):
- `http://localhost:8080/healthz` returns `ok`
- `http://localhost:8080/api/v1/version` returns the build, git commit, live rule-set version and `asOf`, for example `{"gitCommit":"f1d696d","ruleSetVersion":"v1","profiles":"demo","asOf":"2026-11-19",…}`

Stop with `docker compose down`; add `-v` to delete the database and start from the seeded data again.

Optional, build information only: to show the commit at `/api/v1/version`, run `git rev-parse --short HEAD` and paste the value into `.env` (for example `SC_GIT_COMMIT=3a4bbbd`) **before** `docker compose up -d --build --wait`. Compose doesn't run `$(…)` in `.env`. The value is baked into the api image at build time, so recreating a container doesn't change it; only a rebuild does.

### 3. Sign in (mock)

Sign-in is **simulated**. The sign-in screen lists fictional demo users (`GET /api/v1/auth/demo-users`). Picking one asks the api for a signed token (`POST /api/v1/auth/mock-login`, HS256 with `SC_JWT_SECRET`, 8-hour expiry). The api then validates that token on every request exactly as it would a real identity provider's token. Only the token issuer is fake. The `prod-like` profile (`SC_PROFILE=prod-like`) removes mock sign-in entirely.

| User | Roles | Scope | Use it for |
|---|---|---|---|
| M. Ellis | Supervisor, Employee | Units A, B | Planning board, overtime, time and payroll |
| J. Chen | Supervisor, Employee | Admissions, Control, Escort | Scope checks (can't see Unit B) |
| T. Nakamura | Employee | own records | My schedule, offers (accept/decline) |
| L. Fraser | Rules admin | — | Edit, build and submit rule changes |
| P. Singh | Rules approver | — | Approve and publish (not their own drafts) |
| A. Reviewer | Auditor | all, read-only | Reports and audit |
| Unit office TV | Display | counts only | Wall display |
| P. Planner | Planner | all, read-only (plus preferences planning and the demo reset) | Quarter plan, preferences, reset the demo data |

### Demo data and the quarter planner

A reset rebuilds a known state from a fixed seed. **About & version → Reset the demo data** (signed
in as P. Planner) selects **`100`** (the default 100 officers × 90 days; roster and period checksum
`4156077d…da6b`) or **`120`** (100 full-time D12/N12/E8 crew officers plus 20 casual relief
officers; checksum `82b19cf8…32ca`). The reset is asynchronous, one at a time and audited, takes a
few seconds, and leaves the payroll golden file unchanged.

**Quarter plan** (P. Planner) builds the next quarter — Mon 4 Jan to Sun 11 Apr 2027, seven 14-day
periods — from a fixed seed and the 8 h pattern (rotating 5 on / 2 off by default; fixed 5/2 and
7/3 are selectable and show their warnings). Every proposed shift goes through the same rules engine
as the planning board; a Block leaves a visible gap. The scorecard, gaps, compare and commit are on
the same screen; commit re-checks the plan, needs the warning list accepted once, and refuses a
stale draft or a locked period. On dataset 120 the measured draft is 38 gaps of 1,764 (all Escort
evening), 7 warnings, zero Block, and 5,103 shifts on commit. The demo script in
[`docs/demo-script.md`](docs/demo-script.md) §7 walks it.

**Known limits**, stated on the scorecard and in [`BUILD_RECORD.md`](BUILD_RECORD.md): the planner
does not enforce qualifications; the demo plan has no leave unless you enter it with
`POST /api/v1/planner/absences` (PLANNER only, a read-only skip, no approval flow); payroll overtime
stays per pay period (P-01); L16 is retired (a 16 h shift is a 12 h shift plus an extension; an
old database still renders its history); a late-recorded actual is not re-checked against shifts
saved after it; and the 120 preferences headline excludes the 13 shift-less casuals instead of
counting their wishes (release 4 #14).

### 4. Run the tests

All in Docker.

```sh
# Guard: a source or docs path hidden by .gitignore is invisible to git, so a clean
# checkout silently misses it. Run this before committing and again in the clean
# worktree used for the verified run.
./scripts/check-ignored-sources.sh

# API: rules boundary tests, repository tests (Testcontainers PostgreSQL), API and authorization tests.
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
# 2. Run the browser in a container. host.docker.internal reaches the host's port 8080 on
#    Docker Desktop (macOS, Windows); --add-host makes the same name work on Linux.
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:8080 \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop
```

**The UI test: how to run the Playwright suite yourself.** Chromium only — the config refuses any
other browser — against the compose stack. What the suite covers, screen by role by state, is in
[`e2e/COVERAGE.md`](e2e/COVERAGE.md); these commands are from [`e2e/README.md`](e2e/README.md).

```sh
# once: install the test dependencies in a container (no Node on the host)
docker run --rm -v "$PWD/e2e":/app -w /app node:24-alpine \
  sh -c "corepack enable && pnpm install --frozen-lockfile"

# the stack the suite drives. ALWAYS give a test stack its own project with -p:
# docker-compose.yml pins `name: shiftcircle`, the same project as the person's
# trial stack on 18080, so a bare `docker compose` can land in their stack.
docker compose -p sc-test up -d --build --wait

# desktop viewport, real api (skip the fixtures-only specs). The commit guard
# requires EXPECT_COMMIT: the suite refuses to drive a stack running a build
# other than the one you name, and refuses port 18080 (the person's trial stack)
# unless ALLOW_PERSON_STACK=yes.
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:8080 -e EXPECT_COMMIT=<the commit you built> \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop

# tablet: the real-api specs change data, so a fresh stack per viewport
docker compose -p sc-test down -v && docker compose -p sc-test up -d --wait
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/e2e":/work -w /work \
  -e BASE_URL=http://host.docker.internal:8080 -e EXPECT_COMMIT=<the commit you built> \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project tablet
```

`host.docker.internal` reaches the host from a container on Docker Desktop; the `--add-host` line
makes the same name work on Docker Engine. `E2E_WORKERS` (default 2) sets parallelism;
`tests/screenshots.spec.ts` writes full-page captures and `index.json` to `SHOTS_DIR` (default
`/private/tmp/sc-ui-shots/<RUN_ID>`, outside the repository: mount it the same way when the browser
runs in Docker); the HTML report is `playwright-report/`. The fixtures-mode web and the `@api` /
`@fixtures` tags are in `e2e/README.md`.

**Count:** the latest independent runs are dev-qa's at the final tip `5d0f810`. API: **422 = 123
rules + 27 infrastructure + 272 api tests**, green in the default order and with random seed
20261121, 0 failures/errors/skipped. Web unit tests: **277**. Playwright against the real api, whole
suite, a fresh stack per viewport: desktop **101 passed / 0 failed**, tablet **100 passed + 1
skipped** (the TV-size check is desktop-only) **/ 0 failed**; fixtures: **22 passed and 21**. The
static counts in this tree agree (123 + 27 + 272 `@Test` methods, one per line, no parameterised
tests). The dataset checksums, the earlier runs and each round are in `docs/review-rounds.md`
(R61 is the final independent one) and `BUILD_RECORD.md`. review-r3's security fixes on `p3-sec`
add three api tests: an author run at `74a58c0` is **425 = 123 + 27 + 275** in both orders; dev-qa
verification is pending. The phase 3 preference/pattern branch (`p3-pref`, final tip at handover)
adds 19 api tests: an author run is **444 = 123 + 27 + 294** in the default order (dev-qa runs both
orders), web **290**; dev-qa's gate is pending. The 120 and 100 drafts are shift-for-shift
sha256-identical to `c9ac073`, and the checksums and payroll golden are unchanged.

Release 3 (`p4-unit`, final tip at handover; dev-qa gate pending) adds dated unit closures,
closed-unit relief and the staffing estimate. The branch was authored as **450 = 123 + 27 + 300** in a clean default run before dataset 150; its two 150 tests are green, web **313**. The full 452 run belongs to dev-qa's gate: my repeat at the 150 tip was killed by the harness timeout under host load, not by a test failure. With no closure rows the 120/100 fingerprints and all checksums stay identical, and 150 has its own pinned checksum and plan.

Release 4 (`p5`, final tip at handover; dev-qa gate pending) adds the #20 Block + ACKNOWLEDGE pin, #14 `Not rostered` status and the corrected preference headline (120: 196 of 214, 92%, scorecard = Compare), the #17 owner-token demo lock, the #10 U-16 Warn/acknowledge rule (rule-set v3, V12) for an 8 h officer on a night shift, and the #16 48/60 wording. Author run on the merged tree in Docker: **460 = 127 rules + 27 infrastructure + 306 api**, 0 failures/errors/skipped; web **316**; audit codes **49**. dev-qa's gate found the pre-existing Rules Shift types route shadow (the literal route won without a table param, so the table with U-16 was unreachable); dev-build2 fixed it red-first on `p5-web2 e9e9ff3`, merged here, and the router test pins `/rules/7/shift-types`. The 100/120/150 checksums, the three plan fingerprints and the payroll golden are exact; 120 stays 38 gaps / 7 warnings / 5,103 shifts / 107 officers.

**One viewport per fresh stack.** The real-api specs change the data (an offer is confirmed, a rule version is published, a period is locked), so a second viewport run on the same database fails on the changed data. Run `--project desktop`, then `docker compose -p sc-test down -v && docker compose -p sc-test up -d --wait`, then `--project tablet`.

**Earlier fresh-clone check (history at `f1d696d`):** both viewports on one stack gave 21 passed, 1 skipped and 4 failed, all 4 on tablet after desktop had changed the data; tablet alone on a fresh stack gave 12 passed, 1 skipped (the TV-size check runs on desktop only). The `--add-host` line was run on macOS; on Linux it is **UNVERIFIED** here (`--network host` with `BASE_URL=http://localhost:8080` is the alternative). Not run by this author: the `api-test` service (the builders and QA run the same Maven build; counts per round are in `docs/review-rounds.md`) and the web unit-test line in this clone (the same command passes in the branch worktrees). The web unit tests write `web/node_modules` with Linux binaries.

**Fixtures and the shared test database:** each API test class gets its **own database** inside the
shared PostgreSQL container (`PostgresTestSupport` creates one per class, and Flyway builds the
schema), so class order cannot leak a generated roster, a published rule set or a linked employee
into another class. Keep new fixtures off the demo day (19 Nov 2026) where the schedule and display
tests assert exact Unit A coverage; dates after it are safer. When you change shared test
infrastructure, also run reverse and random class order so a future regression is caught:

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
| Role and unit scope on every endpoint (out of scope returns `404`) | People and data: 100 fictional officers, or the 120-officer crew dataset, generated from fixed seeds |
| Quarter planner: deterministic heuristic, every shift checked by the same rules engine; the 120 crew dataset is selectable from the reset card | — |
| Period-based overtime classification and the payroll CSV | Collective-agreement values: many are MOCK placeholders to validate (`docs/05-union-rules.md`) |
| PostgreSQL with Flyway migrations | "Today" is fixed at 19 Nov 2026 (`SC_DEMO_TODAY`) |

**Not built at all** (designed, but not in the prototype): the Excel round-trip for rule tables, the employee shift planner and proposals inbox, offer withdrawal, a payroll-clerk role, arrow-key grid navigation, the two extra selectable patterns measured for decision 15, and more. The full list, with what exists instead, is in [docs/10-testing.md §8](docs/10-testing.md#8-intentionally-not-built).

**Known limit, by decision (ADR-025):** the sign-in token is kept in memory only, so a page refresh, a new tab or a deep link asks you to sign in again ("Please sign in to continue.") and then returns you to the screen you asked for.

Release 5 (`p6`, API tip `60f8f7d`; web merge and gate follow) retires L16: the 100 seed has no 16 h rows, V13 sets the template inactive without deleting old history, and new assignments/open shifts naming it get a plain 400. PC-03 is rebuilt as a P12 + 5 h actual (17 h). New 100 pins: checksum **`4156077d…da6b`**, payroll golden **`9f2d51b3…04ff`** (1,037 rows, 8,197.60 h); the 100 plan fingerprint is unchanged (`ec337014…409e1b`, 6,586 rows, 727 gaps) and its warnings move **117 → 135** because removing L16 history exposed 18 real U-14 plan warnings that the old baseline subtracted. The gate repair restored PC-01 (U-01/U-05/U-08/U-14 at 64 h) and Tara's block-free Sun 29 pick-up; the 100 checksum moved again to `4156077d…da6b`, while the golden and plan stayed exact. 120/150 checksums and fingerprints are exact. Author run: **462 = 127 rules + 28 infrastructure + 307 api**; web 318 at the p6-web merge.

Release 6 (#6 Option A, `p7`, API tip `da08dde`; web merge and gate follow) adds a read-only **Qualified staff** card to the quarter plan: failing/checked block-days per unit and block, with the sentence “N block-days are below the qualified minimum. The planner does not enforce this.” Measured with no closures: 100 **346 of 1,470**, 120 **0 of 1,470**, 150 **103 of 1,470**. Closed unit-days are not checked; relief counts where placed; qualification start dates are not checked. Checksums, golden and plan fingerprints unchanged. Author run **462 = 127 + 28 + 307**; web **325/325** at the merged tip, build clean, lint 4 pre-existing, audit 49.
