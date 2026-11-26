# Install ShiftCircle

A standalone, Docker-only install guide for the ShiftCircle demo. It was derived from
`docker-compose.yml`, `.env.example`, `README.md` and
[`docs/08-deployment.md`](docs/08-deployment.md); the same steps are summarised in the
README's [Setup section](README.md#setup-clean-clone).

Everything runs in three containers: **web** (nginx + React), **api** (Java 21 + Spring
Boot + Drools) and **db** (PostgreSQL 17). No JDK, Maven, Node or database is needed on
the host.

## Quick install

One command. It needs a bash shell (macOS, Linux, or on Windows a **WSL2 Ubuntu terminal**, not PowerShell or cmd: see [Windows (WSL2)](#windows-wsl2); without WSL, see [Windows without WSL](#windows-without-wsl-hyper-v)), `curl`, `git`, Docker with Compose v2, a running Docker daemon and a free port. It clones into `./ShiftCircle`, creates `.env` with freshly generated random secrets that it never prints, runs `docker compose up -d --build --wait`, checks `/healthz` and `/api/v1/version`, and prints the URL:

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.3/install.sh && bash install.sh
```

A failed download stops at the `curl` step with a non-zero exit. (`curl -fsSL <url> | bash` also works, because the script does nothing until it has all been read, but the pipe reports bash's exit status, so a failed download looks like success.) The safest way is to read it first:

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.3/install.sh
less install.sh
bash install.sh
```

**Course submission:** the version submitted for the assessment is the release tag **`v1.3`**, which the one-liner above installs (supervisors on their own posts and shift proposals, on top of v1.2). The earlier submission build was the tag `v1.1.2-submission` (v1.1.1 plus the staffing-shortfall hotfix); its own `install.sh` stays pinned to that tag, so the same one-liner with `v1.1.2-submission` in place of `v1.3` still installs it exactly.

Overrides (environment variables, put them before `bash install.sh`): `SC_WEB_PORT` (host port, 1-65535, default 8080, for example `SC_WEB_PORT=9090 bash install.sh`), `SHIFTCIRCLE_PROJECT` (compose project name, default `shiftcircle`; a `COMPOSE_PROJECT_NAME` already in your shell is ignored on purpose), `SHIFTCIRCLE_REF` (tag or branch to install, default the release tag), `SHIFTCIRCLE_DIR` (default `./ShiftCircle`), and, advanced, `SHIFTCIRCLE_REPO` (clone URL). The port and project name are saved in `.env` (`SC_WEB_PORT`, `COMPOSE_PROJECT_NAME`). It refuses to touch an existing non-empty directory that is not a ShiftCircle checkout; re-running in the same place skips the clone and keeps the `.env` (it only fills a blank secret). It never runs `docker compose down`. The manual steps are below.

**Already running ShiftCircle (or anything else) under the compose project name `shiftcircle`?** Compose knows a stack only by its project name, so a second install under the same name would take over the first one (recreate its containers, reuse its database volume, and then fail with `password authentication failed`). So give a second copy its own name, for example `SHIFTCIRCLE_PROJECT=shiftcircle-2 SC_WEB_PORT=9090 bash install.sh`; you can check which names are taken with `docker compose ls -a`. The `install.sh` on `main` (after the `v1.3` tag; the `v1.3` one-liner above does not have it yet) checks this for you: if containers of that project were started from another directory, or volumes of it exist that this checkout did not create (a fresh install, or a re-run whose `.env` does not record them), it stops with exit code 20 without touching the other stack. A fresh install has already cloned `./ShiftCircle` by then; run it again with another `SHIFTCIRCLE_PROJECT` and the clone is skipped. Re-running in the same directory is unaffected. If you moved or renamed a checkout, its old containers still name the old path: `docker compose -p <name> down` (keeps the database volume) and run the installer again.

## Windows (WSL2)

Checked on 26 Nov 2026 by inspection and simulation on macOS and Linux containers; not yet
run on a Windows laptop (**UNVERIFIED** there).

1. Install **Docker Desktop** with the **WSL 2 based engine** (the default), and a WSL2
   Ubuntu distribution (`wsl --install -d Ubuntu` in an administrator PowerShell, then
   restart).
2. In Docker Desktop: **Settings → Resources → WSL integration**, turn on your Ubuntu
   distribution, **Apply & restart**. Without it, `docker` is not found inside Ubuntu and
   the installer stops with exit 11 ("docker is not installed").
3. Open the **Ubuntu** terminal (not PowerShell, not cmd) and run the one-liner from your
   Linux home folder (`cd ~`), not from `/mnt/c/...`. Ubuntu ships `bash`, `curl` and
   `git`; if `git` is missing, `sudo apt-get install -y git curl`.
4. Open the printed address in your Windows browser: Docker Desktop publishes
   `127.0.0.1:<port>` on Windows too.

Why not PowerShell: in Windows PowerShell `curl` is a different command
(`Invoke-WebRequest`, which rejects `-fsSLo`), `&&` does not exist in PowerShell 5.1, and
`bash` may start WSL rather than the shell you expect.

**Git Bash** works only if Git does not convert line endings. Git for Windows defaults to
`core.autocrlf=true`; the checkout then has CRLF line endings and the installer stops with
exit 17, `POSTGRES_PASSWORD in ShiftCircle/.env is shorter than 8 characters` (the
"value" it read is the stray carriage return). The `v1.3` tag has no `.gitattributes`, so
it cannot force LF. (`main`, after `v1.3`, has one that checks every file out with LF, and its
`install.sh` also ignores a stray carriage return in `.env`.) In Git Bash with `v1.3`, delete
the half-made `ShiftCircle` folder and run:

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false bash install.sh
```

This changes no global Git setting. Everything else in a CRLF checkout (Dockerfiles,
`nginx.conf`, sources) builds and runs; only the installer's `.env` parsing is affected
(checked by a simulated `core.autocrlf=true` clone of `v1.3`).

**Memory:** the stack needs about 0.5 GB running and about 1 GB while building; WSL2 gives
Docker half the machine's memory by default, which is enough on an 8 GB laptop. If a
`.wslconfig` caps it, keep `memory=2GB` or more under `[wsl2]` and run `wsl --shutdown`.

**Ports:** the installer's port check runs inside WSL. A Windows program that already owns
8080 may not be visible there; the start then fails with `Bind for 127.0.0.1:8080 failed:
port is already allocated` and exit 18. Re-run with `SC_WEB_PORT=9090 bash install.sh`.

## Windows without WSL (Hyper-V)

Docker Desktop on **Windows Home requires WSL2**. The **Hyper-V backend** (no WSL) needs
Windows 10/11 **Pro, Enterprise or Education** and is common on managed laptops. Docker
Desktop must be in **Linux containers** mode (tray menu: "Switch to Linux containers…"
if it offers that); in Windows containers mode the base images do not exist. Its memory
is set under **Settings → Resources → Advanced**; the default (2 GB) fits this stack
(about 1 GB building, 0.5 GB running). Not yet run on a real Windows laptop: everything
below is **UNVERIFIED on Windows**; what was checked elsewhere is said in each step.

**A. Git Bash** (comes with Git for Windows). Docker Desktop puts `docker` on the PATH,
so the one-liner runs there, but Git for Windows converts line endings by default, which
stops the installer with exit 17. This form switches that off for the clone only (no
global Git setting changes; checked with a simulated `core.autocrlf=true` clone):

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/v1.3/install.sh && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false bash install.sh
```

If an earlier run stopped with exit 17, delete the `ShiftCircle` folder first.

**B. PowerShell only (no bash).** In PowerShell (5.1 or 7), from the folder you want:

```powershell
git -c core.autocrlf=false clone --depth 1 --branch v1.3 https://github.com/dmhdev01-cell/ShiftCircle.git
cd ShiftCircle

# .env from .env.example with two random secrets and the commit (hex, never printed).
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function New-Secret([int]$n) { $b = New-Object byte[] $n; $rng.GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
$commit = git rev-parse --short HEAD
$lines = Get-Content .env.example | ForEach-Object {
  if ($_ -eq 'POSTGRES_PASSWORD=') { 'POSTGRES_PASSWORD=' + (New-Secret 24) }
  elseif ($_ -eq 'SC_JWT_SECRET=') { 'SC_JWT_SECRET=' + (New-Secret 32) }
  elseif ($_ -eq 'SC_GIT_COMMIT=') { 'SC_GIT_COMMIT=' + $commit }
  else { $_ }
}
# UTF-8 without BOM, LF endings. (Set-Content/Out-File in PowerShell 5.1 add a BOM.)
[IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))

docker compose up -d --build --wait
```

Then open **http://localhost:8080/login**. If 8080 is taken, run
`$env:SC_WEB_PORT = 9090` before `docker compose up` and open port 9090. Stop with
`docker compose down` (add `-v` to delete the demo database). `Join-Path` matters:
`WriteAllText` with a bare `.env` writes to the process folder, not the PowerShell one.

Checked on macOS with PowerShell 7.7: the script writes a `.env` with no BOM, no CR, a
48-character `POSTGRES_PASSWORD`, a 64-character `SC_JWT_SECRET` and the commit, and
every other line unchanged (also from a CRLF `.env.example`); `docker compose up -d
--build --wait` on that `.env` became healthy and `/api/v1/version` showed the commit.
Not checked: Windows PowerShell 5.1. Docker Compose 5.6 also accepted a `.env` with CRLF
endings and a BOM (the api started), but older Compose versions may not, so write it as
above.

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
The first build downloads the base images and about 600 Maven artifacts plus the pnpm
packages: 68 s on an empty Docker with a fast network (measured 26 Nov 2026), several
minutes on a slower one. Later starts take well under a minute.

Open **http://localhost:8080/login**. The mock sign-in screen lists the demo users, and each
user lands on their own home page. (From the bare `http://localhost:8080` every user first
lands on the Planning board, which an officer, rules admin, rules approver or the wall display
may not read; use the side menu. See §10.)

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
{"name":"shiftcircle-api","version":"0.1.0-SNAPSHOT","buildTime":"<ISO instant>","gitCommit":"<commit>","ruleSetVersion":"v4","profiles":"demo","asOf":"2026-11-19","demoMode":true,"datasets":["100","120","150"],"activeDataset":"100"}
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
| Install stops with exit 17, `POSTGRES_PASSWORD in ShiftCircle/.env is shorter than 8 characters`, on a fresh install | The checkout has Windows (CRLF) line endings, usually Git Bash. Delete the `ShiftCircle` folder and follow [Windows (WSL2)](#windows-wsl2). |
| `warning: refs/tags/v1.3 … is not a commit!` while cloning | Harmless: `v1.3` is an annotated tag and a shallow clone of it prints this. The install continues. (Git's detached-HEAD advice is turned off by the `install.sh` on `main`.) |
| Signed in as T. Nakamura, L. Fraser, P. Singh or Unit office TV and the Planning board says "Could not load the schedule" | `v1.3` only: you opened the bare `http://localhost:8080`, which goes to the Planning board, and signed in there. Use the side menu, or open `http://localhost:8080/login`. Nothing is broken. On `main` (after `v1.3`) each user lands on their own home page. |
| `port 8080 on 127.0.0.1 is already in use` (exit 14) | Re-run with another port: `SC_WEB_PORT=9090 bash install.sh`. It is saved to `.env`, so later re-runs keep it. |
| `a Docker Compose project named '…' already exists` or `Docker volumes of a compose project named '…' already exist` (exit 20, `install.sh` on `main`) | That project name belongs to another install. Run again with your own name, for example `SHIFTCIRCLE_PROJECT=shiftcircle-2 SC_WEB_PORT=9090 bash install.sh`; the other stack was not touched. |
| `docker is not installed` (exit 11) inside WSL while Docker Desktop is running | Turn on Docker Desktop's WSL integration for your distribution (see [Windows (WSL2)](#windows-wsl2)). |
| `the docker daemon is not running` (exit 13) | Start Docker Desktop (or `sudo systemctl start docker`) and wait until it says it is running. On Linux, a user outside the `docker` group gets the same message. |
| `'docker compose' (Compose v2) is not available` (exit 12) | Only the old `docker-compose` v1, or no Compose, is installed. Update Docker Desktop; on Linux install the Compose plugin (`docker-compose-plugin` from Docker's repository, or `docker-compose-v2` on Ubuntu). |
| `git is not installed` (exit 10) or `curl is not installed` (exit 19) | Install it (`sudo apt-get install -y git curl` on Ubuntu/WSL) and run again. |
| `could not clone 'v1.3' from https://github.com/…` (exit 16) | GitHub is not reachable (offline, VPN or firewall). Check `curl -I https://github.com`. Nothing was created; run again when it answers. |
| Exit 18 after `failed to solve: process "/bin/sh -c mvn -B -DskipTests package"` (`Could not transfer artifact … from/to central (https://repo.maven.apache.org/maven2)`) | The api build cannot reach Maven Central (symptom checked with the host blocked). Behind a corporate proxy: Maven inside the build does not read `HTTP_PROXY`, so the simplest fix is to build once on a network without a mandatory proxy; the images are then cached and the stack runs offline. Configuring the proxy instead needs a local `settings.xml` in the api build stage ([Maven proxy guide](https://maven.apache.org/guides/mini/guide-proxies.html)), and a TLS-inspecting proxy also needs its CA certificate there (**UNVERIFIED** behind a real proxy). |
| Exit 18 after `failed to solve: process "/bin/sh -c pnpm install --frozen-lockfile"` or `Error when performing the request to https://registry.npmjs.org/pnpm/…` | The web build cannot reach the npm registry (symptom checked with the host blocked). Set Docker Desktop's proxy (Settings → Resources → Proxies) so builds get `HTTPS_PROXY` (**UNVERIFIED** behind a real proxy), or build once on another network. |
| Exit 18 after an error pulling `postgres`, `maven`, `node`, `eclipse-temurin` or `nginx` from `docker.io` | Docker Hub is not reachable. Check Docker Desktop's proxy settings, then run again. |
| Exit 18 says to run `docker compose … logs` but the logs are empty | The build failed before any container started; the real error is a few lines above in the installer's output. (The `install.sh` on `main` says so in its exit-18 message.) |
| Re-running the installer | Safe in the same directory: it skips the clone, keeps `.env` and only starts or rebuilds what changed. Use the same `SHIFTCIRCLE_PROJECT` each time (with `v1.3`, a different one is saved to `.env` even if the run then stops; the `install.sh` on `main` saves the port and project only after its checks pass). |
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
| `SC_DB_VOLUME_CREATED` | (written by `install.sh` on `main`) | When this checkout's database volume was created. A re-run compares it with the volume that exists, so it never starts on another install's leftover volume (exit 20). Leave it alone. |
| `VITE_PERSIST_DEMO_SESSION` | unset (persistence on) | Demo session kill switch, build time. On the `demo` profile the web keeps the sign-in in `sessionStorage` so a refresh does not sign you out (ADR-025 amendment). Set it to exactly `false` in `.env` and rebuild (`docker compose up -d --build --wait`) to build a web that never stores the session; a refresh then asks for sign-in again. It is ignored on `prod-like`, which never persists. |
| `SC_API_PORT`, `SC_DB_PORT` | `8081`, `5433` | Only with the debugging override `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`, which publishes the api and the database on `127.0.0.1` only. Not needed for a normal install. |

`SC_BUSINESS_TZ` (`America/Regina`) is fixed in `docker-compose.yml`.
