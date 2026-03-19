#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
ELASTIC_ENDPOINT="${ELASTIC_ENDPOINT:-https://localhost}"
ELASTIC_PORT="${ELASTIC_PORT:-9200}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/jstats.yml}"
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

GITHUB_API_KEY_FILE="${GITHUB_API_KEY_FILE:-$HOME/.jstats/github_api_key}"
if [[ -f "$GITHUB_API_KEY_FILE" ]]; then
  GITHUB_API_KEY="$(< "$GITHUB_API_KEY_FILE")"
else
  die "GitHub API key file $GITHUB_API_KEY_FILE not found."
fi

if [[ -z "$GITHUB_API_KEY" ]]; then
  die "GitHub API key file $GITHUB_API_KEY_FILE is empty."
fi

JIRA_API_TOKEN_FILE="${JIRA_API_TOKEN_FILE:-$HOME/.jira/api_token}"
if [[ -f "$JIRA_API_TOKEN_FILE" ]]; then
  JIRA_API_TOKEN="$(< "$JIRA_API_TOKEN_FILE")"
else
  die "Jira API token file $JIRA_API_TOKEN_FILE not found."
fi

if [[ -z "$JIRA_API_TOKEN" ]]; then
  die "Jira API token file $JIRA_API_TOKEN_FILE is empty."
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
  run_step "$label" docker exec es01 sh -lc "curl --silent --show-error --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u elastic:${pw} https://localhost:9200/${index}/_count"
}

run_step 'Git status (pre-run)' git status --short

run_step 'npm test' npm test

run_step 'Team directory sync' env ELASTIC_ENDPOINT="$ELASTIC_ENDPOINT" ELASTIC_PORT="$ELASTIC_PORT" npm run team-directory:sync

run_elastic_count 'Team directory member count' jstats-directory-member

run_step 'GitHub sync' docker-compose -p jstats -f "$COMPOSE_FILE" run --rm \
  -e API_KEY="$GITHUB_API_KEY" \
  jstats bash -lc 'cd /app && npm start'

run_elastic_count 'Pull request count' jstats-pullrequest
run_elastic_count 'Review count' jstats-review
run_elastic_count 'Comment count' jstats-comment

run_step 'Jira issue sync' docker-compose -p jstats -f "$COMPOSE_FILE" run --rm \
  -e JIRA_API_TOKEN="$JIRA_API_TOKEN" \
  jstats bash -lc 'cd /app && JIRA_SYNC_YEAR=2026 JIRA_SYNC_PAGE_SIZE=100 JIRA_SYNC_RESUME=true npm run jira:sync-issues'

run_elastic_count 'Jira issue count' jstats-jira-issue

run_step 'Jira event sync' docker-compose -p jstats -f "$COMPOSE_FILE" run --rm \
  -e JIRA_API_TOKEN="$JIRA_API_TOKEN" \
  jstats bash -lc "cd /app && JIRA_SYNC_YEAR=2026 JIRA_SYNC_PAGE_SIZE=100 JIRA_EVENT_SYNC_CONCURRENCY=4 JIRA_SYNC_RESUME=true npm run jira:sync-events"

run_step 'Jira event aggregation' bash -lc "PW=\"${ELASTIC_PASSWORD:-}\" docker exec es01 sh -lc \"curl --silent --show-error --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u elastic:\\${PW} -H 'Content-Type: application/json' -X POST https://localhost:9200/jstats-jira-event/_search -d '{\\\"size\\\":0,\\\"aggs\\\":{\\\"by_event_type\\\":{\\\"terms\\\":{\\\"field\\\":\\\"event_type.keyword\\\",\\\"size\\\":10}}}}'\""

run_step 'Kibana import GitHub dashboard' env KIBANA_PASSWORD="$KIBANA_PASSWORD" ./scripts/kibana-saved-objects.sh import dashboards/teamwork.ndjson
run_step 'Kibana import Jira dashboard' env KIBANA_PASSWORD="$KIBANA_PASSWORD" ./scripts/kibana-saved-objects.sh import dashboards/jira-teamwork.ndjson

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
