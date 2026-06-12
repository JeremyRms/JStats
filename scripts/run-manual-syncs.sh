#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/jstats.yml}"
STACK_COMPOSE_FILE="${STACK_COMPOSE_FILE:-$REPO_ROOT/elastic-docker-tls.yml}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/.secrets}"
failures=()
overall_exit=0

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 1
  local line
  line="$(grep -m1 -F "${key}=" "$ENV_FILE" || true)"
  [[ -n "$line" ]] || return 1
  printf '%s' "${line#*=}"
}

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(read_env_value COMPOSE_PROJECT_NAME || printf 'jstats')}"
ES_CONTAINER_NAME="${ES_CONTAINER_NAME:-$(read_env_value ES_CONTAINER_NAME || printf 'es01')}"
HOST_ELASTIC_ENDPOINT="${HOST_ELASTIC_ENDPOINT:-https://localhost}"
HOST_ELASTIC_PORT="${HOST_ELASTIC_PORT:-$(read_env_value ELASTIC_HOST_PORT || printf '9200')}"
ELASTIC_ENDPOINT="${ELASTIC_ENDPOINT:-$HOST_ELASTIC_ENDPOINT}"
ELASTIC_PORT="${ELASTIC_PORT:-$HOST_ELASTIC_PORT}"
COMPOSE_ENV_ARGS=()
if [[ -f "$ENV_FILE" ]]; then
  COMPOSE_ENV_ARGS=(--env-file "$ENV_FILE")
fi

KIBANA_URL_FROM_ENV="$(read_env_value KIBANA_URL || true)"
if [[ -n "$KIBANA_URL_FROM_ENV" && -z "${KIBANA_URL:-}" ]]; then
  export KIBANA_URL="$KIBANA_URL_FROM_ENV"
fi

if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
  set +a
fi

ELASTIC_PASSWORD="$(read_env_value ELASTIC_PASSWORD || true)"
if [[ -z "$ELASTIC_PASSWORD" ]]; then
  die "Environment file $ENV_FILE is missing or ELASTIC_PASSWORD is unset."
else
  export ELASTIC_PASSWORD
fi

KIBANA_PASSWORD="$(read_env_value KIBANA_PASSWORD || true)"
if [[ -z "$KIBANA_PASSWORD" ]]; then
  die "KIBANA_PASSWORD not found in $ENV_FILE."
else
  export KIBANA_PASSWORD
fi

API_KEY="${API_KEY:-${GITHUB_TOKEN:-}}"
if [[ -z "$API_KEY" ]]; then
  die "GitHub token not found. Set GITHUB_TOKEN in $SECRETS_FILE or API_KEY in the environment."
else
  export API_KEY
fi

if [[ -z "${JIRA_API_TOKEN:-}" ]]; then
  JIRA_API_TOKEN_FILE="${JIRA_API_TOKEN_FILE:-$HOME/.jira/api_token}"
  if [[ -f "$JIRA_API_TOKEN_FILE" ]]; then
    JIRA_API_TOKEN="$(< "$JIRA_API_TOKEN_FILE")"
  else
    die "Jira token not found. Set JIRA_API_TOKEN in $SECRETS_FILE or provide $JIRA_API_TOKEN_FILE."
  fi
fi

if [[ -z "$JIRA_API_TOKEN" ]]; then
  die "Jira API token is empty."
fi

run_step() {
  local label="$1"
  shift
  printf '\n=== %s ===\n' "$label"
  if "$@"; then
    printf '✅ %s\n' "$label"
  else
    local code=$?
    printf '⚠️  %s (exit %d)\n' "$label" "$code"
    failures+=("$label (exit $code)")
    overall_exit=1
  fi
}

run_elastic_count() {
  local label="$1"
  local index="$2"
  local pw="${ELASTIC_PASSWORD:-}"
  run_step "$label" docker exec "$ES_CONTAINER_NAME" sh -lc "curl --silent --show-error --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u elastic:${pw} https://localhost:9200/${index}/_count"
}

run_elastic_refresh() {
  local label="$1"
  local index="$2"
  local pw="${ELASTIC_PASSWORD:-}"
  run_step "$label" docker exec "$ES_CONTAINER_NAME" sh -lc "curl --silent --show-error --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u elastic:${pw} -X POST https://localhost:9200/${index}/_refresh"
}

run_step 'Git status (pre-run)' git status --short

run_step 'npm test' npm test

run_step 'Team directory sync' env ELASTIC_ENDPOINT="$ELASTIC_ENDPOINT" ELASTIC_PORT="$ELASTIC_PORT" npm run team-directory:sync

run_elastic_refresh 'Refresh team directory indices' 'jstats-directory-*'
run_elastic_count 'Team directory member count' jstats-directory-member

run_step 'GitHub sync' docker-compose "${COMPOSE_ENV_ARGS[@]}" -p "$COMPOSE_PROJECT_NAME" -f "$STACK_COMPOSE_FILE" -f "$COMPOSE_FILE" run --rm \
  -e API_KEY="$API_KEY" \
  jstats bash -lc 'cd /app && npm start'

run_elastic_refresh 'Refresh GitHub indices' 'jstats-pullrequest,jstats-review,jstats-comment'
run_elastic_count 'Pull request count' jstats-pullrequest
run_elastic_count 'Review count' jstats-review
run_elastic_count 'Comment count' jstats-comment

run_step 'Contributor summary sync' env ELASTIC_ENDPOINT="$ELASTIC_ENDPOINT" ELASTIC_PORT="$ELASTIC_PORT" npm run contributor-summary:sync

run_elastic_refresh 'Refresh contributor summary index' jstats-contributor-summary
run_elastic_count 'Contributor summary count' jstats-contributor-summary

run_step 'Jira issue sync' docker-compose "${COMPOSE_ENV_ARGS[@]}" -p "$COMPOSE_PROJECT_NAME" -f "$STACK_COMPOSE_FILE" -f "$COMPOSE_FILE" run --rm \
  -e JIRA_API_TOKEN="$JIRA_API_TOKEN" \
  jstats bash -lc 'cd /app && JIRA_SYNC_YEAR=2026 JIRA_SYNC_PAGE_SIZE=100 JIRA_SYNC_RESUME=true npm run jira:sync-issues'

run_elastic_refresh 'Refresh Jira issue index' jstats-jira-issue
run_elastic_count 'Jira issue count' jstats-jira-issue

run_step 'Jira event sync' docker-compose "${COMPOSE_ENV_ARGS[@]}" -p "$COMPOSE_PROJECT_NAME" -f "$STACK_COMPOSE_FILE" -f "$COMPOSE_FILE" run --rm \
  -e JIRA_API_TOKEN="$JIRA_API_TOKEN" \
  jstats bash -lc "cd /app && JIRA_SYNC_YEAR=2026 JIRA_SYNC_PAGE_SIZE=100 JIRA_EVENT_SYNC_CONCURRENCY=4 JIRA_SYNC_RESUME=true npm run jira:sync-events"

run_elastic_refresh 'Refresh Jira event index' jstats-jira-event
run_step 'Jira event aggregation' docker exec "$ES_CONTAINER_NAME" sh -lc "curl --silent --show-error --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u elastic:${ELASTIC_PASSWORD:-} -H 'Content-Type: application/json' -X POST https://localhost:9200/jstats-jira-event/_search -d '{\"size\":0,\"aggs\":{\"by_event_type\":{\"terms\":{\"field\":\"event_type.keyword\",\"size\":10}}}}'"

run_step 'Kibana import GitHub dashboard' env KIBANA_PASSWORD="$KIBANA_PASSWORD" ./scripts/kibana-saved-objects.sh import dashboards/teamwork.ndjson
run_step 'Kibana import Jira dashboard' env KIBANA_PASSWORD="$KIBANA_PASSWORD" ./scripts/kibana-saved-objects.sh import dashboards/jira-teamwork.ndjson
run_step 'Kibana import Team Directory dashboard' env KIBANA_PASSWORD="$KIBANA_PASSWORD" ./scripts/kibana-saved-objects.sh import dashboards/team-directory.ndjson

run_step 'Git status (post-run)' git status --short

if [[ ${#failures[@]} -gt 0 ]]; then
  printf '\nCompleted with failures:\n' >&2
  for failure in "${failures[@]}"; do
    printf ' - %s\n' "$failure" >&2
  done
else
  printf '\nAll steps finished without failure.\n'
fi

exit "$overall_exit"
