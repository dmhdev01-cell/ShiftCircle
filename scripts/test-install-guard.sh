#!/usr/bin/env bash
# Offline test of install.sh's project-name guard (step 3a) and the .env handling around it.
# A fake `docker` and `curl` go first on PATH, so no daemon, network or real stack is needed
# and nothing real is touched. Each case builds a fake checkout (so the clone is skipped),
# sets up what the fake docker reports (containers with a working_dir label, volumes with a
# creation time), runs install.sh and checks the exit code, whether `compose up` ran, and
# what .env holds.
#
# Run from anywhere: scripts/test-install-guard.sh   (CI runs it in the checks job.)
# Scratch files go under $TMPDIR (set TMPDIR to keep them elsewhere).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$ROOT/install.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sc-install-guard.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
PORT=59137 # nothing listens here; the installer's port check must pass

# --- the fakes ----------------------------------------------------------------
# State (per case): $STATE/containers  "project<TAB>working_dir" ("-" = no label)
#                   $STATE/volumes     "project<TAB>volume<TAB>compose key<TAB>created"
#                   $STATE/calls       every docker call, one per line
#                   FAKE_PS_FAIL / FAKE_VOL_FAIL / FAKE_UP_FAIL = 1 to make that call fail
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -u
S="$FAKE_STATE"
touch "$S/containers" "$S/volumes"
printf '%s\n' "$*" >>"$S/calls"
label_of() { # the value of --filter label=KEY=VALUE for KEY
  local key="$1"; shift
  while [ $# -gt 0 ]; do
    case "$1" in --filter) case "$2" in "label=$key="*) printf '%s' "${2#label="$key"=}" ;; esac; shift ;; esac
    shift
  done
}
case "$1 ${2:-}" in
  "info "*) exit 0 ;;
  "compose version")
    [ "${3:-}" = "--short" ] && echo "2.30.0" || echo "Docker Compose version v2.30.0"; exit 0 ;;
  "ps -a")
    [ "${FAKE_PS_FAIL:-0}" = 1 ] && { echo "fake ps failure" >&2; exit 1; }
    p="$(label_of com.docker.compose.project "$@")"
    while IFS=$'\t' read -r proj wd; do
      [ "$proj" = "$p" ] || continue
      [ "$wd" = "-" ] && echo "wd=" || echo "wd=$wd"
    done <"$S/containers"
    exit 0 ;;
  "volume ls")
    [ "${FAKE_VOL_FAIL:-0}" = 1 ] && { echo "fake volume ls failure" >&2; exit 1; }
    p="$(label_of com.docker.compose.project "$@")"
    k="$(label_of com.docker.compose.volume "$@")"
    while IFS=$'\t' read -r proj name key _; do
      [ "$proj" = "$p" ] && { [ -z "$k" ] || [ "$k" = "$key" ]; } && echo "$name"
    done <"$S/volumes"
    exit 0 ;;
  "volume inspect")
    v="${*: -1}"
    while IFS=$'\t' read -r _ name _ created; do [ "$name" = "$v" ] && { echo "$created"; exit 0; }; done <"$S/volumes"
    exit 1 ;;
  "compose -p")
    p="$3"
    case "${4:-}" in
      ps) grep -q "^$p	" "$S/containers" && echo "fakeid"; exit 0 ;;
      up)
        [ "${5:-}" = "--help" ] && { echo "  --wait-timeout"; exit 0; }
        echo "UP $p" >>"$S/calls"
        grep -q "^$p	" "$S/volumes" || printf '%s\t%s_pgdata\tpgdata\t%s\n' "$p" "$p" "2026-11-26T10:00:00Z" >>"$S/volumes"
        [ "${FAKE_UP_FAIL:-0}" = 1 ] && { echo "ERROR fake build failure" >&2; exit 1; }
        printf '%s\t%s\n' "$p" "$(pwd -P)" >>"$S/containers"
        exit 0 ;;
    esac ;;
esac
echo "fake docker: unexpected call: $*" >&2
exit 99
FAKE
cat >"$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
case "${*: -1}" in */healthz) echo ok ;; *) echo '{}' ;; esac
FAKE
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

# --- helpers ------------------------------------------------------------------
pass=0
fail=0
CASE=""
STATE=""
DIR=""
OUT=""
CODE=0

new_case() { # new_case NAME: a fresh state and a fake checkout at $DIR (no .env)
  CASE="$1"
  STATE="$WORK/$pass-$fail-state"
  rm -rf "$STATE" "$WORK/case"
  mkdir -p "$STATE" "$WORK/case/ShiftCircle/.git"
  : >"$STATE/containers"
  : >"$STATE/volumes"
  : >"$STATE/calls"
  DIR="$(cd "$WORK/case/ShiftCircle" && pwd -P)"
  : >"$DIR/docker-compose.yml"
  printf 'POSTGRES_PASSWORD=\nSC_JWT_SECRET=\n' >"$DIR/.env.example"
}
container() { printf '%s\t%s\n' "$1" "$2" >>"$STATE/containers"; }
volume() { printf '%s\t%s_pgdata\tpgdata\t%s\n' "$1" "$1" "$2" >>"$STATE/volumes"; }
run() { # run [VAR=value ...]: install.sh from $WORK/case, output in $OUT, exit code in $CODE
  set +e
  OUT="$(cd "$WORK/case" && env -u COMPOSE_PROJECT_NAME PATH="$WORK/bin:$PATH" FAKE_STATE="$STATE" \
    SC_WEB_PORT="$PORT" "$@" bash "$INSTALL" 2>&1)"
  CODE=$?
  set -e
}
check() { # check DESCRIPTION COMMAND...
  if "${@:2}"; then pass=$((pass + 1)); else
    fail=$((fail + 1))
    printf 'FAIL [%s] %s (exit %s)\n%s\n\n' "$CASE" "$1" "$CODE" "$OUT" >&2
  fi
}
exit_is() { [ "$CODE" -eq "$1" ]; }
upped() { grep -q '^UP ' "$STATE/calls"; }
not_upped() { ! upped; }
no_env() { [ ! -e "$DIR/.env" ]; }
env_has() { grep -qx "$1" "$DIR/.env"; }
says() { grep -qF -- "$1" <<<"$OUT"; }

# --- cases --------------------------------------------------------------------
new_case "fresh install, nothing there"
run SHIFTCIRCLE_PROJECT=sc-a
check "proceeds" exit_is 0
check "runs up" upped
check "records the project" env_has "COMPOSE_PROJECT_NAME=sc-a"
check "records its database volume" env_has "SC_DB_VOLUME_CREATED=2026-11-26T10:00:00Z"
check "prints the sign-in address" says "http://localhost:$PORT/login"

new_case "fresh, containers from another directory"
container sc-a /elsewhere/ShiftCircle
run SHIFTCIRCLE_PROJECT=sc-a
check "refuses with 20" exit_is 20
check "no up" not_upped
check "no .env written" no_env
check "names the other directory" says "started from /elsewhere/ShiftCircle"

new_case "fresh (no .env), containers from this directory"
container sc-a "$DIR"
run SHIFTCIRCLE_PROJECT=sc-a
check "proceeds" exit_is 0

new_case "re-run in the same directory, stack up"
run SHIFTCIRCLE_PROJECT=sc-a
run
check "proceeds" exit_is 0
check "keeps the project from .env" says "Starting project 'sc-a'"

new_case "re-run, containers of the .env's project from another directory"
printf 'COMPOSE_PROJECT_NAME=customname\n' >"$DIR/.env"
container customname /other/checkout
run
check "refuses with 20" exit_is 20
check "names the project" says "named 'customname'"
check "no up" not_upped

new_case "after 'down': no containers, own volume recorded in .env"
run SHIFTCIRCLE_PROJECT=sc-a
: >"$STATE/containers"
: >"$STATE/calls"
run
check "proceeds" exit_is 0
check "runs up" upped

new_case "fresh, leftover volume of the same name"
volume sc-a 2026-01-01T00:00:00Z
run SHIFTCIRCLE_PROJECT=sc-a
check "refuses with 20" exit_is 20
check "no up" not_upped
check "no .env written" no_env

new_case "re-run with .env, another install's leftover volume (security low)"
run SHIFTCIRCLE_PROJECT=sc-a
: >"$STATE/containers"
: >"$STATE/volumes"
volume sc-a 2026-02-02T00:00:00Z
: >"$STATE/calls"
run
check "refuses with 20" exit_is 20
check "no up" not_upped
check "says this checkout did not create them" says "this checkout did not create them"

new_case "re-run with .env that records no volume, leftover volume"
printf 'COMPOSE_PROJECT_NAME=sc-a\nPOSTGRES_PASSWORD=abcdefgh12\n' >"$DIR/.env"
volume sc-a 2026-02-02T00:00:00Z
run
check "refuses with 20" exit_is 20
check "no up" not_upped

new_case "docker ps fails"
FAKE_PS_FAIL=1 run SHIFTCIRCLE_PROJECT=sc-a
check "fails closed with 20" exit_is 20
check "no .env written" no_env

new_case "docker volume ls fails"
FAKE_VOL_FAIL=1 run SHIFTCIRCLE_PROJECT=sc-a
check "fails closed with 20" exit_is 20
check "no up" not_upped

new_case "container without a working_dir label"
container sc-a -
run SHIFTCIRCLE_PROJECT=sc-a
check "refuses with 20" exit_is 20
check "says unknown directory" says "an unknown directory"

new_case "checkout reached through a symlink"
container sc-a "$DIR"
ln -s "$WORK/case" "$WORK/link"
set +e
OUT="$(cd "$WORK/link" && env -u COMPOSE_PROJECT_NAME PATH="$WORK/bin:$PATH" FAKE_STATE="$STATE" \
  SC_WEB_PORT="$PORT" SHIFTCIRCLE_PROJECT=sc-a bash "$INSTALL" 2>&1)"
CODE=$?
set -e
rm -f "$WORK/link"
check "proceeds" exit_is 0

new_case "label spelled with /./"
container sc-a "$(dirname "$DIR")/./ShiftCircle"
run SHIFTCIRCLE_PROJECT=sc-a
check "proceeds" exit_is 0

new_case "SHIFTCIRCLE_PROJECT overrides .env; the new name is free"
printf 'COMPOSE_PROJECT_NAME=customname\n' >"$DIR/.env"
container customname /other/checkout
run SHIFTCIRCLE_PROJECT=sc-b
check "proceeds" exit_is 0
check ".env records the new name" env_has "COMPOSE_PROJECT_NAME=sc-b"

new_case "moved checkout: the refusal says how to recover"
container sc-a /old/place/ShiftCircle
run SHIFTCIRCLE_PROJECT=sc-a
check "refuses with 20" exit_is 20
check "suggests down for a moved checkout" says "docker compose -p sc-a down"

new_case "a CRLF .env (Windows checkout) with blank secrets"
printf 'POSTGRES_PASSWORD=\r\nSC_JWT_SECRET=\r\n' >"$DIR/.env"
run SHIFTCIRCLE_PROJECT=sc-a
check "proceeds (not exit 17)" exit_is 0
check "generates the secrets" says "Generated random secrets"

new_case "a failed start still records the volume, and points at the output"
FAKE_UP_FAIL=1 run SHIFTCIRCLE_PROJECT=sc-a
check "exit 18" exit_is 18
check "points at the output above" says "The cause is in the output above"
check "records its database volume" env_has "SC_DB_VOLUME_CREATED=2026-11-26T10:00:00Z"
run
check "the re-run is not refused for its own volume" exit_is 0

if command -v python3 >/dev/null 2>&1; then
  new_case "port in use: the new project name is not saved"
  printf 'COMPOSE_PROJECT_NAME=sc-a\n' >"$DIR/.env"
  python3 -c 'import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(5); time.sleep(20)' "$PORT" &
  listener=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && break; sleep 0.2; done
  run SHIFTCIRCLE_PROJECT=sc-b
  kill "$listener" 2>/dev/null || true
  wait "$listener" 2>/dev/null || true
  check "exit 14" exit_is 14
  check ".env keeps the old project" env_has "COMPOSE_PROJECT_NAME=sc-a"
fi

printf 'install guard: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
