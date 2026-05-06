#!/usr/bin/env bash
#
# Blue/green (or rolling) deployment over SSH.
#
# Blue/green in one paragraph: the target host runs two identical compose
# projects, `portal-blue` and `portal-green`, behind an nginx upstream file.
# Exactly one is live. A deploy starts the *idle* colour on its own ports,
# waits for it to pass its own health check, flips the upstream and reloads
# nginx, then stops the old colour. Because the old colour is still running and
# healthy until the final step, a rollback is a second upstream flip — seconds,
# not a rebuild.
#
# Usage:
#   deploy.sh --environment staging --host h --user u --registry r --tag t [--run-migrations]
#   deploy.sh --environment production --host h --user u --registry r --rollback

set -euo pipefail

ENVIRONMENT=""
HOST=""
USER_NAME="deploy"
REGISTRY=""
TAG=""
STRATEGY="blue-green"
RUN_MIGRATIONS="false"
ROLLBACK="false"
HEALTH_RETRIES=30
HEALTH_DELAY=4

log()  { printf '\033[0;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --environment)    ENVIRONMENT="$2"; shift 2 ;;
    --host)           HOST="$2"; shift 2 ;;
    --user)           USER_NAME="$2"; shift 2 ;;
    --registry)       REGISTRY="$2"; shift 2 ;;
    --tag)            TAG="$2"; shift 2 ;;
    --strategy)       STRATEGY="$2"; shift 2 ;;
    --run-migrations) RUN_MIGRATIONS="true"; shift ;;
    --rollback)       ROLLBACK="true"; shift ;;
    -h|--help)        sed -n '2,20p' "$0"; exit 0 ;;
    *)                die "Unknown argument: $1" ;;
  esac
done

[ -n "$ENVIRONMENT" ] || die "--environment is required"
[ -n "$HOST" ]        || die "--host is required"
[ -n "$REGISTRY" ]    || die "--registry is required"

REMOTE="${USER_NAME}@${HOST}"
APP_DIR="/opt/employee-portal"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30"

remote() {
  # shellcheck disable=SC2029  # deliberate client-side expansion
  ssh $SSH_OPTS "$REMOTE" "$@"
}

# ---------------------------------------------------------------------------
# Rollback: flip the upstream back to the colour recorded as previous.
# ---------------------------------------------------------------------------
if [ "$ROLLBACK" = "true" ]; then
  warn "Rolling back ${ENVIRONMENT} on ${HOST}"

  PREVIOUS=$(remote "cat ${APP_DIR}/.previous-color 2>/dev/null || echo ''")
  [ -n "$PREVIOUS" ] || die "No previous colour recorded — cannot roll back automatically"

  log "Restoring the ${PREVIOUS} stack"
  remote "cd ${APP_DIR} && \
    docker compose -p portal-${PREVIOUS} up -d && \
    sleep 5 && \
    ln -sfn ${APP_DIR}/nginx/upstream-${PREVIOUS}.conf ${APP_DIR}/nginx/upstream.conf && \
    sudo nginx -t && sudo systemctl reload nginx && \
    echo ${PREVIOUS} > ${APP_DIR}/.active-color"

  ok "Rolled back to ${PREVIOUS}"
  exit 0
fi

[ -n "$TAG" ] || die "--tag is required for a deploy"

log "Deploying ${REGISTRY}/employee-portal-*:${TAG} to ${ENVIRONMENT} (${HOST}) using ${STRATEGY}"

ACTIVE=$(remote "cat ${APP_DIR}/.active-color 2>/dev/null || echo 'blue'")
if [ "$ACTIVE" = "blue" ]; then TARGET="green"; else TARGET="blue"; fi
log "Active colour: ${ACTIVE} → deploying into ${TARGET}"

# ---------------------------------------------------------------------------
# 1. Ship the compose file and pull the images before anything is stopped, so a
#    registry problem fails the deploy while the old version is still serving.
# ---------------------------------------------------------------------------
log "Syncing the compose definition"
scp $SSH_OPTS docker-compose.yml "${REMOTE}:${APP_DIR}/docker-compose.yml"

log "Pulling images"
remote "cd ${APP_DIR} && \
  export REGISTRY=${REGISTRY} IMAGE_TAG=${TAG} && \
  docker compose pull api web"

# ---------------------------------------------------------------------------
# 2. Migrations run once, before the new colour takes traffic. Migrations in
#    this project are additive by convention, so the old colour keeps working
#    against the migrated schema during the overlap window.
# ---------------------------------------------------------------------------
if [ "$RUN_MIGRATIONS" = "true" ]; then
  log "Applying database migrations"
  remote "cd ${APP_DIR} && \
    export REGISTRY=${REGISTRY} IMAGE_TAG=${TAG} && \
    docker compose --profile tools run --rm migrate" \
    || die "Migrations failed — nothing has been switched, the current release is untouched"
  ok "Migrations applied"
fi

# ---------------------------------------------------------------------------
# 3. Start the idle colour.
# ---------------------------------------------------------------------------
if [ "$STRATEGY" = "rolling" ]; then
  log "Rolling restart in place"
  remote "cd ${APP_DIR} && \
    export REGISTRY=${REGISTRY} IMAGE_TAG=${TAG} && \
    docker compose -p portal-${ACTIVE} up -d --no-deps --force-recreate api web"
  TARGET="$ACTIVE"
else
  log "Starting the ${TARGET} stack"
  remote "cd ${APP_DIR} && \
    export REGISTRY=${REGISTRY} IMAGE_TAG=${TAG} COLOR=${TARGET} && \
    docker compose -p portal-${TARGET} up -d"
fi

# ---------------------------------------------------------------------------
# 4. Health gate on the new colour's own port, before any traffic is sent.
# ---------------------------------------------------------------------------
if [ "$TARGET" = "blue" ]; then PROBE_PORT=4001; else PROBE_PORT=4002; fi
log "Waiting for ${TARGET} to report ready on :${PROBE_PORT}"

attempt=1
until remote "curl -fsS http://127.0.0.1:${PROBE_PORT}/api/v1/health/ready > /dev/null"; do
  if [ "$attempt" -ge "$HEALTH_RETRIES" ]; then
    warn "New colour never became healthy — leaving ${ACTIVE} live and tearing down ${TARGET}"
    remote "cd ${APP_DIR} && docker compose -p portal-${TARGET} logs --tail=120 api || true"
    remote "cd ${APP_DIR} && docker compose -p portal-${TARGET} down || true"
    die "Deployment aborted; production traffic never moved"
  fi
  printf '  attempt %s/%s…\n' "$attempt" "$HEALTH_RETRIES"
  attempt=$((attempt + 1))
  sleep "$HEALTH_DELAY"
done
ok "${TARGET} is healthy"

# ---------------------------------------------------------------------------
# 5. Switch the upstream, record the colours, drain the old one.
# ---------------------------------------------------------------------------
if [ "$STRATEGY" != "rolling" ]; then
  log "Switching nginx upstream to ${TARGET}"
  remote "ln -sfn ${APP_DIR}/nginx/upstream-${TARGET}.conf ${APP_DIR}/nginx/upstream.conf && \
    sudo nginx -t && sudo systemctl reload nginx"

  remote "echo ${ACTIVE} > ${APP_DIR}/.previous-color && echo ${TARGET} > ${APP_DIR}/.active-color"
  ok "Traffic now served by ${TARGET}"

  # The previous colour stays up for a grace period: an instant rollback is
  # just another upstream flip while it is still running.
  log "Draining ${ACTIVE} after a 60s grace period"
  remote "sleep 60 && cd ${APP_DIR} && docker compose -p portal-${ACTIVE} stop || true" &
  wait
fi

remote "cd ${APP_DIR} && docker image prune -f --filter 'until=72h' || true"

ok "Deployed ${TAG} to ${ENVIRONMENT} (${TARGET})"
