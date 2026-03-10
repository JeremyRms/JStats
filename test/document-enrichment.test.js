import test from "node:test";
import assert from "node:assert/strict";

import { enrichDocument } from "../src/document-enrichment.js";

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
