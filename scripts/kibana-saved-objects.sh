#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/kibana-saved-objects.sh export [output_file]
  scripts/kibana-saved-objects.sh import [input_file]

Defaults:
  output/input file: dashboards/teamwork.ndjson

Required env vars:
  KIBANA_PASSWORD

Optional env vars:
  KIBANA_URL=https://localhost:5601
  KIBANA_USERNAME=elastic
  KIBANA_SPACE=default
  KIBANA_INSECURE_TLS=true
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

command="$1"
file_path="${2:-dashboards/teamwork.ndjson}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if [[ -z "${KIBANA_PASSWORD:-}" ]]; then
  echo "KIBANA_PASSWORD is required" >&2
  exit 1
fi

KIBANA_URL="${KIBANA_URL:-https://localhost:5601}"
KIBANA_USERNAME="${KIBANA_USERNAME:-elastic}"
KIBANA_SPACE="${KIBANA_SPACE:-default}"
KIBANA_INSECURE_TLS="${KIBANA_INSECURE_TLS:-true}"

api_base="${KIBANA_URL%/}"
if [[ "$KIBANA_SPACE" != "default" ]]; then
  api_base="$api_base/s/$KIBANA_SPACE"
fi

curl_args=(
  --fail
  --silent
  --show-error
  -u "$KIBANA_USERNAME:$KIBANA_PASSWORD"
  -H "kbn-xsrf: true"
)

if [[ "$KIBANA_INSECURE_TLS" == "true" ]]; then
  curl_args+=(-k)
fi

case "$command" in
  export)
    mkdir -p "$(dirname "$file_path")"
    curl "${curl_args[@]}" \
      -X POST "$api_base/api/saved_objects/_export" \
      -H "Content-Type: application/json" \
      -d '{"type":["dashboard","lens","index-pattern","url","config"],"includeReferencesDeep":true}' \
      -o "$file_path"
    echo "Exported Kibana saved objects to $file_path"
    ;;
  import)
    if [[ ! -f "$file_path" ]]; then
      echo "File not found: $file_path" >&2
      exit 1
    fi

    curl "${curl_args[@]}" \
      -X POST "$api_base/api/saved_objects/_import?overwrite=true" \
      -F "file=@$file_path"
    echo
    echo "Imported Kibana saved objects from $file_path"
    ;;
  *)
    usage
    exit 1
    ;;
esac
