import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQaCycleDocument,
  resolveQaStatuses,
} from "../src/jira-qa-cycle-document.js";

const issue = {
  key: "BROK-1",
  id: "10001",
  fields: {
    summary: "Example issue",
    project: { key: "BROK" },
    issuetype: { name: "Story" },
    assignee: { displayName: "Example Person" },
    fixVersions: [{ name: "2026.07" }],
    customfield_10004: 3,
  },
};

function history(created, from, to) {
  return {
    created,
    items: [{ field: "status", fromString: from, toString: to }],
  };
}

test("resolveQaStatuses defaults are case-insensitive names", () => {
  const statuses = resolveQaStatuses({});
  assert.ok(statuses.has("in qa"));
  assert.ok(statuses.has("qa"));
  assert.ok(statuses.has("testing"));
});

test("resolveQaStatuses reads the env override", () => {
  const statuses = resolveQaStatuses({ JIRA_QA_STATUSES: "IN QA, Waiting QA" });
  assert.deepEqual([...statuses], ["in qa", "waiting qa"]);
});

test("buildQaCycleDocument captures first QA entry to first QA exit", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-01T00:00:00.000Z", "To Do", "In Progress"),
      history("2026-01-02T00:00:00.000Z", "In Progress", "IN QA"),
      history("2026-01-02T12:00:00.000Z", "IN QA", "Passed QA"),
      history("2026-01-03T00:00:00.000Z", "Passed QA", "Done"),
    ],
    resolveQaStatuses({}),
    { baseUrl: "https://example.atlassian.net" }
  );

  assert.equal(doc.issue_key, "BROK-1");
  assert.equal(doc.qa_started_at, "2026-01-02T00:00:00.000Z");
  assert.equal(doc.qa_ended_at, "2026-01-02T12:00:00.000Z");
  assert.equal(doc.qa_end_status, "Passed QA");
  assert.equal(doc.qa_cycle_seconds, 12 * 3600);
  assert.equal(doc.qa_open, false);
  assert.deepEqual(doc.fix_versions, ["2026.07"]);
  assert.equal(doc.url, "https://example.atlassian.net/browse/BROK-1");
});

test("buildQaCycleDocument marks unfinished QA as open", () => {
  const doc = buildQaCycleDocument(
    issue,
    [history("2026-01-02T00:00:00.000Z", "In Progress", "QA")],
    resolveQaStatuses({})
  );

  assert.equal(doc.qa_open, true);
  assert.equal(doc.qa_ended_at, null);
  assert.equal(doc.qa_cycle_seconds, null);
});

test("buildQaCycleDocument ignores QA-to-QA moves and unsorted histories", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-04T00:00:00.000Z", "Testing", "Done"),
      history("2026-01-02T00:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-03T00:00:00.000Z", "In QA", "Testing"),
    ],
    resolveQaStatuses({})
  );

  assert.equal(doc.qa_started_at, "2026-01-02T00:00:00.000Z");
  assert.equal(doc.qa_ended_at, "2026-01-04T00:00:00.000Z");
  assert.equal(doc.qa_end_status, "Done");
});

test("buildQaCycleDocument returns null when the issue never entered QA", () => {
  const doc = buildQaCycleDocument(
    issue,
    [history("2026-01-02T00:00:00.000Z", "To Do", "Done")],
    resolveQaStatuses({})
  );

  assert.equal(doc, null);
});
