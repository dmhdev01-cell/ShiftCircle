# ShiftCircle

A shift-scheduling prototype for a 24/7 provincial correctional centre. Supervisors plan 8, 12 and 16-hour shifts against a **configurable rules engine** (rest and hours limits, consecutive shifts, staffing, qualifications, overtime). Employees see their schedule and hours and propose shifts. Time feeds a payroll export, and reports show coverage and overtime as planned vs. actual.

> Built for the AI Solutions Architect screening assessment. **All data is synthetic.** Payroll and sign-on are simulated. The dataset is 100 fictional officers over 90 days.

> **Picking this up?** Start with [HANDOFF.md](HANDOFF.md).

## Architecture at a glance

Three containers: **web** (nginx + React) · **api** (Java 21 + Spring Boot 4.x + Drools rules engine) · **db** (PostgreSQL). See [docs/03-architecture.md](docs/03-architecture.md).

## Documentation

| Doc | What's in it |
|---|---|
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

Everything on `main` is merged: the api, all the screens, the mock sign-in and the e2e suite. Sections 1, 2 and 4 below were run from a fresh clone of `main` at `f1d696d` on 2026-11-20 (macOS, Docker Desktop); anything not run is marked **UNVERIFIED**.

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

**How long:** with Docker's build cache warm, `up -d --build --wait` took **31 s**. Inside that, the api was ready about 6 s after it started, and the demo data took 2.8 s (`Demo data generated in 2814 ms: 6182 assignments, 193 absences, 194 open shifts, 309 offers` in `docker compose logs api`). The very first build also downloads the base images and the Maven and pnpm dependencies, which takes several minutes depending on the network (**UNVERIFIED** on a machine with an empty cache). The dataset: 100 fictional officers, 1 Oct – 29 Dec 2026, "today" fixed at 19 Nov 2026, seed 20261001.

**Ports in use?** Only the web publishes a port. Set `SC_WEB_PORT` in `.env`, for example `SC_WEB_PORT=18080`, and open that port instead. For local debugging, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` also publishes the api (`SC_API_PORT`, default 8081) and the database (`SC_DB_PORT`, default 5433).

Checks once it's up (both checked):
- `http://localhost:8080/healthz` returns `ok`
- `http://localhost:8080/api/v1/version` returns the build, git commit, live rule-set version and `asOf`, for example `{"gitCommit":"f1d696d","ruleSetVersion":"v1","profiles":"demo","asOf":"2026-11-19",…}`

Stop with `docker compose down`; add `-v` to delete the database and start from the seeded data again.

Set `SC_GIT_COMMIT=$(git rev-parse --short HEAD)` in `.env` before building if you want the version screen to show the commit.

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

**Count:** a clean run at the merged tip `5e7765f` is **91 rules + 27 infrastructure + 183 api =
301 tests**, counted as `@Test` methods; Surefire reports the same total with **0 skipped**. The
infrastructure count is 27 on the web chain (it was 22 before the merge): the web branch added
`DemoDataReadinessTest` and `ReferenceDataHealthIndicatorTest`. The order-proof runs on 2026-11-20
(default order and random seed 20261120 at `5e7765f`; earlier, 296 = 91 + 22 + 183 at `dcee43b`,
and default and random order at `fe6487d`, reverse class order and random seeds at `22375d4`)
each gave the same total for their tip.

**One viewport per fresh stack.** The real-api specs change the data (an offer is confirmed, a rule version is published, a period is locked), so a second viewport run on the same database fails on the changed data. Run `--project desktop`, then `docker compose down -v && docker compose up -d --wait`, then `--project tablet`.

**Checked on the fresh clone:** both viewports on one stack gave 21 passed, 1 skipped and 4 failed, all 4 on tablet after desktop had changed the data; tablet alone on a fresh stack gave 12 passed, 1 skipped (the TV-size check runs on desktop only). The `--add-host` line was run on macOS; on Linux it is **UNVERIFIED** here (`--network host` with `BASE_URL=http://localhost:8080` is the alternative). Not run by this author: the `api-test` service (the builders and QA run the same Maven build; counts per round are in `docs/review-rounds.md`) and the web unit-test line in this clone (the same command passes in the branch worktrees). The web unit tests write `web/node_modules` with Linux binaries.

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
| Role and unit scope on every endpoint (out of scope returns `404`) | People and data: 100 fictional officers, generated with a fixed seed |
| Period-based overtime classification and the payroll CSV | Collective-agreement values: many are MOCK placeholders to validate (`docs/05-union-rules.md`) |
| PostgreSQL with Flyway migrations | "Today" is fixed at 19 Nov 2026 (`SC_DEMO_TODAY`) |

**Not built at all** (designed, but not in the prototype): the Excel round-trip for rule tables, the employee shift planner and proposals inbox, offer withdrawal, a payroll-clerk role, arrow-key grid navigation and more. The full list, with what exists instead, is in [docs/10-testing.md §8](docs/10-testing.md#8-intentionally-not-built).
