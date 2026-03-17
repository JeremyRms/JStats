# JStats

JStats ingests GitHub organization data and stores it in Elasticsearch for Kibana dashboards that track pull requests, reviews, and review comments.

## What this repo currently contains
- Ingestion service: `app.js`
- Local Elastic/Kibana Docker setup: `elastic-docker-tls.yml`, `create-certs.yml`, `jstats.yml`
- Bootstrap helper: `bootstrap.sh`
- Versioned Kibana saved objects: `dashboards/teamwork.ndjson`

## Local startup
Run:

```bash
./bootstrap.sh
```

Then open [https://localhost:5601](https://localhost:5601).

## Dashboard as code workflow
Kibana assets are tracked in source control as NDJSON and can be imported/exported with script automation.

### Export saved objects from Kibana
```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh export dashboards/teamwork.ndjson
```

### Import saved objects into Kibana
```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh import dashboards/teamwork.ndjson
```

### Optional environment variables
- `KIBANA_URL` (default `https://localhost:5601`)
- `KIBANA_USERNAME` (default `elastic`)
- `KIBANA_SPACE` (default `default`)
- `KIBANA_INSECURE_TLS` (default `true`)
- `API_KEY_FILE` (default `~/.jstats/github_api_key`)
- `JIRA_API_TOKEN_FILE` (default `~/.jira/api_token`)
- `STATE_FILE` (default `./.jstats-state.json`)
- `MIN_PULL_UPDATED_AT` (default `2025-01-01T00:00:00Z`)
- `PR_CONCURRENCY` (default `4`)
- `RATE_LIMIT_RESET_BUFFER_SECONDS` (default `5`)
- `RATE_LIMIT_RECOVERY_RETRIES` (default `4`)

## Secret files
GitHub and Jira tokens can be loaded from files in your home directory before falling back to `.env`.

Default locations:

```bash
mkdir -p ~/.jstats
mkdir -p ~/.jira
printf '%s\n' '<github-token>' > ~/.jstats/github_api_key
printf '%s\n' '<jira-api-token>' > ~/.jira/api_token
chmod 600 ~/.jstats/github_api_key ~/.jira/api_token
```

If a secret file exists, it overrides the value from `.env`. If it does not exist, the `.env` value is used.

## Notes
- Saved objects include the `Teamwork` dashboard and related Lens visualizations/index patterns.
- Ingestion persists a local pull `updated_at` watermark per repository in `.jstats-state.json` to avoid reprocessing unchanged pull requests on subsequent runs.
- Ingestion skips pull updates older than `MIN_PULL_UPDATED_AT` (defaults to the start of 2025).
- Ingestion prints a progress bar while indexing (`indexed/planned` documents).
