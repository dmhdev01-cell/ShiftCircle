#!/usr/bin/env bash
# Check that the web has a label for every audit code the api writes.
#
# The api writes audit rows with an action code and an entity type. The audit
# screen shows plain words for both, so the two lists have to stay in step:
# web/src/audit/auditCodes.ts is the list, and this script compares it with
# the codes the api sources actually write.
#
# Run it from the repo root, like the other checks:
#   ./scripts/check-audit-codes.sh
set -euo pipefail
cd $(dirname $0)/..

WEB_LIST=web/src/audit/auditCodes.ts

api_codes=$(find api -path '*/src/main/java/*' -name '*.java' | xargs perl scripts/extract-audit-codes.pl | sort -u)

web_actions=$(sed -n '/export const API_AUDIT_ACTIONS/,/as const;/p' $WEB_LIST | grep -oE '[a-z][a-z_]*' | grep -vxE 'export|const|as')
web_entities=$(sed -n '/export const API_AUDIT_ENTITIES/,/as const;/p' $WEB_LIST | grep -oE '[a-z][a-z_]*' | grep -vxE 'export|const|as')
web_codes=$(printf '%s\n%s\n' $web_actions $web_entities | sort -u)

missing=$(comm -23 <(printf '%s\n' $api_codes) <(printf '%s\n' $web_codes))
extra=$(comm -13 <(printf '%s\n' $api_codes) <(printf '%s\n' $web_codes))

if [ -n "$missing" ] || [ -n "$extra" ]; then
  echo 'The api and the web do not agree on the audit codes.'
  if [ -n "$missing" ]; then
    echo 'The api writes codes the web has no label for:'
    printf '%s\n' $missing | sed 's/^/  /'
  fi
  if [ -n "$extra" ]; then
    echo 'The web lists codes the api does not write:'
    printf '%s\n' $extra | sed 's/^/  /'
  fi
  echo 'Fix web/src/audit/auditCodes.ts and run this again.'
  exit 1
fi

echo "Audit codes agree: $(printf '%s\n' $api_codes | wc -l | tr -d ' ') codes."
