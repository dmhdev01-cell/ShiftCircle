#!/usr/bin/env bash
# ShiftCircle one-line installer (demo profile, Docker only).
#
#   curl -fsSL https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/<tag>/install.sh | bash
#
# Safer: download it, read it, then run it:
#   curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/<tag>/install.sh
#   less install.sh
#   bash install.sh
#
# What it does: checks git, docker, docker compose v2, the docker daemon and the web port;
# clones the repo at a pinned ref into ./ShiftCircle; creates .env from .env.example with
# freshly generated random secrets (never printed); runs the README's
# `docker compose up -d --build --wait`; checks /healthz and /api/v1/version.
# Re-running in the same place skips the clone and the .env and just brings the stack up.
# It never runs `docker compose down`, with or without -v.
#
# Overrides (environment):
#   SHIFTCIRCLE_REF      git tag or branch to install (default below, the release tag)
#   SHIFTCIRCLE_DIR      target directory (default ./ShiftCircle)
#   SHIFTCIRCLE_REPO     clone URL (default the public GitHub repo)
#   SC_WEB_PORT          host port for the web (default 8080, bound to 127.0.0.1)
#   COMPOSE_PROJECT_NAME compose project name (default shiftcircle)
#
# Exit codes: 10 git missing, 11 docker missing, 12 compose v2 missing, 13 docker daemon
# not running, 14 port in use, 15 target directory not usable, 16 clone failed,
# 17 .env/secrets failed, 18 start or health check failed, 19 curl missing.
set -euo pipefail

DEFAULT_REF="v1.2-submission"
REF="${SHIFTCIRCLE_REF:-$DEFAULT_REF}"
DIR="${SHIFTCIRCLE_DIR:-ShiftCircle}"
REPO="${SHIFTCIRCLE_REPO:-https://github.com/dmhdev01-cell/ShiftCircle.git}"

say() { printf '%s\n' "$*"; }
die() {
  code="$1"
  shift
  printf 'ShiftCircle install: %s\n' "$*" >&2
  exit "$code"
}

# --- 1. prerequisites -------------------------------------------------------
command -v git >/dev/null 2>&1 || die 10 "git is not installed. Install git (https://git-scm.com/downloads) and run again."
command -v curl >/dev/null 2>&1 || die 19 "curl is not installed. Install curl and run again."
command -v docker >/dev/null 2>&1 || die 11 "docker is not installed. Install Docker Desktop (macOS, Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/"
if ! docker compose version >/dev/null 2>&1; then
  die 12 "'docker compose' (Compose v2) is not available. Update Docker Desktop, or install the Compose plugin: https://docs.docker.com/compose/install/"
fi
compose_major="$(docker compose version --short 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
case "$compose_major" in
  '' | *[!0-9]*) ;;
  *) [ "$compose_major" -ge 2 ] || die 12 "Docker Compose v2 is required (found v$compose_major). Update Docker." ;;
esac
docker info >/dev/null 2>&1 || die 13 "the docker daemon is not running (or this user cannot reach it). Start Docker Desktop / the docker service and run again."

# --- 2. target directory and clone ------------------------------------------
if [ -e "$DIR" ] && [ ! -d "$DIR" ]; then
  die 15 "'$DIR' exists and is not a directory."
fi
if [ -d "$DIR" ] && [ -n "$(ls -A "$DIR")" ]; then
  if [ -d "$DIR/.git" ] && [ -f "$DIR/docker-compose.yml" ] && [ -f "$DIR/.env.example" ]; then
    say "Found an existing ShiftCircle checkout in $DIR; skipping the clone."
  else
    die 15 "'$DIR' exists and is not empty, and is not a ShiftCircle checkout. Not touching it. Set SHIFTCIRCLE_DIR to another path."
  fi
else
  say "Cloning $REPO at $REF into $DIR ..."
  git clone --quiet --depth 1 --branch "$REF" "$REPO" "$DIR" ||
    die 16 "could not clone '$REF' from $REPO. Check the network and that the tag or branch exists (SHIFTCIRCLE_REF)."
fi
cd "$DIR"

# --- 3. .env with generated secrets -----------------------------------------
# Hex only: no characters that need quoting in .env or the shell.
gen_secret() {
  # $1 = number of random bytes (hex output is twice as long)
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    LC_ALL=C od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

set_env() { # set_env KEY VALUE : replace the KEY= line (or an active/commented one) or append
  key="$1"
  val="$2"
  tmp=".env.tmp.$$"
  if grep -qE "^#? ?${key}=" .env; then
    awk -v k="$key" -v v="$val" '
      !done && $0 ~ ("^#? ?" k "=") { print k "=" v; done = 1; next } { print }
    ' .env >"$tmp"
  else
    cat .env >"$tmp"
    printf '%s=%s\n' "$key" "$val" >>"$tmp"
  fi
  mv "$tmp" .env
}

if [ -f .env ]; then
  say "Found an existing .env; leaving it as it is."
else
  [ -f .env.example ] || die 17 ".env.example is missing from the checkout."
  (
    umask 077
    cp .env.example .env
  )
  chmod 600 .env
  pg_pw="$(gen_secret 24)"  # 48 chars; the API needs at least 8
  jwt="$(gen_secret 32)"    # 64 chars; the API needs at least 32
  [ "${#pg_pw}" -ge 8 ] && [ "${#jwt}" -ge 32 ] || die 17 "could not generate random secrets."
  set_env POSTGRES_PASSWORD "$pg_pw"
  set_env SC_JWT_SECRET "$jwt"
  unset pg_pw jwt
  commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
  [ -z "$commit" ] || set_env SC_GIT_COMMIT "$commit"
  # Remember the overrides so a re-run without them targets the same stack.
  [ -z "${SC_WEB_PORT:-}" ] || set_env SC_WEB_PORT "$SC_WEB_PORT"
  [ -z "${COMPOSE_PROJECT_NAME:-}" ] || set_env COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
  say "Created .env with newly generated secrets (not shown)."
fi
chmod 600 .env 2>/dev/null || true

# Effective settings: the shell wins over .env, as with compose itself.
env_get() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true; }
PORT="${SC_WEB_PORT:-$(env_get SC_WEB_PORT)}"
PORT="${PORT:-8080}"
PROJECT="${COMPOSE_PROJECT_NAME:-$(env_get COMPOSE_PROJECT_NAME)}"
PROJECT="${PROJECT:-shiftcircle}"
case "$PORT" in '' | *[!0-9]*) die 14 "SC_WEB_PORT '$PORT' is not a number." ;; esac

# docker-compose.yml pins `name: shiftcircle`; -p makes the project explicit.
dc() { docker compose -p "$PROJECT" "$@"; }

# --- 4. free port (skipped when this project's web is already up: a re-run) --
if [ -n "$(dc ps -q web 2>/dev/null || true)" ]; then
  say "Project '$PROJECT' already has a web container; skipping the port check."
elif (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  die 14 "port $PORT on 127.0.0.1 is already in use. Pick another: SC_WEB_PORT=18080 bash install.sh (on a re-run in the same directory, edit SC_WEB_PORT in $DIR/.env)."
fi

# --- 5. start and wait until healthy ----------------------------------------
say "Starting project '$PROJECT' on port $PORT (first build can take several minutes) ..."
SC_WEB_PORT="$PORT" dc up -d --build --wait --wait-timeout 1800 ||
  die 18 "docker compose did not become healthy. See: (cd $DIR && docker compose -p $PROJECT logs --tail 100)"

URL="http://localhost:$PORT"
health="$(curl -fsS --max-time 10 "$URL/healthz" 2>/dev/null || true)"
case "$health" in
  ok*) ;;
  *) die 18 "$URL/healthz did not answer 'ok'." ;;
esac
curl -fsS --max-time 10 "$URL/api/v1/version" >/dev/null 2>&1 ||
  die 18 "$URL/api/v1/version did not answer."

# --- 6. what next ------------------------------------------------------------
cat <<EOF

ShiftCircle is running (demo profile, synthetic data only).

  Open:     $URL
  Sign in:  pick a demo user on the sign-in screen (mock sign-in, no password).
            P. Planner and M. Ellis (supervisor) are good starting points.
            Roles are explained in USER-GUIDE.md.

  Stop (keeps the data):
    cd $DIR && docker compose -p $PROJECT down
  Remove everything, including the demo database volume:
    cd $DIR && docker compose -p $PROJECT down -v
  Start again:  bash install.sh   (same directory; nothing is re-cloned or re-generated)
EOF
