import test from "node:test";
import assert from "node:assert/strict";

import {
  appendJqlClauses,
  isTimestampInWindow,
  resolveJiraSyncWindow,
  sortDocumentsByTimestampDesc,
} from "../src/jira-sync-window.js";

test("resolveJiraSyncWindow builds a year-based window", () => {
  assert.deepEqual(resolveJiraSyncWindow({ JIRA_SYNC_YEAR: "2026" }), {
    year: "2026",
    start: "2026-01-01",
    end: "2027-01-01",
    updatedJql: 'updated >= "2026-01-01" AND updated < "2027-01-01"',
  });
});

test("resolveJiraSyncWindow returns null when unset", () => {
  assert.equal(resolveJiraSyncWindow({}), null);
});

test("appendJqlClauses joins non-empty clauses", () => {
  assert.equal(
    appendJqlClauses('statusCategory != Done', 'updated >= "2026-01-01"'),
    'statusCategory != Done AND updated >= "2026-01-01"'
  );
});

test("isTimestampInWindow checks ISO timestamps against the year window", () => {
  const window = resolveJiraSyncWindow({ JIRA_SYNC_YEAR: "2026" });

  assert.equal(isTimestampInWindow("2026-03-18T12:00:00.000+0700", window), true);
  assert.equal(isTimestampInWindow("2025-12-31T23:59:59.000Z", window), false);
  assert.equal(isTimestampInWindow("2027-01-01T00:00:00.000Z", window), false);
});

test("sortDocumentsByTimestampDesc orders newest events first", () => {
  const sorted = sortDocumentsByTimestampDesc([
    { id: "1", event_timestamp: "2026-01-02T00:00:00.000Z" },
    { id: "2", event_timestamp: "2026-03-02T00:00:00.000Z" },
    { id: "3", event_timestamp: "2026-02-02T00:00:00.000Z" },
  ]);

  assert.deepEqual(
    sorted.map((document) => document.id),
    ["2", "3", "1"]
  );
});
