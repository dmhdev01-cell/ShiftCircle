# Install ShiftCircle

A standalone, Docker-only install guide for the ShiftCircle demo. It was derived from
`docker-compose.yml`, `.env.example`, `README.md` and
[`docs/08-deployment.md`](docs/08-deployment.md); the same steps are summarised in the
README's [Setup section](README.md#setup-clean-clone).

Everything runs in three containers: **web** (nginx + React), **api** (Java 21 + Spring
Boot + Drools) and **db** (PostgreSQL 17). No JDK, Maven, Node or database is needed on
the host.

## Quick install

One command (needs git, Docker with Compose v2, a running Docker daemon and a free port; it clones into `./ShiftCircle`, creates `.env` with freshly generated random secrets that it never prints, runs `docker compose up -d --build --wait`, and prints the URL):

```sh
curl -fsSL https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.1.1-submission/install.sh | bash
```

Prefer to read it first? Download, read, then run:

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.1.1-submission/install.sh
less install.sh
bash install.sh
```

Overrides (environment variables): `SC_WEB_PORT` (host port, default 8080), `COMPOSE_PROJECT_NAME` (default `shiftcircle`), `SHIFTCIRCLE_REF` (tag or branch to install, default the release tag), `SHIFTCIRCLE_DIR` (default `./ShiftCircle`). It refuses to touch an existing non-empty directory that is not a ShiftCircle checkout; re-running in the same place skips the clone and the `.env`. It never runs `docker compose down -v`. The manual steps are below.

## 1. Prerequisites

- Docker Desktop (macOS, Windows) or Docker Engine (Linux) with **Compose v2**.
  Check with `docker compose version`; the commands below use `docker compose`, not the
  old `docker-compose` binary.
- About **2 GB of free memory** for the containers (the guide budgets 64 MB for web,
  768 MB for the api and 256 MB for the database).
- One free host port. The web publishes **127.0.0.1:8080** by default (loopback only, not
  the LAN); the api and database are internal to the Docker network.
- Internet access for the first build: it downloads the base images and the Maven and
  pnpm dependencies. After the images are built, the stack runs offline (the font
  fallback is a system font).

## 2. Clone

```sh
git clone https://github.com/dmhdev01-cell/ShiftCircle.git
cd ShiftCircle
```

The repository is public, so no GitHub account is needed to clone it.

## 3. Create `.env` and the two secrets

The repository ships `.env.example` only. `.env` is gitignored and must never be
committed.

```sh
cp .env.example .env
```

Generate one value for each secret (any generator that meets the length rule works):

```sh
openssl rand -base64 18   # POSTGRES_PASSWORD: at least 8 characters
openssl rand -base64 48   # SC_JWT_SECRET: at least 32 characters
```

Paste them into `.env`, keeping the rest of the example's defaults:

```dotenv
POSTGRES_PASSWORD=<the first generated value>
SC_JWT_SECRET=<the second generated value>
```

`SC_PROFILE=demo` is already set in the example. It seeds synthetic data and enables the
mock sign-in screen; `prod-like` disables both. `SC_DEMO_TODAY` and `SC_DEMO_SEED` fix
the demo's "today" and its data generator seed, so the same seed rebuilds the same data.
The other settings are listed in [§11, Settings reference](#11-settings-reference).

Optional: to show a commit at `/api/v1/version`, run `git rev-parse --short HEAD` and
replace the empty `SC_GIT_COMMIT=` line in `.env` with `SC_GIT_COMMIT=<that value>`
**before** the build. Compose does not run `$(...)` inside `.env`; paste the literal
value. It is baked into the api image at build time.

## 4. Start

```sh
docker compose up -d --build --wait
```

`--wait` returns when all three containers are healthy: the database first, then the api
after it has run the Flyway migrations and generated the synthetic dataset, then the web.
The first build takes several minutes on an empty Docker cache; later starts are much
faster.

Open **http://localhost:8080**. The mock sign-in screen lists the demo users.

If port 8080 is already in use, set `SC_WEB_PORT` in `.env` before starting:

```dotenv
SC_WEB_PORT=9090
```

Then open `http://localhost:9090`. The web port is bound to `127.0.0.1`, so it is not
reachable from the LAN by default.

On a shared machine, give this stack its own Compose project name with `-p`:
`docker-compose.yml` pins `name: shiftcircle`, so a plain `docker compose up` adopts an
existing stack with that name instead of starting a separate one. Use the same `-p` on
every command for this checkout, for example
`docker compose -p shiftcircle-guide up -d --build --wait`. Setting
`COMPOSE_PROJECT_NAME=shiftcircle-guide` in the shell has the same effect (the `-p` flag
wins over the variable, and the variable wins over the file's `name:`; checked). Each
project has its own `pgdata` volume, so a second stack never shares data with the first.

## 5. Health check

Both checks go through the web container:

```sh
curl -fsS http://localhost:8080/healthz
# ok

curl -fsS http://localhost:8080/api/v1/version
```

The version response names the api build (`name`, `version`, `buildTime`), the commit
baked into the image, the live rule-set version, the active profile, the demo date
(`asOf`), `demoMode`, the available datasets and the dataset loaded now
(`activeDataset`), for example:

```json
{"name":"shiftcircle-api","version":"0.1.0-SNAPSHOT","buildTime":"<ISO instant>","gitCommit":"<commit>","ruleSetVersion":"v3","profiles":"demo","asOf":"2026-11-19","demoMode":true,"datasets":["100","120","150"],"activeDataset":"100"}
```

On the `prod-like` profile `demoMode` is `false`, `datasets` is empty and `activeDataset`
is `null`.

`gitCommit` reads `unknown` when `SC_GIT_COMMIT` was not set before the build; set it
and rebuild to change that.

Container state and logs:

```sh
docker compose ps
docker compose logs -f api
```

When a browser or test runs inside another container, `localhost:8080` means that
container, not this machine; use `http://host.docker.internal:8080` (or your `SC_WEB_PORT`) for the stack.

## 6. Demo profile, datasets and reset

The `demo` profile creates synthetic data and mock sign-in. There are no real people,
passwords or external services in the demo.

| Dataset | What it contains |
|---|---|
| `100` (default) | 100 fictional officers over the 90-day demo window |
| `120` | 100 full-time crew officers plus 20 casual relief officers |
| `150` | 120 full-time officers plus 30 part-time officers, with a deterministic 20% leave placement |

A reset rebuilds one dataset from its fixed seed. In the app:

1. Sign in as **P. Planner** (a demo-only account).
2. Open **About & version**.
3. Under **Reset the demo data**, choose `100`, `120` or `150`, type `RESET`, and click
   **Reset demo data**.

The reset is asynchronous, runs one at a time and is audited; it shows progress and the
resulting dataset checksum. Repeating the same dataset gives the same checksum. The API
endpoints behind the card are `POST /api/v1/demo/reset` and
`GET /api/v1/demo/reset/status` (PLANNER only); the UI is the supported path for this
guide. An unknown dataset is a `400` that lists the available values.

## 7. Demo accounts

Sign-in is simulated and exists only in the `demo` profile. Picking a user issues a
signed token; the api validates that token on every request as it would a real identity
provider's token. All names and data are fictional.

| User | Roles | Use it for |
|---|---|---|
| M. Ellis | Supervisor, Employee | Planning board, overtime, time and payroll |
| J. Chen | Supervisor, Employee | A second supervisor with a different unit scope |
| T. Nakamura | Employee | My schedule and shift offers |
| L. Fraser | Rules admin | Edit, build and submit rule changes |
| P. Singh | Rules approver | Approve and publish rule changes |
| A. Reviewer | Auditor | Read-only reports and audit log |
| Unit office TV | Display | Wall display counts |
| P. Planner | Planner | Quarter plan, preferences, demo reset |

Do not treat these accounts, the mock token issuer or any committed example value as
production credentials.

## 8. Upgrade

The database lives in the `pgdata` volume, so rebuilding the containers does not delete
it.

```sh
git pull
# if .env.example gained new settings, add them to your .env by hand; never overwrite .env
# optional: update SC_GIT_COMMIT to the new `git rev-parse --short HEAD` value
docker compose up -d --build --wait
```

The api applies any pending Flyway migrations when it starts. If the demo data should
match the new tip rather than the old seeded state, use the reset card (§6) after the
upgrade.

## 9. Stop and remove

```sh
# Stop and remove the containers and network; keep the database volume.
docker compose down

# Also delete the database volume. The next start re-creates and reseeds it.
docker compose down -v
```

Images stay on the machine after `down`; the next `up --build` reuses the build cache.

## 10. Troubleshooting

| Symptom | What to do |
|---|---|
| Compose stops with `required variable POSTGRES_PASSWORD is missing a value: POSTGRES_PASSWORD is not set - copy .env.example to .env and set it` | `.env` is missing or the value is empty. Run `cp .env.example .env` and fill in both secrets (§3). |
| The api exits and its log names `SC_JWT_SECRET` | The secret is missing or shorter than 32 characters. Generate a new value (§3) and `docker compose up -d --build --wait` again. |
| `Bind for 127.0.0.1:8080 failed: port is already allocated` (the message contains `address already in use`) | Another process owns 8080. Set `SC_WEB_PORT=9090` in `.env`, start again and open `http://localhost:9090`. |
| `--wait` times out or a container is unhealthy | Run `docker compose ps` and `docker compose logs api` (or `db`, `web`). The first api start can take a minute or more; check Docker has about 2 GB free. |
| `/api/v1/version` reports `gitCommit: "unknown"` | `SC_GIT_COMMIT` was empty when the image was built. Set it in `.env` and rebuild. |
| The reset card shows `FAILED` | Retry the reset. A reset and a planner generate/commit cannot run at the same time; wait for the other operation to finish. |
| A second checkout conflicts with the first | `docker-compose.yml` fixes the project name to `shiftcircle`. For a second copy, use a unique project and port: `docker compose -p shiftcircle-test up -d --build --wait` with a different `SC_WEB_PORT`. |
| Apple Silicon | No `--platform` override is needed; the stack uses multi-arch official images. If Docker warns about amd64 emulation, fix Docker Desktop's architecture setting rather than adding a flag. |
| Running the Playwright suite from Linux | The install itself needs no extra flag. A browser container cannot reach the stack at `localhost:8080`; use `BASE_URL=http://host.docker.internal:8080` (or your `SC_WEB_PORT`) and add `--add-host=host.docker.internal:host-gateway` (macOS/Windows do not need it). See [`e2e/README.md`](e2e/README.md); Linux is unverified in this repository. |

## 11. Settings reference

Set these in `.env` (Compose reads it automatically). Only the first two have no default.

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | none, required | Database password, at least 8 characters. Compose refuses to start without it. |
| `SC_JWT_SECRET` | none, required | Signs the mock sign-in tokens (HS256), at least 32 characters. The api refuses to start without it. |
| `POSTGRES_DB`, `POSTGRES_USER` | `shiftcircle` | Database name and user. |
| `SC_PROFILE` | `demo` | `demo`: synthetic data, mock sign-in and the reset card. `prod-like`: neither. |
| `SC_DEMO_TODAY` | `2026-11-19` | The "today" the demo pretends it is. |
| `SC_DEMO_SEED` | `20261001` | Seed for the demo data generator. |
| `SC_GIT_COMMIT` | `unknown` | Build information only: the commit shown at `/api/v1/version`. Baked in at build time (§3). |
| `SC_WEB_PORT` | `8080` | Host port of the web, bound to `127.0.0.1` (§4). |
| `VITE_PERSIST_DEMO_SESSION` | unset (persistence on) | Demo session kill switch, build time. On the `demo` profile the web keeps the sign-in in `sessionStorage` so a refresh does not sign you out (ADR-025 amendment). Set it to exactly `false` in `.env` and rebuild (`docker compose up -d --build --wait`) to build a web that never stores the session; a refresh then asks for sign-in again. It is ignored on `prod-like`, which never persists. |
| `SC_API_PORT`, `SC_DB_PORT` | `8081`, `5433` | Only with the debugging override `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`, which publishes the api and the database on `127.0.0.1` only. Not needed for a normal install. |

`SC_BUSINESS_TZ` (`America/Regina`) is fixed in `docker-compose.yml`.
