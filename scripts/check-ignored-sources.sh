#!/usr/bin/env bash
# Fail when a path under source or docs is invisible to git because .gitignore
# matches it. Two real cases on 2026-11-20: an unanchored build/ hid
# api/shiftcircle-rules/src/main/java/.../rules/build/, and an unanchored
# coverage/ hid api/shiftcircle-api/src/main/java/.../api/coverage/. Both
# compiled and passed their tests locally; only a clean checkout failed.
#
# Run this in the working tree before committing a slice, and again in the
# clean worktree used for the verified run. Build output under target/,
# node_modules/, web/dist/ and web/coverage/ is expected and is not reported.
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not inside a git work tree" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

leaks="$(
  git ls-files --others --ignored --exclude-standard \
    | grep -E '^(api/.*/src|web/src|e2e|docs)/' \
    | grep -vE '(^|/)(node_modules|test-results|playwright-report)/' \
    || true
)"

if [ -n "$leaks" ]; then
  echo "ERROR: these ignored paths under source or docs would never be committed:" >&2
  printf '%s\n' "$leaks" >&2
  echo "" >&2
  echo "Anchor the .gitignore pattern to the build tool's output directory" >&2
  echo "(for example /web/build/, not build/) or track the file explicitly." >&2
  exit 1
fi

echo "OK: no ignored paths under api/*/src, web/src, e2e/ or docs/."
