# JStats

JStats ingests GitHub organization data and stores it in Elasticsearch for Kibana dashboards that track pull requests, reviews, and review comments.

## What this repo currently contains
- Ingestion service: `app.js`
- Local Elastic/Kibana Docker setup: `elastic-docker-tls.yml`, `create-certs.yml`, `jstats.yml`
- Elastic/Kibana 8 clean-rebuild helper: `.env.elastic8.example`, `scripts/elastic-stack-up.sh`
- Bootstrap helper: `bootstrap.sh`
- Shared team/member directory: `config/team-directory.json`
- Versioned Kibana saved objects:
  - `dashboards/teamwork.ndjson`
  - `dashboards/jira-teamwork.ndjson`
  - `dashboards/team-directory.ndjson`

## Local startup
The existing bootstrap path is the legacy local stack:

Run:

```bash
./bootstrap.sh
```

Then open [https://localhost:5601](https://localhost:5601).

## Elastic/Kibana 8 clean rebuild
Use this path for the 8.x migration. It creates a separate Docker Compose project, ports, and volumes so the old 7.14 data directory is not reused.

```bash
cp .env.elastic8.example .env.elastic8
```

Edit `.env.elastic8` and set at least:

- `ORGANIZATION`
- `ES_BOOTSTRAP_PASSWORD`
- `ELASTIC_PASSWORD`
- `KIBANA_PASSWORD`
- Jira fields if Jira dashboards are being refreshed

For this local 8.x stack, keep `ES_BOOTSTRAP_PASSWORD`, `ELASTIC_PASSWORD`, and `KIBANA_PASSWORD` set to the same value. Kibana connects to Elasticsearch with `kibana_system`, and `scripts/elastic-stack-up.sh` sets that user to the same local password.

Start the new stack:

```bash
ENV_FILE=.env.elastic8 ./scripts/elastic-stack-up.sh
```

Then open [https://localhost:5608](https://localhost:5608).

Run a full data refresh against the 8.x stack:

```bash
set -a
source ~/.secrets
set +a
export API_KEY="${API_KEY:-$GITHUB_TOKEN}"
ENV_FILE=.env.elastic8 ./scripts/run-manual-syncs.sh
```

Import dashboards manually if needed:

```bash
KIBANA_PASSWORD='<elastic-password>' \
KIBANA_URL=https://localhost:5608 \
./scripts/kibana-saved-objects.sh import dashboards/teamwork.ndjson
```

```bash
KIBANA_PASSWORD='<elastic-password>' \
KIBANA_URL=https://localhost:5608 \
./scripts/kibana-saved-objects.sh import dashboards/jira-teamwork.ndjson
```

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

```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh import dashboards/jira-teamwork.ndjson
```

```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh import dashboards/team-directory.ndjson
```

### Optional environment variables
- `KIBANA_URL` (default `https://localhost:5601`)
- `KIBANA_USERNAME` (default `elastic`)
- `KIBANA_SPACE` (default `default`)
- `KIBANA_INSECURE_TLS` (default `true`)
- `ES_CONTAINER_NAME` (default `es01`; use `es01-8` for the 8.x side-by-side stack)
- `ELASTIC_HOST_PORT` (default `9200`; use `9208` for the 8.x side-by-side stack)
- `KIBANA_HOST_PORT` (default `5601`; use `5608` for the 8.x side-by-side stack)
- `KIBANA_ELASTICSEARCH_USERNAME` (default `elastic`; use `kibana_system` for the 8.x side-by-side stack)
- `ORGANIZATION` (GitHub organization to ingest)
- `JIRA_BASE_URL` (example `https://your-org.atlassian.net`)
- `JIRA_EMAIL`
- `JIRA_JQL`
- `JIRA_PROJECT_KEYS` (comma-separated Jira project keys to track)
- `TEAM_DIRECTORY_FILE` (default `config/team-directory.json`)
- `GITHUB_TOKEN` (GitHub token; copied to `API_KEY` when `API_KEY` is unset)
- `API_KEY` (runtime GitHub token variable used by the ingestion app)
- `JIRA_API_TOKEN_FILE` (default `~/.jira/api_token`)
- `JIRA_API_TOKEN_HOST_PATH` (host path mounted into `jstats.yml`, default local `.env` value `~/.jira/api_token`)
- `STATE_FILE` (default `./.jstats-state.json`)
- `MIN_PULL_UPDATED_AT` (default `2025-01-01T00:00:00Z`)
- `PR_CONCURRENCY` (default `4`)
- `RATE_LIMIT_RESET_BUFFER_SECONDS` (default `5`)
- `RATE_LIMIT_RECOVERY_RETRIES` (default `4`)
- `JSTATS_HTTP_SERVER` (default `false`; set to `true` only when the GitHub ingester should keep a health server running after ingestion)

## Secrets
GitHub tokens are loaded from the environment. On local machines, source `~/.secrets` before running sync commands:

```bash
set -a
source ~/.secrets
set +a
export API_KEY="${API_KEY:-$GITHUB_TOKEN}"
```

Jira tokens can still be loaded from a file before falling back to the environment:

```bash
mkdir -p ~/.jira
printf '%s\n' '<jira-api-token>' > ~/.jira/api_token
chmod 600 ~/.jira/api_token
```

When running via `jstats.yml`, Docker passes GitHub token environment variables and mounts the Jira token file read-only:

```bash
API_KEY="${API_KEY:-$GITHUB_TOKEN}"
JIRA_API_TOKEN_FILE=/run/secrets/jira_api_token
```

The Jira host-side source path is controlled by:

```bash
JIRA_API_TOKEN_HOST_PATH=~/.jira/api_token
```

If the Jira host path is unset, `jstats.yml` falls back to mounting `/dev/null`, so the app will then fall back to environment values instead of crashing on a missing bind source.

## Jira auth check
Verify Jira credentials and print the authenticated Jira user:

```bash
npm run jira:auth-check
```

## Shared team/member directory
Canonical team and user mapping lives in `config/team-directory.json`.

It is the shared source for:

- team membership
- GitHub login to person mapping
- Jira account to person mapping
- Jira project to team mapping

Current tracked teams are:

- `BROK` -> Broker
- `MAR` -> Marketplace

File shape:

```json
{
  "version": 1,
  "teams": [
    {
      "key": "BROK",
      "name": "Broker",
      "jira_project_key": "BROK",
      "active": true
    }
  ],
  "members": [
    {
      "key": "example-person",
      "team_key": "BROK",
      "source_record_ids": [
        "123"
      ],
      "full_name": "Example Person",
      "nickname": "Example",
      "email": "example.person@company.test",
      "role": "Engineer",
      "allocation_percent": 100,
      "github_login": null,
      "jira_account_id": null,
      "jira_display_name": null,
      "manager_name": "Manager Name",
      "start_date": "2026-01-01",
      "location_country": "Thailand",
      "location_city": "Bangkok",
      "nationality": "Thai",
      "image_url": "https://example.test/avatar.jpg",
      "active": true
    }
  ]
}
```

Notes:

- `jira_account_id` should be treated as the canonical Jira identity in Jira Cloud.
- `jira_display_name` is useful for dashboards, but it is not a stable key.
- `github_login`, `jira_account_id`, and `jira_display_name` can be left empty in the first pass when they have not been mapped yet.
- `source_record_ids` keeps traceability back to the source roster rows when duplicate people need to be merged.
- The sync validates duplicate `github_login`, duplicate `jira_account_id`, and unknown `team_key`.

To publish the directory into Elasticsearch:

```bash
npm run team-directory:sync
```

This replaces the contents of these dedicated indices:

- `jstats-directory-team`
- `jstats-directory-member`
- `jstats-contributor-summary` is derived separately from the team directory
  and GitHub activity so ranked contributor charts can include active members
  with zero activity.

If your host cannot resolve the Docker-only Elasticsearch hostname from `.env`, override it:

```bash
ELASTIC_ENDPOINT=https://localhost ELASTIC_PORT=9200 npm run team-directory:sync
```

To refresh the contributor activity summary after GitHub data changes:

```bash
npm run contributor-summary:sync
```

## GitHub archived repository cleanup
Remove Elasticsearch documents and local state entries for repositories that are now archived in GitHub:

```bash
npm run github:cleanup-archived-repos
```

Optional:

- `ARCHIVED_REPO_CLEANUP_DRY_RUN=true` to report counts without deleting anything

The cleanup targets these indices:

- `jstats-repository`
- `jstats-teams`
- `jstats-pullrequest`
- `jstats-review`
- `jstats-comment`

## Jira issue sync
Fetch Jira issues within the configured project scope and index them into Elasticsearch:

```bash
npm run jira:sync-issues
```

Optional:

- `JIRA_ISSUE_SYNC_MAX_RESULTS` (default `100`)
- `JIRA_SYNC_PAGE_SIZE` (default `100`)
- `JIRA_SYNC_YEAR` to restrict issue selection to issues updated in a given year, for example `2026`
- `JIRA_SYNC_RESUME` (default `true`) to resume from the last saved Jira sync checkpoint after a crash

## Jira event sync
Fetch Jira issue changelogs and index separate `created`, `updated`, and `completed` events into Elasticsearch:

```bash
npm run jira:sync-events
```

Current event semantics:

- `created`: one event per issue from `fields.created`
- `updated`: one event per changelog history entry that changes non-completion fields or moves between non-done statuses
- `completed`: one event per changelog history entry that moves the issue into a Jira status whose category is `done`

Optional:

- `JIRA_EVENT_SYNC_MAX_ISSUES` (default `20`)
- `JIRA_EVENT_SYNC_CONCURRENCY` (default `4`)
- `JIRA_SYNC_PAGE_SIZE` (default `100`)
- `JIRA_SYNC_YEAR` to restrict candidate issues to those updated in a given year and to index only events whose `event_timestamp` falls within that year
- `JIRA_SYNC_RESUME` (default `true`) to resume from the last saved Jira sync checkpoint after a crash

## Organization-specific config
Organization-specific values should live in `.env`, not in code or committed docs.

Example:

```bash
ORGANIZATION=your-github-org
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_JQL=
JIRA_PROJECT_KEYS=
```

## Notes
- Saved objects include the `Teamwork` and `Jira Teamwork` dashboards with their related Lens visualizations/index patterns.
- Saved objects also include the `Team Directory` dashboard backed by `jstats-directory-member*`.
- Ingestion persists a local pull `updated_at` watermark per repository in `.jstats-state.json` to avoid reprocessing unchanged pull requests on subsequent runs.
- Jira issue and event syncs persist crash-recovery checkpoints in `.jstats-state.json`; completed runs clear their checkpoints.
- Jira search pagination uses Jira `nextPageToken` cursors, not numeric offsets.
- Ingestion skips pull updates older than `MIN_PULL_UPDATED_AT` (defaults to the start of 2025).
- Ingestion prints a progress bar while indexing (`indexed/planned` documents).
- Jira tracking scope is documented in [docs/jira-tracking-plan.md](/Users/jeremy/Repos/experiments/JStats/docs/jira-tracking-plan.md).
