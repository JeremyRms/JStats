# JStats Modernization Review (2026-03-10)

## 1. Executive summary

### Overall health
- The service is small and understandable but currently fragile: one large script (`app.js`) performs full-scan ingestion and indexing.
- Core functionality works for basic volume dashboards, but data contracts and metric semantics are underdefined for fairness-sensitive reporting.

### Biggest technical risks
1. No incremental sync state; each run does full-history scans across repos/PRs.
2. No explicit Elasticsearch mappings/templates/ILM; dashboard behavior depends on dynamic mappings.
3. No ingestion error isolation or run audit log.
4. No automated tests around ingest semantics (only newly added helper unit tests).
5. Legacy dependency/runtime baseline (Elastic 7.14 stack, older SDKs).

### Biggest data-quality/reporting risks
1. Review-event counts can over-credit repeated reviews by the same person on one PR.
2. Bot filtering is inconsistent across visualizations.
3. No canonical metric definitions (what counts as PR/review contribution).
4. Volume-only metrics can be gamed (small PRs, lightweight comments).
5. Repository scope incompleteness can bias fairness conclusions.

### Top 5 recommended actions
1. Add explicit metric contract docs and dashboard labels for fairness caveats.
2. Implement incremental sync checkpoints (`updated_at` watermark + backfill mode).
3. Add index templates/mappings for key dashboard fields and timestamps.
4. Standardize bot/service-account exclusion via dedicated field (`actor_is_bot`) instead of ad hoc login filters.
5. Upgrade dependencies in phases, beginning with compatibility-safe steps.

## 2. Architecture review

### Main modules
- `app.js`: ingestion orchestration, transforms, ES writes, health endpoint.
- `src/document-enrichment.js`: ingestion metadata helper (added in this review).
- `bootstrap.sh`: local stack bootstrap and runtime orchestration.
- `elastic-docker-tls.yml`, `create-certs.yml`, `jstats.yml`: local infrastructure definitions.
- `dashboards/teamwork.ndjson`: versioned Kibana saved objects.

### Current data flow: GitHub -> ingest/transform -> Elasticsearch -> Kibana
1. Authenticate GitHub client.
2. Fetch org members -> `jstats-member`.
3. Fetch repos -> `jstats-repository`.
4. Fetch repo teams -> `jstats-teams`.
5. Fetch PR list + PR details -> `jstats-pullrequest`.
6. Fetch PR reviews -> `jstats-review`.
7. Fetch PR review comments -> `jstats-comment`.
8. Kibana dashboard `Teamwork` aggregates records via lens formulas/counts.

### Runtime dependencies
- Node.js app with Octokit + throttling plugin + Elastic client.
- Elasticsearch + Kibana via Docker.
- `curl` for dashboard saved-object import/export automation.

### External services
- GitHub REST API
- Elasticsearch HTTP API
- Kibana Saved Objects API

### Where transformations/aggregations happen
- Transformations happen at ingest-time in `clean*` functions and enrichment helper.
- Aggregations happen in Kibana Lens formulas and terms/date-histogram operations.

### Ingest-time modeling impact on dashboard semantics
- High impact: deleting fields, preserving IDs, and distinguishing review vs comment docs directly changes metric meaning in Lens.
- Dashboard semantics currently rely on source fields like `id`, `pull_request_url.keyword`, `pull_request_review_id`, `user.login.keyword`.

## 3. Dependency upgrade plan

Versions below were validated from local `npm ls` and npm registry on 2026-03-10.

| dependency | current version | target version | reason to upgrade | breaking-change risk | migration notes | recommended phase |
|---|---:|---:|---|---|---|---|
| `@elastic/elasticsearch` | `7.13.0` | `8.19.1` (then `9.3.4` long-term) | client/runtime is legacy; newer clients improve API compatibility and security posture | high | upgrade Elastic stack first to 8.x-compatible APIs, then client; 9.x only after full compatibility validation | phase 2 |
| `octokit` | `1.0.6` | `5.0.5` | major SDK improvements and long-term support | high | audit REST API call signatures and plugin compatibility | phase 2 |
| `@octokit/plugin-throttling` | `3.5.2` | `11.0.3` | current plugin is old; rate-limit handling path should align with modern Octokit | high | upgrade with Octokit together and retest callbacks/retry behavior | phase 2 |
| `dotenv` | `10.0.0` | `17.3.1` | security/maintenance updates | low | verify parsing behavior with existing `.env` conventions | phase 1 |
| `nodemon` (dev) | `2.0.7` | `3.1.14` | maintenance update | low | dev-only impact | phase 1 |
| Elastic/Kibana Docker stack (`VERSION` in bootstrap) | `7.14.0` | `8.19.1` | stack currently very old, impacts client and saved object compatibility | high | run saved-object migration in Kibana, update compose env variables as needed | phase 2 |
| Cloud Build image `docker/compose` | `1.26.2` | Compose v2 (current) | v1 is legacy and misses modern behavior/fixes | medium | update cloudbuild step to modern docker compose invocation | phase 1 |

Recommended upgrade order:
1. dev tooling (`dotenv`, `nodemon`, compose step)
2. Elastic/Kibana stack to 8.x in staging + dashboard migration
3. ES client upgrade
4. Octokit + throttling plugin upgrade with regression tests
5. Evaluate ES client 9.x only after system is stable on 8.x

## 4. Metrics and dashboard suitability review

### Does current data model support dashboard goals?
- Partially. It supports counting PRs/reviews/comments by actor and time.
- It does not fully support fair collaboration assessment without additional constraints and metric definitions.

### Misleading/incomplete metric risks
- "Raised PRs" likely equals count of PR documents, regardless of PR size/impact.
- "Reviews" counts review events, not reviewer effort or uniqueness per PR/reviewer.
- Review comments and formal review submissions are separate streams; consumers can misread overlap.
- Self-review exclusion is not explicit in saved objects.
- Bot exclusion is inconsistent and mostly login-based.
- Time-window consistency depends on dashboard-level/global filters, not enforced at ingest.

### Recommended metric definition improvements
1. Define `raised_pr` as unique PR (`repo + number`) with actor constraints (exclude bots/service accounts).
2. Track two review metrics:
- `review_events_total`
- `review_unique_reviewer_per_pr` (deduplicated by reviewer+PR)
3. Separate comment-only collaboration from formal review decisions.
4. Add quality-context dimensions:
- PR size buckets (`additions + deletions`)
- merged vs closed-unmerged
- turnaround time (created -> first review)
5. Add coverage denominator metrics:
- per-repo tracked population
- % activity from untracked repos (if data source extended)

## 5. Dashboard-as-code assessment

### Current status
- Yes, dashboards are now managed as code with versioned artifact and automation.

### Current approach
- Canonical saved object file: `dashboards/teamwork.ndjson`
- Automation script: `scripts/kibana-saved-objects.sh` (`import`/`export`)
- Usage documented in `README.md`

### Previous gaps (before this review)
- Saved object file existed, but no operationalized import/export workflow.
- Bootstrap had only commented manual curl with placeholder credentials.

### Implemented approach in this review
- Moved saved objects into dedicated `dashboards/` path.
- Added reusable import/export script using Kibana Saved Objects API.
- Updated docs and bootstrap reference comment to use scripted flow.

### Files added/updated
- `dashboards/teamwork.ndjson`
- `scripts/kibana-saved-objects.sh`
- `README.md`
- `bootstrap.sh`

## 6. Improvement recommendations

### Quick wins (1-3 days)
1. Add metric contract documentation next to dashboard artifacts.
2. Standardize dashboard bot filter to use `actor_is_bot:false` where available.
3. Add ingest-run summary log with totals and failures per entity type.
4. Add explicit index template for `@timestamp`-like fields and key keywords.

### Short-term improvements (1-2 weeks)
1. Implement incremental sync checkpoints per repo/entity using `updated_at`.
2. Introduce bulk indexing with bounded retries and partial-failure reporting.
3. Split `app.js` into modules (GitHub client, transformers, ES writer, run coordinator).
4. Add integration tests for deduplication and attribution semantics.

### Larger refactors (2+ weeks)
1. Build durable ingestion state store + backfill orchestration.
2. Introduce ingest audit index for traceability and replay.
3. Redesign collaboration metrics toward balanced scorecards (volume + quality + coverage).
4. Migrate fully to modern Elastic stack/client major versions.

## 7. Proposed implementation roadmap

### Phase 1: safest immediate actions
- Dashboard-as-code automation (completed).
- Ingestion metadata enrichment and bot marker field (completed).
- Review tally correctness fix (completed).
- Baseline review docs and risk register (completed).

### Phase 2: dependency modernization
- Upgrade low-risk tooling first.
- Upgrade Elastic/Kibana stack in staging.
- Upgrade ES client and Octokit stack with regression suite.

### Phase 3: data model and structural improvements
- Add explicit mappings/templates.
- Add incremental sync state and backfill mode.
- Add run-audit logging and error accounting.

### Phase 4: dashboard-as-code hardening
- Add CI check that validates NDJSON export exists and is parseable.
- Add repeatable promotion workflow (dev -> staging -> prod exports/imports).
- Version metric contracts alongside saved objects.

## 8. Open questions and assumptions

### Assumptions made
- This repo is the authoritative ingestion service for current dashboards.
- `Teamwork` dashboard in saved objects is representative of production intent.
- Fairness reporting is consumed for organizational decision-making (high consequence).

### Unknowns not confirmable from repo alone
- Production scheduler and run frequency.
- Production Elastic/Kibana versions.
- Additional dashboards created manually outside exported artifact.
- Full set of bot/service identities that should be excluded.
- Whether private forks/cross-repo PR patterns are expected in policy.

### Kibana inspection points required in live environment
1. Validate global and panel-level filters for bots/self-review exclusions.
2. Validate time-window defaults and timezone behavior.
3. Validate whether any production-only runtime fields or scripted fields exist.
4. Validate dashboard copy/text explains metric limitations.

## Commit-by-commit progress (this review)
1. `docs: add initial architecture and risk assessment`
2. `feat: add reproducible kibana saved object workflow`
3. `fix: enrich ingestion documents and correct review tally`
4. `fix: correct tls ca path and normalize env template`
