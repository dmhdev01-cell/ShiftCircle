#!/usr/bin/env bash
# ShiftCircle one-line installer (demo profile, Docker only).
#
#   curl -fsSLo install.sh https://raw.githubusercontent.com/dmhdev01-cell/ShiftCircle/<tag>/install.sh && bash install.sh
#
# (A failed download stops there with a non-zero exit. `curl ... | bash` also works, because
# everything below runs from main(), called on the last line: a truncated download runs
# nothing. But the pipe's exit status is bash's, so a 404 looks like success.)
# Safer still: download it, read it (`less install.sh`), then `bash install.sh`.
#
# What it does: checks git, curl, docker, docker compose v2, the docker daemon and the web
# port; clones the repo at a pinned ref into ./ShiftCircle; creates .env from .env.example
# with freshly generated random secrets (never printed, never on a command line); runs the
# README's `docker compose up -d --build --wait`; checks /healthz and /api/v1/version.
# Re-running in the same place skips the clone and keeps the .env (blank secrets are filled,
# non-blank ones are never changed). It never runs `docker compose down`, with or without -v.
#
# Overrides (environment):
#   SC_WEB_PORT          host port for the web, 1-65535 (default 8080, bound to 127.0.0.1)
#   SHIFTCIRCLE_PROJECT  compose project name (default shiftcircle). COMPOSE_PROJECT_NAME in
#                        your shell is deliberately NOT used: it is often set for another
#                        project. The name is saved to .env as COMPOSE_PROJECT_NAME so plain
#                        `docker compose` commands in the checkout target the same project.
#                        A name another install already uses is refused (exit 20).
#   SHIFTCIRCLE_REF      git tag or branch to install (default: the release tag below)
#   SHIFTCIRCLE_DIR      target directory (default ./ShiftCircle)
#   SHIFTCIRCLE_REPO     clone URL (advanced; default the public GitHub repo)
#
# Exit codes: 10 git missing, 11 docker missing, 12 compose v2 missing, 13 docker daemon
# not running, 14 port invalid or in use, 15 target directory or other override not usable,
# 16 clone failed, 17 .env/secrets failed, 18 start or health check failed, 19 curl missing,
# 20 the compose project name is not free for this checkout: containers of that project were
# started from another directory, volumes of it exist that this checkout did not create, or
# docker could not list them to check.
set -euo pipefail

# RELEASE: this pin must name a tag that exists on the remote when the release is cut.
# scripts/check-install-pin.sh keeps it in step with the README and INSTALL URLs (CI, offline);
# run `scripts/check-install-pin.sh --remote` after tagging to confirm the tag resolves.
DEFAULT_REF="v1.3"

say() { printf '%s\n' "$*"; }
die() {
  code="$1"
  shift
  printf 'ShiftCircle install: %s\n' "$*" >&2
  exit "$code"
}

TMP_ENV=""
cleanup() { [ -z "$TMP_ENV" ] || rm -f "$TMP_ENV"; }

# Hex only: no characters that need quoting in .env or the shell.
gen_secret() { # $1 = number of random bytes (hex output is twice as long)
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    LC_ALL=C od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# set_env KEY VALUE: replace the first KEY= line (or a commented "# KEY=" one) in .env, or
# append. Pure bash: the value is never on a command line. The temp file is created by
# mktemp (mode 600), so .env is never readable by others. (No global umask: the clone must
# keep the caller's umask, or the web image ships 0600 files nginx cannot serve.)
set_env() {
  local key="$1" val="$2" line found=0
  TMP_ENV="$(mktemp .env.XXXXXX)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="* | "# $key="* | "#$key="*)
        if [ "$found" -eq 0 ]; then
          printf '%s=%s\n' "$key" "$val"
          found=1
          continue
        fi
        ;;
    esac
    printf '%s\n' "$line"
  done <.env >"$TMP_ENV"
  [ "$found" -eq 1 ] || printf '%s=%s\n' "$key" "$val" >>"$TMP_ENV"
  mv "$TMP_ENV" .env
  TMP_ENV=""
}

env_get() { # env_get KEY: the first KEY= value (the one set_env replaces) in .env (empty if none)
  # A CRLF .env (a Windows checkout) would otherwise read "\r" as the value.
  { grep -E "^$1=" .env || true; } | head -n 1 | cut -d= -f2- | tr -d '\r'
}

# pgdata_created PROJECT: when that project's database volume was created (empty if none).
# The installer records it in .env after `up`, so a re-run can tell its own volume from a
# leftover one of another install (volumes carry no working_dir label).
pgdata_created() {
  local vol
  vol="$(docker volume ls -q --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.volume=pgdata" </dev/null)" || return 1
  vol="$(printf '%s\n' "$vol" | head -n 1)"
  [ -z "$vol" ] || docker volume inspect -f '{{.CreatedAt}}' "$vol" </dev/null
}

valid_port() {
  case "$1" in '' | *[!0-9]*) return 1 ;; esac
  [ "${#1}" -le 5 ] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}
valid_project() { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; }

main() {
  trap cleanup EXIT

  # --- 0. validate every override before anything is written -----------------
  local ref="${SHIFTCIRCLE_REF:-$DEFAULT_REF}"
  local dir="${SHIFTCIRCLE_DIR:-ShiftCircle}"
  local repo="${SHIFTCIRCLE_REPO:-https://github.com/dmhdev01-cell/ShiftCircle.git}"
  local project="${SHIFTCIRCLE_PROJECT:-}"
  local port="${SC_WEB_PORT:-}"
  [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || die 15 "SHIFTCIRCLE_REF '$ref' is not a plain tag or branch name."
  case "$dir" in
    '' | -* | *[![:print:]]*) die 15 "SHIFTCIRCLE_DIR '$dir' must be a plain path (not empty, not starting with '-')." ;;
  esac
  [[ "$repo" =~ ^(https://|ssh://|git@|/|\./)[^[:space:]]+$ ]] || die 15 "SHIFTCIRCLE_REPO '$repo' is not a clone URL or path."
  [ -z "$project" ] || valid_project "$project" || die 15 "SHIFTCIRCLE_PROJECT '$project' must be lower-case letters, digits, '-' or '_', starting with a letter or digit."
  [ -z "$port" ] || valid_port "$port" || die 14 "SC_WEB_PORT '$port' is not a port number (1-65535)."

  # --- 1. prerequisites ------------------------------------------------------
  command -v git >/dev/null 2>&1 || die 10 "git is not installed. Install git (https://git-scm.com/downloads) and run again."
  command -v curl >/dev/null 2>&1 || die 19 "curl is not installed. Install curl and run again."
  command -v docker >/dev/null 2>&1 || die 11 "docker is not installed. Install Docker Desktop (macOS, Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/"
  if ! docker compose version >/dev/null 2>&1; then
    die 12 "'docker compose' (Compose v2) is not available. Update Docker Desktop, or install the Compose plugin: https://docs.docker.com/compose/install/"
  fi
  local compose_major
  compose_major="$(docker compose version --short 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  case "$compose_major" in
    '' | *[!0-9]*) ;;
    *) [ "$compose_major" -ge 2 ] || die 12 "Docker Compose v2 is required (found v$compose_major). Update Docker." ;;
  esac
  docker info >/dev/null 2>&1 || die 13 "the docker daemon is not running (or this user cannot reach it). Start Docker Desktop / the docker service and run again."

  # --- 2. target directory and clone -----------------------------------------
  if [ -e "$dir" ] && [ ! -d "$dir" ]; then
    die 15 "'$dir' exists and is not a directory."
  fi
  if [ -d "$dir" ] && [ -n "$(ls -A "$dir")" ]; then
    if [ -d "$dir/.git" ] && [ -f "$dir/docker-compose.yml" ] && [ -f "$dir/.env.example" ]; then
      say "Found an existing ShiftCircle checkout in $dir; skipping the clone."
    else
      die 15 "'$dir' exists and is not empty, and is not a ShiftCircle checkout. Not touching it. Set SHIFTCIRCLE_DIR to another path."
    fi
  else
    say "Cloning $repo at $ref into $dir ..."
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$ref" -- "$repo" "$dir" </dev/null ||
      die 16 "could not clone '$ref' from $repo. Check the network and that the tag or branch exists (SHIFTCIRCLE_REF)."
  fi
  cd "$dir"

  # --- 3a. the project name must not belong to another directory's stack ------
  # Compose identifies a stack only by its project name: `up` with a name another checkout
  # already uses would recreate that stack's containers and reuse its database volume (whose
  # password is not the one in our .env). So refuse, before .env is written, unless every
  # container with this name was started from this directory, and any volume of it is this
  # checkout's own. Refusing (rather than picking a free name) keeps the choice with the user
  # and never leaves a stack under a surprise name. Nothing of the other stack is stopped,
  # removed or recreated. (A fresh install has already cloned; the checkout stays, so a re-run
  # with another SHIFTCIRCLE_PROJECT skips the clone.)
  local had_env=0
  [ ! -f .env ] || had_env=1
  if [ -z "$project" ] && [ "$had_env" -eq 1 ]; then project="$(env_get COMPOSE_PROJECT_NAME)"; fi
  project="${project:-shiftcircle}"
  valid_project "$project" || die 15 "project name '$project' (in $dir/.env) is not valid."
  local here here_phys wd wds vols others="" ours=0
  here="$(pwd)"
  here_phys="$(pwd -P)"
  # Fail closed: if docker cannot list them we cannot tell whose they are.
  wds="$(docker ps -a --filter "label=com.docker.compose.project=$project" \
    --format 'wd={{.Label "com.docker.compose.project.working_dir"}}' </dev/null)" ||
    die 20 "could not list the Docker containers of project '$project' to check that it is not another install's."
  vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$project" </dev/null)" ||
    die 20 "could not list the Docker volumes of project '$project' to check that it is not another install's."
  while IFS= read -r wd; do
    [ -n "$wd" ] || continue
    wd="${wd#wd=}"
    if [ -z "$wd" ]; then
      others="an unknown directory"
    elif [ "$wd" != "$here" ] && [ "$wd" != "$here_phys" ] &&
      [ "$(cd "$wd" 2>/dev/null && pwd -P)" != "$here_phys" ]; then
      others="$wd"
    else
      ours=1
    fi
  done <<<"$wds"
  if [ -n "$others" ]; then
    die 20 "a Docker Compose project named '$project' already exists, started from $others. Not touching it. Install under another name, for example: SHIFTCIRCLE_PROJECT=shiftcircle-2 bash install.sh (or, if that directory is this checkout before you moved or renamed it, remove the old containers with 'docker compose -p $project down', which keeps the database volume, and run this again)."
  fi
  # Volumes with no container of ours: a fresh install (no .env yet) would start the database
  # on them with a password our new .env does not have, and so would a re-run whose .env does
  # not record creating them (another install's leftovers under the same name).
  if [ -n "$vols" ] && [ "$ours" -eq 0 ]; then
    local stamp created
    stamp="$(env_get SC_DB_VOLUME_CREATED 2>/dev/null || true)"
    created="$(pgdata_created "$project")" || created=""
    if [ "$had_env" -eq 0 ] || [ -z "$stamp" ] || [ "$stamp" != "$created" ]; then
      die 20 "Docker volumes of a compose project named '$project' already exist, and this checkout did not create them (from an earlier or another install). Not touching them. Install under another name, for example: SHIFTCIRCLE_PROJECT=shiftcircle-2 bash install.sh (or, if they are this checkout's own from before the installer recorded them, start it once here with 'docker compose -p $project up -d' and run this again)."
    fi
  fi

  # --- 3. .env and secrets ---------------------------------------------------
  if [ -f .env ]; then
    say "Found an existing .env; keeping it (only blank secrets are filled)."
  else
    [ -f .env.example ] || die 17 ".env.example is missing from the checkout."
    (umask 077 && cp .env.example .env)
    say "Created .env from .env.example."
  fi
  chmod 600 .env || die 17 "could not set .env to mode 600."

  # Secrets: generate only into blank values; a non-blank value is the user's and is kept,
  # but one the API would refuse at startup (StartupSecrets: 8 / 32 characters) stops us now.
  local key min bytes cur filled=0
  for spec in POSTGRES_PASSWORD:8:24 SC_JWT_SECRET:32:32; do
    key="${spec%%:*}"
    min="${spec#*:}"
    bytes="${min#*:}"
    min="${min%%:*}"
    cur="$(env_get "$key")"
    if [ -z "$cur" ]; then
      cur="$(gen_secret "$bytes")"
      [ "${#cur}" -ge "$min" ] || die 17 "could not generate a random $key."
      set_env "$key" "$cur"
      filled=1
    elif [ "${#cur}" -lt "$min" ]; then
      die 17 "$key in $dir/.env is shorter than $min characters and the API would refuse to start. Make it longer. (To have one generated instead, blank it and run again; for POSTGRES_PASSWORD that only works on a first install, because an existing database volume keeps its old password.)"
    fi
  done
  cur=""
  [ "$filled" -eq 0 ] || say "Generated random secrets into .env (not shown)."

  # Overrides from the environment win over .env, as with compose itself. Validate the
  # values taken from .env too before using them.
  if [ -z "$port" ]; then port="$(env_get SC_WEB_PORT)"; fi
  port="${port:-8080}"
  valid_port "$port" || die 14 "SC_WEB_PORT '$port' (in $dir/.env) is not a port number (1-65535)."

  local commit
  commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
  if [ -z "$(env_get SC_GIT_COMMIT)" ] && [ -n "$commit" ]; then set_env SC_GIT_COMMIT "$commit"; fi

  # docker-compose.yml pins `name: shiftcircle`; -p makes the project explicit.
  dc() { docker compose -p "$project" "$@" </dev/null; }

  # --- 4. free port (skipped when this project's web is already up: a re-run) -
  if [ -n "$(dc ps -q web 2>/dev/null || true)" ]; then
    say "Project '$project' already has a web container; skipping the port check."
  elif (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die 14 "port $port on 127.0.0.1 is already in use. Pick another one, for example: SC_WEB_PORT=9090 bash install.sh (or edit SC_WEB_PORT in $dir/.env on a re-run)."
  fi

  # Remember the choices, now that they passed every check, so a re-run and plain
  # `docker compose` in this checkout agree (a refused attempt leaves .env as it was).
  if [ -n "${SC_WEB_PORT:-}" ] && [ "$(env_get SC_WEB_PORT)" != "$SC_WEB_PORT" ]; then set_env SC_WEB_PORT "$SC_WEB_PORT"; fi
  if [ -n "${SHIFTCIRCLE_PROJECT:-}" ] && [ "$(env_get COMPOSE_PROJECT_NAME)" != "$SHIFTCIRCLE_PROJECT" ]; then set_env COMPOSE_PROJECT_NAME "$SHIFTCIRCLE_PROJECT"; fi

  # --- 5. start and wait until healthy ---------------------------------------
  local wait_args=(--wait)
  # --wait-timeout is not in the oldest 2.x releases; omit it there (compose's own health
  # checks still bound the wait).
  if dc up --help 2>/dev/null | grep -q -- '--wait-timeout'; then wait_args+=(--wait-timeout 1800); fi
  say "Starting project '$project' on port $port (first build can take several minutes) ..."
  local up_ok=1 created
  SC_WEB_PORT="$port" dc up -d --build "${wait_args[@]}" || up_ok=0
  # Record which database volume is this checkout's (see the check in 3a), even after a
  # failed start: the volume exists by then and a re-run must not be refused for it.
  created="$(pgdata_created "$project" 2>/dev/null)" || created=""
  if [ -n "$created" ] && [ "$(env_get SC_DB_VOLUME_CREATED)" != "$created" ]; then set_env SC_DB_VOLUME_CREATED "$created"; fi
  [ "$up_ok" -eq 1 ] ||
    die 18 "docker compose did not build or become healthy. The cause is in the output above: look for the first 'ERROR' or 'failed' (a build that could not download is a network problem). If the containers did start, (cd $(printf '%q' "$dir") && docker compose -p $project logs --tail 100) shows them."

  local url="http://localhost:$port" health
  health="$(curl -fsS --max-time 10 "$url/healthz" 2>/dev/null || true)"
  case "$health" in
    ok*) ;;
    *) die 18 "$url/healthz did not answer 'ok'." ;;
  esac
  curl -fsS --max-time 10 "$url/api/v1/version" >/dev/null 2>&1 ||
    die 18 "$url/api/v1/version did not answer."

  # --- 6. what next ----------------------------------------------------------
  local qdir
  qdir="$(printf '%q' "$dir")"
  cat <<EOF

ShiftCircle is running (demo profile, synthetic data only).

  Open:     $url/login
  Sign in:  pick a demo user on the sign-in screen (mock sign-in, no password).
            P. Planner and M. Ellis (supervisor) are good starting points.
            Roles are explained in USER-GUIDE.md.

  Stop (keeps the data):
    cd $qdir && docker compose -p $project down
  Remove everything, including the demo database volume:
    cd $qdir && docker compose -p $project down -v
  Start again: re-run the same install command from the same directory (nothing is
  re-cloned; the .env is kept).
EOF
}

main "$@"
