import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichDocument,
  enrichPullRequestCheckRuns,
  enrichPullRequestMetrics,
} from "../src/document-enrichment.js";

test("enrichDocument adds ingestion context fields", () => {
  const doc = { id: 1, user: { login: "alice", type: "User" } };

  enrichDocument(doc, {
    organization: "example-org",
    repository: "service-a",
    entityType: "review",
    pullRequestId: 10,
    pullRequestNumber: 7,
  });

  assert.equal(doc.organization, "example-org");
  assert.equal(doc.repository, "service-a");
  assert.equal(doc.entity_type, "review");
  assert.equal(doc.pull_request_id, 10);
  assert.equal(doc.pull_request_number, 7);
  assert.equal(doc.actor_is_bot, false);
  assert.ok(Number.isFinite(Date.parse(doc.ingested_at)));
});

test("enrichDocument marks bot actors", () => {
  const doc = { id: 2, user: { login: "automation", type: "Bot" } };

  enrichDocument(doc, { entityType: "comment" });

  assert.equal(doc.actor_is_bot, true);
});

test("enrichDocument handles documents without user", () => {
  const doc = { id: 3 };

  enrichDocument(doc, { entityType: "repository" });

  assert.equal(doc.entity_type, "repository");
  assert.equal(doc.actor_is_bot, undefined);
  assert.ok(Number.isFinite(Date.parse(doc.ingested_at)));
});

test("enrichPullRequestMetrics computes size and lead time fields", () => {
  const doc = {
    id: 3,
    user: { id: 100 },
    created_at: "2026-01-01T00:00:00Z",
    merged_at: "2026-01-03T00:00:00Z",
    diff: { additions: 120, deletions: 30, changed_files: 6 },
  };

  enrichPullRequestMetrics(doc, [
    { user: { id: 100 }, submitted_at: "2026-01-01T01:00:00Z" },
    { user: { id: 200 }, submitted_at: "2026-01-02T00:00:00Z" },
    { user: { id: 300 }, submitted_at: "2026-01-01T06:00:00Z" },
  ]);

  assert.equal(doc.pr_size, 150);
  assert.equal(doc.pr_changed_files, 6);
  assert.equal(doc.merge_lead_time_seconds, 2 * 24 * 3600);
  assert.equal(doc.first_review_submitted_at, "2026-01-01T06:00:00.000Z");
  assert.equal(doc.first_review_latency_seconds, 6 * 3600);
});

test("enrichPullRequestMetrics skips fields when inputs are missing", () => {
  const doc = {
    id: 4,
    user: { id: 100 },
    created_at: "2026-01-01T00:00:00Z",
    merged_at: null,
  };

  enrichPullRequestMetrics(doc, [
    { user: { id: 100 }, submitted_at: "2026-01-01T01:00:00Z" },
  ]);

  assert.equal(doc.pr_size, undefined);
  assert.equal(doc.merge_lead_time_seconds, undefined);
  assert.equal(doc.first_review_submitted_at, undefined);
  assert.equal(doc.first_review_latency_seconds, undefined);
});

test("enrichPullRequestCheckRuns summarises runs and contract test presence", () => {
  const doc = { id: 5 };

  enrichPullRequestCheckRuns(
    doc,
    [
      { name: "unit-tests", status: "completed", conclusion: "success" },
      {
        name: "contract-tests-orders",
        status: "completed",
        conclusion: "success",
        completed_at: "2026-01-01T00:10:00Z",
      },
    ],
    "^contract-tests"
  );

  assert.equal(doc.check_run_count, 2);
  assert.equal(doc.check_runs.length, 2);
  assert.equal(doc.contract_test_check_present, true);
  assert.equal(doc.contract_test_check_passed, true);
});

test("enrichPullRequestCheckRuns reports missing contract test", () => {
  const doc = { id: 6 };

  enrichPullRequestCheckRuns(
    doc,
    [{ name: "lint", status: "completed", conclusion: "failure" }],
    "^contract-tests"
  );

  assert.equal(doc.contract_test_check_present, false);
  assert.equal(doc.contract_test_check_passed, false);
});

test("enrichPullRequestMetrics adds day and hour unit fields", () => {
  const doc = {
    id: 7,
    user: { id: 100 },
    created_at: "2026-01-01T00:00:00Z",
    merged_at: "2026-01-02T12:00:00Z",
  };

  enrichPullRequestMetrics(doc, [
    { user: { id: 200 }, submitted_at: "2026-01-01T06:00:00Z" },
  ]);

  assert.equal(doc.pr_time_to_merge_days, 1.5);
  assert.equal(doc.first_review_latency_hours, 6);
});
