# Release Process Metrics: handover to JStats

Purpose: define the metrics that make the new release process (see the engineering "Release Process: Continuous Integration Behind Feature Flags" standard) observable, and map them to what JStats already ingests versus what needs to be added. JStats is the system of record for these metrics; Kibana is where the team and the release committee read them.

Why metrics at all: the release process is a Theory of Constraints move. QA and review are the constraint. We can only claim the constraint is easing if we can see it. These metrics are how we prove the process works, release over release, instead of arguing about it.

## The metrics

Direction "down" means smaller or faster is healthier.

| Metric | Why it matters | Direction | Source | Status in JStats |
| --- | --- | --- | --- | --- |
| PR size (additions + deletions, changed files) | Small PRs are the core CI signal and the direct counter to the 30k-LOC problem | down | `jstats-pullrequest.pr_size` / `.pr_changed_files` (computed at ingest from `diff`) | Done, charted on Release health |
| PRs over size threshold (count per week) | Catches big-batch merges as they happen, not after | down | derived from `pr_size` | Done, charted on Release health (provisional threshold 1000 lines) |
| Time to first review | Review latency is the AI-era bottleneck; long waits mean the constraint is tightening | down | `jstats-pullrequest.first_review_latency_seconds` / `_hours` (first non-author review) | Done, charted on Release health |
| Merge lead time | How long a change waits to integrate | down | `jstats-pullrequest.merge_lead_time_seconds` / `pr_time_to_merge_days` | Done, charted on Release health |
| Deployment frequency | Are we actually shipping in small increments | up | deployment or release events | Gap, no deployment data today |
| Lead time for changes (commit to prod) | End-to-end delivery speed (a DORA key) | down | merge time (have) + prod deploy time (gap) | Partial |
| Change failure rate | Are small merges reducing bad releases (a DORA key) | down | deployment events + failure signal (rollback, hotfix, incident) | Gap |
| Time to restore (MTTR) | With flags, rollback should be near-instant (a DORA key) | down | failure event to resolution event | Gap |
| QA cycle time per release | The constraint we are trying to relieve; should fall as automation grows | down | `jstats-jira-qa-cycle` (first QA entry to first QA exit from changelog, fixVersions attached) | Done, charted on QA load; cycle time, not effort |
| Contract test present on boundary-changing PRs | Enforces the one mandatory automated gate | up (toward 100%) | `jstats-pullrequest.contract_test_check_present` / `_passed` (check-runs) | Ingestion implemented, off by default (`INGEST_CHECK_RUNS=true` + `CONTRACT_TEST_CHECK_PATTERN`); needs a boundary-change definition before charting |
| Flag debt (open flags and their age) | Flags that never get cleaned up become their own risk | down | feature-flag provider API | Gap, optional |

The four DORA keys (deployment frequency, lead time for changes, change failure rate, time to restore) are the industry-standard delivery set and are deliberately included; three of the four depend on the deployment-events gap below.

## What JStats already gives us

- Indices today: `jstats-pullrequest`, `jstats-review`, `jstats-comment`, `jstats-repository`, `jstats-member`, `jstats-teams`, plus Jira issue and event documents.
- Each `jstats-pullrequest` document carries the full `pulls.get` payload under `diff`, so `additions`, `deletions`, and `changed_files` are present (see `app.js` around line 349). PR size needs only a Kibana runtime field, not new ingestion.
- Reviews carry `submitted_at`, so time-to-first-review and merge lead time are computable from data we already store.
- Jira ingestion already tracks BROK and models status transitions and completion (see `docs/jira-tracking-plan.md`), which is the foundation for QA cycle time.

## Improvements to JStats, in priority order

1. **Deployment and release events (biggest gap, unlocks three DORA keys).** Add a `jstats-deployment` index and ingest one event per service per environment deploy. Candidate sources: GitHub Deployments API, GitHub Releases, or the Cloud Build results already wired through `cloudbuild.yaml`. Mark failures using rollback (flag-off), hotfix PRs, or linked incident tickets. This enables deployment frequency, change failure rate, lead time to prod, and MTTR. *Status 2026-08-11: still open, blocked on source access. The current GitHub token cannot read the Deployments API (403, fine-grained PAT without the deployments permission), and sampled active repos have zero GitHub Releases, so the practical candidates are Cloud Build (needs GCP access wiring) or granting the PAT deployments read and confirming teams actually create GitHub Deployments.*
2. **Computed fields for PR health.** Done. Implemented at ingestion (`enrichPullRequestMetrics` in `src/document-enrichment.js`) rather than as Kibana runtime fields, because `first_review_latency` joins the PR with its reviews and a runtime field cannot cross documents. Fields: `pr_size`, `pr_changed_files`, `merge_lead_time_seconds`, `pr_time_to_merge_days`, `first_review_submitted_at`, `first_review_latency_seconds`, `first_review_latency_hours`. First review means first non-author review. `npm run github:backfill-pr-metrics` backfills the fields onto already-indexed documents.
3. **QA cycle modeling from Jira changelog.** Done. `npm run jira:sync-qa-cycles` emits one document per issue into `jstats-jira-qa-cycle` (first transition into a QA status to the first transition out), with `fix_versions`, story points, assignee, and `qa_open` for cycles still running. QA status names are matched case-insensitively and are configurable via `JIRA_QA_STATUSES` (default: In QA, QA, Testing) because the Jira instance has several QA status spellings. This is cycle time, not effort.
4. **GitHub check-runs / statuses per PR.** Ingestion implemented in `app.js` behind `INGEST_CHECK_RUNS=true` (off by default; one extra API call per PR). Stores a `check_runs` summary plus `contract_test_check_present` / `contract_test_check_passed` when `CONTRACT_TEST_CHECK_PATTERN` (case-insensitive regex on check name) is set. Charting still needs the contract-test check name and a definition of boundary-changing PRs.
5. **Feature-flag inventory (optional).** Open, needs API access to whichever flag system the team standardises on.

## Dashboards to add

Follow the existing dashboard-as-code pattern in `dashboards/*.ndjson`:

- **Release health** (`dashboards/release-health.ndjson`, added): median PR size trend, PRs over threshold per week (provisional threshold 1000 lines), median time to first review, median merge lead time. Deployment frequency and change failure rate join once improvement 1 lands.
- **QA load** (`dashboards/qa-load.ndjson`, added): median QA cycle per week, QA cycle by release (fixVersion), and open QA count. The manual-QA trend needs the worklog decision below.

## Open items and assumptions

- Decide the deployment-event source (GitHub Deployments vs Cloud Build) before starting improvement 1.
- QA hours: confirm whether QA logs worklogs; if not, we report cycle time and label it as such.
- Flag-debt tracking (improvement 5) needs API access to whichever flag system the team standardises on.
- Thresholds (what counts as an oversized PR, target lead times) come from the release process "Parameters to calibrate" and should be set once, then referenced here.

## How each metric is calculated

This section states the exact rule behind each metric, so a reader can trust
the number without reading the code.

### Pull request metrics

The ingester computes these fields on each pull request document. The code is
in `src/document-enrichment.js`, function `enrichPullRequestMetrics`.

- `pr_size` is `diff.additions` plus `diff.deletions`. It counts changed lines,
  not files. `pr_changed_files` holds the file count on its own.
- `merge_lead_time_seconds` is the time from `created_at` to `merged_at`.
  `pr_time_to_merge_days` is the same value in days. Both are empty for a pull
  request that never merged.
- `first_review_latency_seconds` is the time from `created_at` to the first
  review by a person other than the author. Reviews by the author do not count,
  because a self review is not a peer review. `first_review_latency_hours` is
  the same value in hours.

The Release health dashboard reads these fields:

- Median PR size per week takes the median `pr_size` of pull requests created
  in each week.
- PRs over the size threshold counts pull requests created in each week whose
  `pr_size` is 1000 or more. The threshold of 1000 lines is provisional. Set
  the real value once the release process parameters are agreed.
- Median time to first review takes the median `first_review_latency_hours` by
  pull request creation week.
- Median merge lead time takes the median `pr_time_to_merge_days` by merge week.

### QA cycle and rework metrics

The QA cycle sync computes these fields per issue. The code is in
`src/jira-qa-cycle-document.js`. It reads the issue changelog, orders the status
transitions oldest first, and walks them once.

Statuses fall into four groups, all matched without case sensitivity:

- QA statuses, from `JIRA_QA_STATUSES`, cover the QA queue and active QA.
- Forward statuses, from `JIRA_QA_FORWARD_STATUSES`, mean QA accepted the work
  or the work shipped.
- Cancelled statuses, from `JIRA_QA_CANCELLED_STATUSES`, mean the work was
  dropped.
- Any other status is a development status.

The walk produces these fields:

- `qa_started_at` is the first time the issue moved into a QA status.
- `qa_ended_at` is the first time it moved from QA to a forward or cancelled
  status. `qa_end_status` is that status.
- `qa_cycle_seconds` and `qa_cycle_days` measure from `qa_started_at` to
  `qa_ended_at`. This is calendar time from the first handover into QA to the
  moment QA accepted the work, so a cycle that bounced spans all of its QA time.
- `qa_entries` counts how many times the issue moved into QA.
- `qa_bounces` counts how many times the issue moved from QA to a development
  status. Each of these is one rework loop.
- `qa_bounced` is true when `qa_bounces` is one or more.
- `qa_open` is true when the issue entered QA and has no forward or cancelled
  exit yet.

The QA load dashboard reads these fields:

- Issues bounced by QA counts documents where `qa_bounced` is true. This counts
  issues, so an issue that bounced twice is counted once.
- The total number of rework loops is the sum of `qa_bounces`. It is larger
  than the issue count when issues bounce more than once.
- The rework rate is the count of issues where `qa_bounced` is true, divided by
  the number of issues that reached QA.
- QA exit status mix groups the completed cycles by `qa_end_status`.

Note on definitions. Counting issues answers "how many issues got sent back".
Summing `qa_bounces` answers "how many times work got sent back". The second
number is always the same or larger. Pick one and state which when you report
it.

### Stale work metrics

The Stale work dashboard reads the pull request and Jira issue indexes
directly. It defines stale as no update for 14 days or more.

- Stale open pull requests are pull requests where `state` is open, `draft` is
  not true, and `updated_at` is 14 days ago or older.
- Stale in-progress issues are issues where the status category is
  `indeterminate`, which is the Jira category for in-progress work, and
  `updated_at` is 14 days ago or older.

These counts read the index, not GitHub or Jira live. An index that is days out
of date makes every document look stale, so the numbers are only correct
straight after a sync.
