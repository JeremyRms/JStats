# JStats

JStats ingests GitHub organization data and stores it in Elasticsearch for Kibana dashboards that track pull requests, reviews, and review comments.

## What this repo currently contains
- Ingestion service: `app.js`
- Local Elastic/Kibana Docker setup: `elastic-docker-tls.yml`, `create-certs.yml`, `jstats.yml`
- Bootstrap helper: `bootstrap.sh`
- Shared team/member directory: `config/team-directory.json`
- Versioned Kibana saved objects:
  - `dashboards/teamwork.ndjson`
  - `dashboards/jira-teamwork.ndjson`

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

```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh import dashboards/jira-teamwork.ndjson
```

### Optional environment variables
- `KIBANA_URL` (default `https://localhost:5601`)
- `KIBANA_USERNAME` (default `elastic`)
- `KIBANA_SPACE` (default `default`)
- `KIBANA_INSECURE_TLS` (default `true`)
- `ORGANIZATION` (GitHub organization to ingest)
- `JIRA_BASE_URL` (example `https://your-org.atlassian.net`)
- `JIRA_EMAIL`
- `JIRA_JQL`
- `JIRA_PROJECT_KEYS` (comma-separated Jira project keys to track)
- `TEAM_DIRECTORY_FILE` (default `config/team-directory.json`)
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
      "full_name": "Example Person",
      "nickname": "Example",
      "github_login": "example-gh",
      "jira_account_id": "jira-account-id",
      "jira_display_name": "Example Person",
      "active": true
    }
  ]
}
```

Notes:

- `jira_account_id` should be treated as the canonical Jira identity in Jira Cloud.
- `jira_display_name` is useful for dashboards, but it is not a stable key.
- The sync validates duplicate `github_login`, duplicate `jira_account_id`, and unknown `team_key`.

To publish the directory into Elasticsearch:

```bash
npm run team-directory:sync
```

This replaces the contents of these dedicated indices:

- `jstats-directory-team`
- `jstats-directory-member`

If your host cannot resolve the Docker-only Elasticsearch hostname from `.env`, override it:

```bash
ELASTIC_ENDPOINT=https://localhost ELASTIC_PORT=9200 npm run team-directory:sync
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
- Ingestion persists a local pull `updated_at` watermark per repository in `.jstats-state.json` to avoid reprocessing unchanged pull requests on subsequent runs.
- Jira issue and event syncs persist crash-recovery checkpoints in `.jstats-state.json`; completed runs clear their checkpoints.
- Jira search pagination uses Jira `nextPageToken` cursors, not numeric offsets.
- Ingestion skips pull updates older than `MIN_PULL_UPDATED_AT` (defaults to the start of 2025).
- Ingestion prints a progress bar while indexing (`indexed/planned` documents).
- Jira tracking scope is documented in [docs/jira-tracking-plan.md](/Users/jeremy/Repos/experiments/JStats/docs/jira-tracking-plan.md).
