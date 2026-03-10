# JStats Initial Assessment (2026-03-10)

## Scope and method
This assessment is based on repository inspection only (no live GitHub, Elasticsearch, or Kibana environment access).

## Confirmed architecture

### Runtime modules
- `app.js` is the only application module and entrypoint.
- `bootstrap.sh` provisions local Elastic/Kibana containers and runs the app container.
- `elastic-docker-tls.yml`, `create-certs.yml`, and `jstats.yml` define local runtime.
- `export.ndjson` contains Kibana saved objects (dashboard, lenses, index patterns).

### Data flow (confirmed)
1. App starts and authenticates to GitHub (`octokit.rest.users.getAuthenticated`).
2. App fetches org members (`orgs.listMembers`) and indexes into `jstats-member`.
3. App fetches org repos (`repos.listForOrg`) and indexes into `jstats-repository`.
4. For each repo, app fetches teams (`repos.listTeams`) and indexes into `jstats-teams`.
5. For each repo, app fetches PRs (`pulls.list`) and indexes into `jstats-pullrequest`.
6. For each PR, app fetches PR details (`pulls.get`) and stores as `pullRequest.diff`.
7. For each PR, app fetches reviews (`pulls.listReviews`) and indexes into `jstats-review`.
8. For each PR, app fetches review comments (`pulls.listReviewComments`) and indexes into `jstats-comment`.
9. Kibana dashboards query `jstats-*` index patterns over those indexed documents.

### External services
- GitHub REST API via `octokit`.
- Elasticsearch via `@elastic/elasticsearch` client.
- Kibana via manual saved object import/export.

## Confirmed implementation characteristics

### GitHub ingestion behavior
- Uses pagination via `octokit.paginate` for members/repos/teams/PRs/reviews/comments.
- Performs full scans for all repos and all PR states on each run (`state: "all"`, no `since` watermark).
- No backfill checkpoint or incremental sync state persisted.
- No explicit handling for renamed repos/users, archived repos, forks, or cross-org PR semantics.

### Elasticsearch modeling and write behavior
- Writes direct to fixed indices: `jstats-member`, `jstats-repository`, `jstats-teams`, `jstats-pullrequest`, `jstats-review`, `jstats-comment`.
- No index templates, explicit mappings, aliases, rollover, or ILM in repo.
- Uses `index` with document IDs from GitHub IDs (helps idempotency per source entity ID).
- No bulk indexing; one HTTP request per document.
- No write retry/backoff around Elasticsearch writes.

### Scheduling and operations
- No internal scheduler in app.
- App appears intended to run as a container process; periodic execution strategy is not defined in repo.
- Health endpoint is HTTP server returning 200, but ingestion runs at startup and can fail before/after it.

### Observability
- Console-only logging.
- No structured logs, metrics, tracing, or ingest audit records.
- Counters exist but one is reset per PR loop (`reviewCount = 0` in PR loop), so final reported totals are unreliable.

### Test posture
- No automated tests.
- No CI validation for ingestion correctness or metric semantics.

## Kibana dashboard-as-code status

### Current state (confirmed)
- Saved objects are versioned in repo (`export.ndjson`, 22 lines/objects including 1 dashboard, 13 lens visualizations, 5 index patterns).
- Bootstrap contains a commented dashboard import curl command with static credentials placeholder.
- No maintained script/workflow for consistent export/import lifecycle.

### Conclusion
- Dashboards are partially "as code" (artifact exists), but provisioning and update workflow are not operationalized.

## Metric and fairness risks (confirmed from code + saved objects)

1. Review volume counting risk:
- Dashboard formulas include `unique_count(id)` on review docs and ratios like `unique_count(id)/unique_count(pull_request_url.keyword)`.
- Multiple reviews by one person on the same PR are counted as multiple review events, which can inflate contribution counts.

2. Bot filtering inconsistency:
- Several visualizations filter `github-actions[bot]`; one filters `dependabot[bot]`; some have no bot filter.
- This yields inconsistent contributor comparisons across panels.

3. Semantic mismatch risk:
- Ingested review comments and formal reviews are separate document types, but dashboard naming can imply "reviews" broadly.
- Without explicit metric contracts, consumers may compare non-equivalent measures.

4. No quality weighting:
- Metrics are volume-centric (count, unique count ratios).
- No adjustment for PR size, review depth, or review outcome.

5. Scope bias:
- Only tracked organization/repos contribute; collaboration outside this scope is invisible.

## Security and reliability risks

1. TLS configuration concern:
- Elasticsearch client `ssl.ca` points to `/certs/es01/es01.key` (private key path), not CA cert path.
- `rejectUnauthorized: false` disables cert verification.

2. Secrets handling:
- Bootstrap writes generated credentials to `~/.elk/elastic-stack` and `.env`.
- No documented rotation or least-privilege token policy.

3. Error handling gaps:
- GitHub API throttling callbacks are configured.
- No comprehensive try/catch strategy for long-running ingest loops.
- No dead-letter/error reporting for failed entity writes.

## Dependency baseline (installed)
- `@elastic/elasticsearch@7.13.0`
- `octokit@1.0.6`
- `@octokit/plugin-throttling@3.5.2`
- `dotenv@10.0.0`
- `nodemon@2.0.7` (dev)

## Incremental, low-risk implementation plan

### Phase A (safe immediate)
1. Add dashboard import/export scripts and document reproducible dashboard-as-code workflow.
2. Keep saved object artifact in version control under a dedicated dashboards path.
3. Update bootstrap/docs to call managed import path (remove manual commented command reliance).

### Phase B (safe correctness)
1. Fix incorrect `reviewCount` tally reset behavior.
2. Add deterministic enrichment fields for attribution (`organization`, `repository`, ingest timestamp).
3. Preserve/add normalized actor classification field (`is_bot`) to reduce login-string bot filtering.
4. Add minimal unit tests for normalization/enrichment helpers.

### Phase C (controlled modernization)
1. Isolate GitHub client and Elasticsearch writer modules.
2. Add explicit index templates/mappings for key fields used by dashboards.
3. Add incremental sync checkpoint strategy (`updated_at` watermark + backfill mode).
4. Add ingest run audit index and structured logs.

### Phase D (dependency upgrades)
1. Upgrade Octokit stack with compatibility tests.
2. Upgrade Elasticsearch client and align with target Elastic/Kibana stack version.
3. Upgrade runtime/development dependencies with lockfile refresh.

## Unknowns requiring environment validation
- Actual production scheduling mechanism and run cadence.
- Whether Kibana dashboard filters/time windows are modified outside `export.ndjson`.
- Whether service-account/bot accounts beyond `github-actions[bot]` and `dependabot[bot]` are present.
- Elasticsearch cluster version in production and compatibility constraints.
- Expected fairness policy from leadership/HR for performance interpretation.
