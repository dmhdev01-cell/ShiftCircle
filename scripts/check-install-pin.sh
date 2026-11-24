#!/usr/bin/env bash
# Check that install.sh's pinned release tag matches the install URLs in README.md and
# INSTALL.md. Offline by default (this is what CI runs, because the tag cannot exist
# before the release commit does).
#
# At release time, after the tag is pushed, also confirm it resolves on the remote:
#   ./scripts/check-install-pin.sh --remote
#
# Run it from the repo root, like the other checks.
set -euo pipefail
cd "$(dirname "$0")/.."

pin="$(sed -n 's/^DEFAULT_REF="\(.*\)"$/\1/p' install.sh)"
[ -n "$pin" ] || { echo "install.sh: DEFAULT_REF not found" >&2; exit 1; }

bad=0
for f in README.md INSTALL.md; do
  urls="$(grep -oE 'ShiftCircle/[^/ ]+/install\.sh' "$f" | sort -u || true)"
  [ -n "$urls" ] || { echo "$f: no install.sh URL found" >&2; bad=1; continue; }
  if [ "$urls" != "ShiftCircle/$pin/install.sh" ]; then
    echo "$f: install URL tag differs from install.sh DEFAULT_REF ($pin):" >&2
    echo "$urls" >&2
    bad=1
  fi
done
[ "$bad" -eq 0 ] || exit 1
echo "OK: install pin $pin matches README.md and INSTALL.md"

if [ "${1:-}" = "--remote" ]; then
  git remote get-url origin >/dev/null 2>&1 ||
    { echo "no 'origin' remote here; run this inside a clone of the repo" >&2; exit 1; }
  git ls-remote --exit-code --tags origin "refs/tags/$pin" >/dev/null ||
    { echo "tag $pin does not exist on origin yet" >&2; exit 1; }
  echo "OK: tag $pin exists on origin"
fi
