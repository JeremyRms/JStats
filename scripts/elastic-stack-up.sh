#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.elastic8}"
CERTS_COMPOSE_FILE="${CERTS_COMPOSE_FILE:-$REPO_ROOT/create-certs.yml}"
STACK_COMPOSE_FILE="${STACK_COMPOSE_FILE:-$REPO_ROOT/elastic-docker-tls.yml}"

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

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE. Copy .env.elastic8.example and fill in the local values first."

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(read_env_value COMPOSE_PROJECT_NAME || printf 'jstats')}"
ES_CONTAINER_NAME="${ES_CONTAINER_NAME:-$(read_env_value ES_CONTAINER_NAME || printf 'es01')}"
KIBANA_ELASTICSEARCH_USERNAME="${KIBANA_ELASTICSEARCH_USERNAME:-$(read_env_value KIBANA_ELASTICSEARCH_USERNAME || printf 'elastic')}"
ELASTIC_PASSWORD="${ELASTIC_PASSWORD:-$(read_env_value ELASTIC_PASSWORD || true)}"
ES_BOOTSTRAP_PASSWORD="${ES_BOOTSTRAP_PASSWORD:-$(read_env_value ES_BOOTSTRAP_PASSWORD || true)}"
KIBANA_URL="${KIBANA_URL:-$(read_env_value KIBANA_URL || true)}"
KIBANA_HOST_PORT="${KIBANA_HOST_PORT:-$(read_env_value KIBANA_HOST_PORT || printf '5601')}"

[[ -n "$ELASTIC_PASSWORD" ]] || die "ELASTIC_PASSWORD must be set in $ENV_FILE."
if [[ -n "$ES_BOOTSTRAP_PASSWORD" && "$ES_BOOTSTRAP_PASSWORD" != "$ELASTIC_PASSWORD" ]]; then
  die "ES_BOOTSTRAP_PASSWORD and ELASTIC_PASSWORD must match for this local stack."
fi

compose() {
  docker-compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" "$@"
}

wait_for_elasticsearch() {
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec -e ELASTIC_PASSWORD="$ELASTIC_PASSWORD" "$ES_CONTAINER_NAME" sh -lc 'curl --silent --fail --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u "elastic:${ELASTIC_PASSWORD}" https://localhost:9200 >/dev/null'; then
      return 0
    fi
    sleep 2
  done

  return 1
}

printf 'Creating certificates for Compose project %s...\n' "$COMPOSE_PROJECT_NAME"
compose -f "$CERTS_COMPOSE_FILE" run --rm create_certs

printf 'Starting Elasticsearch...\n'
compose -f "$STACK_COMPOSE_FILE" up -d es01

printf 'Waiting for Elasticsearch...\n'
wait_for_elasticsearch || die "Elasticsearch did not become ready in time."

if [[ "$KIBANA_ELASTICSEARCH_USERNAME" == "kibana_system" ]]; then
  printf 'Configuring kibana_system credentials...\n'
  docker exec -e ELASTIC_PASSWORD="$ELASTIC_PASSWORD" "$ES_CONTAINER_NAME" sh -lc 'curl --silent --show-error --fail --cacert /usr/share/elasticsearch/config/certificates/ca/ca.crt -u "elastic:${ELASTIC_PASSWORD}" -H "Content-Type: application/json" -X POST https://localhost:9200/_security/user/kibana_system/_password -d "{\"password\":\"${ELASTIC_PASSWORD}\"}" >/dev/null'
fi

printf 'Starting Kibana...\n'
compose -f "$STACK_COMPOSE_FILE" up -d kib01

printf 'Kibana is starting at %s\n' "${KIBANA_URL:-https://localhost:${KIBANA_HOST_PORT}}"
