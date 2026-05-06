#!/usr/bin/env bash
#
# Post-deploy smoke tests.
#
# Deliberately narrow: this is not the Newman suite. It answers one question —
# "is the thing we just deployed actually the thing we built, and does its most
# important path work?" — fast enough to run inside the deploy window.
#
# Usage:
#   smoke-test.sh --base-url https://staging.employee-portal.internal \
#                 --expected-version 4f2c9ab1de03

set -euo pipefail

BASE_URL=""
EXPECTED_VERSION=""
API_PREFIX="/api/v1"
MAX_LATENCY_MS=1500
DEMO_EMAIL="${SMOKE_EMAIL:-employee@portal.dev}"
DEMO_PASSWORD="${SMOKE_PASSWORD:-Employee@12345}"

PASSED=0
FAILED=0

pass() { printf '\033[0;32m  ✔ %s\033[0m\n' "$*"; PASSED=$((PASSED + 1)); }
fail() { printf '\033[0;31m  ✖ %s\033[0m\n' "$*"; FAILED=$((FAILED + 1)); }
head() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url)         BASE_URL="$2"; shift 2 ;;
    --expected-version) EXPECTED_VERSION="$2"; shift 2 ;;
    --api-prefix)       API_PREFIX="$2"; shift 2 ;;
    --max-latency)      MAX_LATENCY_MS="$2"; shift 2 ;;
    -h|--help)          sed -n '2,14p' "$0"; exit 0 ;;
    *)                  die "Unknown argument: $1" ;;
  esac
done

[ -n "$BASE_URL" ] || die "--base-url is required"
command -v curl >/dev/null || die "curl is required"
command -v jq   >/dev/null || die "jq is required"

API="${BASE_URL}${API_PREFIX}"
printf '\033[1mSmoke testing %s\033[0m\n' "$BASE_URL"

# ---------------------------------------------------------------------------
head '1. Liveness and version'
# ---------------------------------------------------------------------------
HEALTH=$(curl -fsS --max-time 10 "${BASE_URL}/health" || echo '')
if [ -z "$HEALTH" ]; then
  fail 'liveness probe unreachable'
  die 'Aborting: the service is not answering at all'
fi
pass 'liveness probe answered'

STATUS=$(printf '%s' "$HEALTH" | jq -r '.status // "unknown"')
[ "$STATUS" = 'ok' ] && pass 'status is ok' || fail "status is ${STATUS}"

if [ -n "$EXPECTED_VERSION" ]; then
  DEPLOYED=$(printf '%s' "$HEALTH" | jq -r '.version // "unset"')
  if [ "$DEPLOYED" = "$EXPECTED_VERSION" ]; then
    pass "running the expected build (${DEPLOYED})"
  else
    # The most valuable assertion in the file: it catches a deploy that
    # silently kept serving the previous image.
    fail "version mismatch — expected ${EXPECTED_VERSION}, serving ${DEPLOYED}"
  fi
fi

# ---------------------------------------------------------------------------
head '2. Readiness (database round trip)'
# ---------------------------------------------------------------------------
READY=$(curl -fsS --max-time 10 "${API}/health/ready" || echo '')
DB=$(printf '%s' "$READY" | jq -r '.checks.database // "down"')
[ "$DB" = 'up' ] && pass 'database reachable from the API' || fail 'database check reports down'

# ---------------------------------------------------------------------------
head '3. Static shell'
# ---------------------------------------------------------------------------
SPA_CODE=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/" || echo '000')
[ "$SPA_CODE" = '200' ] && pass 'SPA index served' || fail "SPA index returned ${SPA_CODE}"

DEEP_CODE=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/leave/approvals" || echo '000')
[ "$DEEP_CODE" = '200' ] && pass 'SPA deep link falls back to index' || fail "deep link returned ${DEEP_CODE}"

# ---------------------------------------------------------------------------
head '4. Authentication'
# ---------------------------------------------------------------------------
LOGIN=$(curl -fsS --max-time 15 -X POST "${API}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEMO_EMAIL}\",\"password\":\"${DEMO_PASSWORD}\"}" || echo '')

TOKEN=$(printf '%s' "$LOGIN" | jq -r '.accessToken // empty')
if [ -n "$TOKEN" ]; then
  pass 'login issued an access token'
else
  fail 'login failed'
fi

BAD_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "${API}/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@portal.dev","password":"definitely-wrong"}')
[ "$BAD_CODE" = '401' ] && pass 'bad credentials rejected with 401' || fail "bad credentials returned ${BAD_CODE}"

UNAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${API}/employees")
[ "$UNAUTH_CODE" = '401' ] && pass 'protected route requires a token' || fail "unauthenticated directory returned ${UNAUTH_CODE}"

# ---------------------------------------------------------------------------
head '5. Core read paths'
# ---------------------------------------------------------------------------
if [ -n "$TOKEN" ]; then
  DIRECTORY=$(curl -fsS --max-time 15 "${API}/employees?pageSize=1" -H "Authorization: Bearer ${TOKEN}" || echo '')
  TOTAL=$(printf '%s' "$DIRECTORY" | jq -r '.meta.total // 0')
  [ "$TOTAL" -gt 0 ] && pass "directory returned ${TOTAL} employees" || fail 'directory is empty'

  DASH_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${API}/dashboard/summary" \
    -H "Authorization: Bearer ${TOKEN}")
  [ "$DASH_CODE" = '200' ] && pass 'dashboard summary served' || fail "dashboard returned ${DASH_CODE}"

  ORG_DEPTH=$(curl -fsS --max-time 15 "${API}/org-chart" -H "Authorization: Bearer ${TOKEN}" \
    | jq -r '.stats.maxDepth // 0')
  [ "$ORG_DEPTH" -gt 0 ] && pass "org chart resolved (depth ${ORG_DEPTH})" || fail 'org chart returned an empty tree'

  # RBAC: an EMPLOYEE token must not reach an HR-only endpoint.
  RBAC_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "${API}/departments" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    -d '{"code":"SMOKE","name":"Smoke Test"}')
  [ "$RBAC_CODE" = '403' ] && pass 'RBAC blocks an employee from HR endpoints' || fail "RBAC check returned ${RBAC_CODE}"
fi

# ---------------------------------------------------------------------------
head '6. Latency budget'
# ---------------------------------------------------------------------------
ELAPSED=$(curl -fsS -o /dev/null -w '%{time_total}' --max-time 20 "${API}/health/ready")
ELAPSED_MS=$(printf '%.0f' "$(echo "$ELAPSED * 1000" | bc -l)")
if [ "$ELAPSED_MS" -le "$MAX_LATENCY_MS" ]; then
  pass "readiness responded in ${ELAPSED_MS}ms (budget ${MAX_LATENCY_MS}ms)"
else
  fail "readiness took ${ELAPSED_MS}ms, over the ${MAX_LATENCY_MS}ms budget"
fi

# ---------------------------------------------------------------------------
printf '\n\033[1m%s passed, %s failed\033[0m\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ] || die 'Smoke tests failed — the pipeline will roll this deployment back'
printf '\033[0;32mAll smoke tests passed.\033[0m\n'
