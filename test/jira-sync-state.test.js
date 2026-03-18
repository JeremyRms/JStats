import test from "node:test";
import assert from "node:assert/strict";

import {
  buildJiraSyncSignature,
  clearJiraSyncCheckpoint,
  getJiraSyncCheckpoint,
  setJiraSyncCheckpoint,
} from "../src/jira-sync-state.js";

test("buildJiraSyncSignature is stable for equivalent project key order", () => {
  const left = buildJiraSyncSignature({
    organization: "example",
    baseUrl: "https://example.atlassian.net",
    searchJql: 'updated >= "2026-01-01" ORDER BY updated DESC',
    projectKeys: ["ENG", "ARCH"],
    syncYear: "2026",
  });
  const right = buildJiraSyncSignature({
    organization: "example",
    baseUrl: "https://example.atlassian.net",
    searchJql: 'updated >= "2026-01-01" ORDER BY updated DESC',
    projectKeys: ["ARCH", "ENG"],
    syncYear: "2026",
  });

  assert.equal(left, right);
});

test("jira sync checkpoints are stored and retrieved by signature", () => {
  const state = { version: 1, repos: {}, jira_sync: {} };
  const signature = buildJiraSyncSignature({ organization: "example" });

  setJiraSyncCheckpoint(state, "issues", signature, {
    next_start_at: 100,
    indexed: 100,
  });

  assert.deepEqual(getJiraSyncCheckpoint(state, "issues", signature).next_start_at, 100);
  assert.equal(getJiraSyncCheckpoint(state, "issues", "other"), null);
});

test("clearJiraSyncCheckpoint removes stored jira sync state", () => {
  const state = { version: 1, repos: {}, jira_sync: {} };
  const signature = buildJiraSyncSignature({ organization: "example" });

  setJiraSyncCheckpoint(state, "events", signature, {
    next_start_at: 20,
    synced_issues: 20,
  });

  assert.equal(clearJiraSyncCheckpoint(state, "events"), true);
  assert.equal(getJiraSyncCheckpoint(state, "events", signature), null);
});
