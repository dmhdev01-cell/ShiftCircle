#!/usr/bin/env bash
# Capture the real api's answers as contract samples.
#
# The fixtures and the api drift: the api sends null for a field the fixtures
# leave out, and a screen that assumes otherwise blanks the page. These
# samples are the api's own answers, so the contract test can render every
# screen from the shapes the api really sends.
#
# Run it against a running stack:
#   ./scripts/capture-contract-samples.sh http://localhost:8080
#
# The data is synthetic (docs/10-testing.md section 6), so the samples are
# safe to commit. No token is ever written: every file holds a response body.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE=${1:-http://localhost:8080}
OUT=web/src/api/contract-samples
mkdir -p "$OUT"

login() {
  curl -s -X POST "$BASE/api/v1/auth/mock-login" -H 'Content-Type: application/json' \
    -d "{\"userId\":\"$1\"}" |
    python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])'
}

# save <file> <path> <token>
save() {
  curl -s "$BASE$2" -H "Authorization: Bearer $3" -o "$OUT/$1.raw"
  python3 - "$OUT/$1.raw" "$OUT/$1.json" << 'PY'
import json, sys
raw, target = sys.argv[1], sys.argv[2]
with open(raw) as handle:
    body = json.load(handle)
with open(target, "w") as handle:
    json.dump(body, handle, indent=2, sort_keys=False)
    handle.write("\n")
PY
  rm "$OUT/$1.raw"
  echo "wrote $OUT/$1.json"
}

# first <json file> <python expression over the parsed body>
first() {
  python3 - "$1" "$2" << 'PY'
import json, sys
with open(sys.argv[1]) as handle:
    body = json.load(handle)
print(eval(sys.argv[2], {"body": body, "len": len, "str": str, "sorted": sorted}))
PY
}

SUPERVISOR=$(login m.ellis)
AUDITOR=$(login a.reviewer)
EMPLOYEE=$(login t.nakamura)

save version /api/v1/version "$SUPERVISOR"
save units /api/v1/units "$SUPERVISOR"
save shift-templates /api/v1/shift-templates "$SUPERVISOR"

UNIT_ID=$(curl -s "$BASE/api/v1/units" -H "Authorization: Bearer $SUPERVISOR" |
  python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')

save schedule-draft "/api/v1/schedule?unitId=$UNIT_ID&from=2026-11-23&to=2026-11-29" "$SUPERVISOR"
save schedule-supervisor "/api/v1/schedule?unitId=$UNIT_ID&from=2026-11-16&to=2026-11-22" "$SUPERVISOR"
save reports-coverage "/api/v1/reports/coverage" "$SUPERVISOR"
save reports-hours "/api/v1/reports/hours" "$SUPERVISOR"
save reports-overtime "/api/v1/reports/overtime" "$SUPERVISOR"
save reports-overrides "/api/v1/reports/overrides" "$SUPERVISOR"
save audit-events "/api/v1/audit-events?limit=20" "$AUDITOR"
save open-shifts "/api/v1/open-shifts" "$SUPERVISOR"
save display-today /api/v1/display/today "$SUPERVISOR"
save rule-sets /api/v1/rule-sets "$SUPERVISOR"
save pay-periods /api/v1/pay-periods "$SUPERVISOR"
save me-schedule "/api/v1/me/schedule" "$EMPLOYEE"
save me-offers "/api/v1/me/offers" "$EMPLOYEE"

# The candidates of the first open shift, and the time entries of the first
# pay period: both need an id from another answer.
OPEN_SHIFT_ID=$(curl -s "$BASE/api/v1/open-shifts" -H "Authorization: Bearer $SUPERVISOR" |
  python3 -c 'import sys,json; body=json.load(sys.stdin); print(body[0]["id"] if body else "")')

if [ -n "$OPEN_SHIFT_ID" ]; then
  save open-shift-candidates "/api/v1/open-shifts/$OPEN_SHIFT_ID/candidates" "$SUPERVISOR"
fi

PERIOD_ID=$(curl -s "$BASE/api/v1/pay-periods" -H "Authorization: Bearer $SUPERVISOR" |
  python3 -c 'import sys,json; body=json.load(sys.stdin); print(body[0]["id"] if body else "")')

if [ -n "$PERIOD_ID" ]; then
  save time-entries "/api/v1/pay-periods/$PERIOD_ID/time-entries" "$SUPERVISOR"
fi


# Publishing the demo week gives the samples a published period as well as a
# draft one. The script changes the stack it runs against, so point it at a
# demo stack. A second run finds the week published already and moves on.
SCHEDULE_PERIOD_ID=$(curl -s "$BASE/api/v1/schedule?unitId=$UNIT_ID&from=2026-11-16&to=2026-11-22" \
  -H "Authorization: Bearer $SUPERVISOR" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("period", {}).get("id", ""))')

if [ -n "$SCHEDULE_PERIOD_ID" ]; then
  curl -s -X POST "$BASE/api/v1/schedule-periods/$SCHEDULE_PERIOD_ID/publish" \
    -H "Authorization: Bearer $SUPERVISOR" > /dev/null
fi

save schedule-published "/api/v1/schedule?unitId=$UNIT_ID&from=2026-11-16&to=2026-11-22" "$SUPERVISOR"
save schedule-auditor "/api/v1/schedule?unitId=$UNIT_ID&from=2026-11-16&to=2026-11-22" "$AUDITOR"
save reports-coverage-auditor /api/v1/reports/coverage "$AUDITOR"
save reports-overrides-auditor /api/v1/reports/overrides "$AUDITOR"

echo "Contract samples are in $OUT."
