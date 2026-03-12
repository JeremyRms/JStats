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
      --fail \
      -X POST "$api_base/api/saved_objects/_export" \
      -H "Content-Type: application/json" \
      -d '{"type":["dashboard","lens","search","index-pattern","url","config"],"includeReferencesDeep":true,"excludeExportDetails":true}' \
      -o "$file_path"
    echo "Exported Kibana saved objects to $file_path"
    ;;
  import)
    if [[ ! -f "$file_path" ]]; then
      echo "File not found: $file_path" >&2
      exit 1
    fi

    sanitized_file="$(mktemp "${TMPDIR:-/tmp}/kibana-import.XXXXXX.ndjson")"
    response_file="$(mktemp "${TMPDIR:-/tmp}/kibana-import-response.XXXXXX.json")"
    headers_file="$(mktemp "${TMPDIR:-/tmp}/kibana-import-headers.XXXXXX.txt")"
    trap 'rm -f "$sanitized_file" "$response_file" "$headers_file"' EXIT

    node -e '
      const fs = require("fs");
      const input = process.argv[1];
      const output = process.argv[2];
      const lines = fs.readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean);
      const objects = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed.type === "string" && parsed.type.length > 0) {
            objects.push(JSON.stringify(parsed));
          }
        } catch (error) {
          // Keep import strict: malformed lines are ignored from sanitization output.
        }
      }
      if (!objects.length) {
        console.error("No importable saved objects found in NDJSON file.");
        process.exit(1);
      }
      fs.writeFileSync(output, `${objects.join("\n")}\n`, "utf8");
    ' "$file_path" "$sanitized_file"

    import_status="$(curl "${curl_args[@]}" \
      --output "$response_file" \
      --dump-header "$headers_file" \
      --write-out "%{http_code}" \
      -X POST "$api_base/api/saved_objects/_import?overwrite=true" \
      -F "file=@$sanitized_file" || true)"

    if [[ ! "${import_status:-}" =~ ^[0-9]{3}$ ]]; then
      echo "Kibana import failed before receiving an HTTP status code." >&2
      cat "$response_file" >&2 || true
      echo >&2
      exit 1
    fi

    if [[ "$import_status" -lt 200 || "$import_status" -ge 300 ]]; then
      echo "Kibana import failed with HTTP $import_status" >&2
      echo "Response body:" >&2
      if [[ -s "$response_file" ]]; then
        cat "$response_file" >&2
      else
        echo "(empty body)" >&2
      fi
      echo >&2
      echo "Response headers:" >&2
      cat "$headers_file" >&2
      echo >&2
      exit 1
    fi

    cat "$response_file"
    echo
    echo "Imported Kibana saved objects from $file_path"
    ;;
  *)
    usage
    exit 1
    ;;
esac
